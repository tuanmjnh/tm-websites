# Local development and database policy

Status: owner-approved direction, 2026-11-24. This document governs local development, application verification and CI database naming for the `sentuan` customer.

## 1. Decisions

1. The local CMS and storefront development environment for customer `sentuan` use the existing local MongoDB database **`sen-tuan`**. This is the normal database for hands-on app development and checking real migrated/business data; do not create a second everyday development database.
2. The canonical customer/site binding remains registry-driven: customer `sentuan`, site `sentuan`, database `sen-tuan`. `TM_MONGO_DB` may repeat the registry value but must never override it. A mismatch must continue to fail closed.
3. MongoDB is accessed only by server-side Nitro code. Never expose the Mongo URI, credentials, database name selection or Mongo client to browser code.
4. The CMS Nitro application is the single owner of canonical business writes, models, invariants and command services. Keep these under `tm-cms/server/`. Do not add a shared server-only workspace package.
5. The storefront may keep narrowly scoped SSR/public read projections, but must not import CMS server internals or create a competing implementation of business mutations. Writes to canonical business records must go through the CMS-owned business API using a server-side, tenant/site-bound authorization path.
6. CI uses its own temporary MongoDB service/container, physically isolated from the developer's local MongoDB. It uses the same logical database name **`sen-tuan`** so the same database binding and gate command can run without a special code path.

## 2. Environment contract

| Setting | Local development | GitHub Actions |
| --- | --- | --- |
| Mongo host | Developer's local MongoDB, normally `127.0.0.1:27017` | Job-local MongoDB service |
| `TM_MONGO_DB` | `sen-tuan` | `sen-tuan` |
| `TM_SITE_ID` | `sentuan` | `sentuan` |
| `TM_CUSTOMER_ID` | `sentuan` for customer builds | `sentuan` for customer builds |
| Data | Existing local customer data | Empty/ephemeral CI data, not a copy of local data |

Recommended local connection values:

```dotenv
TM_MONGO_URI=mongodb://127.0.0.1:27017
TM_MONGO_DB=sen-tuan
TM_SITE_ID=sentuan
TM_CUSTOMER_ID=sentuan
```

These values are environment examples, not permission to commit credentials. Keep real connection secrets in local ignored environment files or the relevant CI secret store. Never print a credential-bearing Mongo URI into gate logs.

The customer registry remains authoritative. If the registry's database name and `TM_MONGO_DB` disagree, the app must refuse to connect rather than silently select a different database.

## 3. Safe use of the real local development database

Using `sen-tuan` directly is intended to make the actual application useful during development. It does **not** mean every test may clear, reseed or freely mutate the database.

Classify database checks before running them:

| Check type | Allowed target | Required behavior |
| --- | --- | --- |
| Read-only smoke checks | `sen-tuan` | Read actual customer data; assert only stable contracts and report data-dependent counts without assuming the database is empty |
| Manual app development | `sen-tuan` | Normal authenticated UI/API work; use the existing site's records and preserve customer data |
| CRUD/integration checks | `sen-tuan` only when safely scoped | Create uniquely identifiable test records, record their exact IDs, and clean up only those records in a `finally` path; never clean by broad collection filter |
| Index/model compatibility checks | `sen-tuan` only after inspection | Use idempotent `createIndexes()`; never run `syncIndexes()` or destructive index reconciliation against the customer database |
| Backup/restore, database-drop, destructive migration and recovery tests | Dedicated disposable fixture database | Never run these destructive operations against `sen-tuan`; use a clearly named temporary database and verify the target before every destructive step |
| Migration verification | `sen-tuan` dry-run by default | `--apply` is a separate, deliberate operation after a verified backup and explicit owner approval |

For write tests against `sen-tuan`:

- Generate a unique `testRunId` for each test execution.
- Use test-specific unique keys/prefixes and retain the exact inserted document IDs.
- Where the schema permits, add a test marker such as `_testRunId`; do not add a production field solely for tests without documenting the schema impact.
- Clean up only records whose exact IDs or test marker belong to that run. Never use unqualified `deleteMany({})`, collection-wide reset, `dropDatabase()` or broad `updateMany()` against `sen-tuan`.
- Ensure a failed assertion cannot skip cleanup. Log the IDs/marker needed for manual cleanup if the process is forcibly terminated.
- Do not seed over, rename, delete or overwrite existing business records to make a test pass.

Before declaring `pnpm verify:all` safe on local `sen-tuan`, audit every database-writing suite and its helper scripts. A suite that needs a clean database must explicitly create and verify a disposable fixture database; it must never empty the normal development database.

## 4. CI database alignment

The quality workflow used to set `TM_MONGO_DB=tm-ci-gates`, while `scripts/build/run-gates.ts` accepts only `sen-tuan` — a configuration contradiction, corrected on 2026-11-24.

Required correction:

1. Set the quality workflow's `TM_MONGO_DB` to `sen-tuan`.
2. Keep the workflow's MongoDB service container. It is an isolated MongoDB server created for that job; matching the database **name** does not connect CI to a developer's local database.
3. Keep `TM_SITE_ID=sentuan` and the gate runner's fail-closed database binding.
4. Add/retain a preflight check that confirms the CI service is reachable and the selected database is exactly `sen-tuan`.
5. Ensure CI logs never emit Mongo credentials or a full credential-bearing URI.
6. Re-run the complete quality workflow and retain the run URL/log artifact as evidence. Do not mark the workflow fixed from a YAML edit alone.

Do not weaken the database allowlist or make the gate runner accept arbitrary database names merely to make CI green.

## 5. Server ownership and package boundaries

- `tm-cms/server/models/`: canonical Mongo models, schema validation and index definitions.
- `tm-cms/server/services/`: business commands, queries, invariants and transactional/idempotency behavior.
- `tm-cms/server/utils/`: trusted DB binding, verified user/app/site context and shared server helpers local to CMS.
- `tm-shared/packages/flow-contracts/`: browser-safe Zod contracts and DTOs only; no Mongo/Mongoose imports.
- `tm-shared/packages/flow-config/` and `flow-utils/`: pure/shared helpers only, with browser-safe and server-only exports separated.
- `tm-web/server/`: storefront SSR and narrow public read/projection endpoints. Do not import `tm-cms/server/**`.
- CMS and Web must not maintain separate implementations of the same canonical business write rule.

When a storefront or portal feature needs to mutate a canonical business record, first expose or extend the command in the CMS-owned API and call it from the Web server. Preserve the existing public URL/DTO contract where possible. Use verified app/tenant/site context; never trust a browser-supplied database, customer or tenant selector. If a safe authorization contract is missing, document the blocker instead of bypassing it.

Do not create a shared server-only package as a shortcut for cross-host imports. If a future operational need truly requires a separate business service, propose it as a separately deployed service with its own ADR, security boundary, migration plan and explicit owner decision.

## 6. Implementation plan for the coding agent

### Phase A — repository audit

1. Read the customer registry, CMS and Web Mongo connection code, runtime config and all environment examples.
2. Confirm that `sentuan` resolves to `sen-tuan` in every relevant server runtime.
3. Search the full repository for stale database names, `tm-ci-gates`, and package/architecture references that imply a shared server domain package.
4. Inventory every test script invoked by `verify:all`; classify database reads, writes, fixture creation, cleanup and destructive operations.
5. Do not change application behavior until the inventory and risk report are complete.

### Phase B — documentation and configuration alignment

1. Make this policy the source of truth and link it from the v2 documentation index, architecture doc, owner decision packet and active queue.
2. Remove the future shared-server-package proposal from the architecture document. Record the selected business ownership boundary: CMS Nitro owns canonical writes; Web is a consumer for canonical mutations.
3. Update the quality workflow to use `TM_MONGO_DB=sen-tuan` against its own MongoDB service.
4. Ensure local examples use `sen-tuan` and `sentuan`, without committing real credentials.
5. Remove stale or contradictory instructions; do not silently change the customer's registry/database mapping.

### Phase C — test-safety hardening

1. Review every `test:*` and `verify:*` script reachable from `verify:all`, especially backup/restore, migration, retention, audit-write, import/apply and database-binding tests.
2. Refactor broad cleanup into exact-ID/test-run-scoped cleanup.
3. Keep intentionally destructive scenarios on named disposable fixture databases and add a guard that refuses `sen-tuan` as their destructive target.
4. Add a preflight report showing the selected customer/site/database without exposing the URI or credentials.
5. Verify that test failure, process interruption and cleanup failure leave existing customer records untouched.

### Phase D — application verification on real data

1. Start local MongoDB and confirm the expected `sen-tuan` database exists before starting the app.
2. Start CMS and Web using the `sentuan` customer configuration.
3. Check `GET /api/health` and confirm database readiness without exposing connection details.
4. Smoke-test CMS modules against actual records: content, menus, company/site settings, catalog/variants, CRM, orders/quotations, inventory, purchasing, finance, HR, shipping and supplier portal.
5. Check storefront SSR/public APIs read the same intended customer/site data and expose only public projections.
6. Exercise representative create/update flows with clearly marked test records, then verify exact cleanup.
7. Run static gates, database gates, typecheck, lint and both production builds.

### Phase E — CI and evidence

1. Run `pnpm verify:all` locally against `sen-tuan` only after Phase C passes.
2. Run the GitHub Actions quality workflow against its isolated MongoDB service, also named `sen-tuan`.
3. Run CMS and Web production builds and their output validators.
4. Record commit SHA, database target (host class + logical name only), gate counts, failures, test log and build results.
5. Do not describe the app as production-ready from local `sen-tuan` checks alone; production URI, provider credentials, deployment, backup/off-site and rollback approvals remain separate launch requirements.

## 7. Acceptance criteria

- [ ] Both local CMS and Web server-side runtime resolve customer `sentuan` to database `sen-tuan`.
- [ ] `TM_MONGO_DB` can only confirm the registry's binding; a mismatch still fails closed.
- [ ] No browser bundle contains MongoDB drivers, URI, credentials or direct database access.
- [ ] No application code or documentation proposes a shared server-only domain package as the target architecture.
- [ ] CMS Nitro is documented and tested as the canonical business write owner.
- [ ] Web does not import CMS server internals or duplicate canonical business mutation logic.
- [ ] All tests called by `verify:all` have a documented data-safety classification.
- [ ] Destructive tests cannot target `sen-tuan`; write tests clean only their own exact fixtures.
- [ ] Local `pnpm verify:all` completes against the existing `sen-tuan` database without deleting or overwriting pre-existing records.
- [ ] CI uses its own temporary MongoDB service with logical database name `sen-tuan`, and the complete quality workflow passes.
- [ ] CMS/Web production builds and validators pass on the same revision.

## 8. Explicitly out of scope

- Connecting local development or CI to production MongoDB.
- Renaming `sen-tuan`, changing the `sentuan` customer/site identity or creating a second daily development database.
- Destructive reseeding/reset of the existing local database.
- Production migration, deployment or cutover.
- Moving all business models/services into a new shared package.
