# TM Websites / TM Platform / TM Hub — Repository Audit

**Audit date:** 2026-11-18  
**Scope:** Read-only review of the default branches, manifests, key integration files, owner-decision docs and latest GitHub Actions runs. No source files were changed, committed, published or deployed during this audit.

> **Status update (2026-11-18, after the audit):** §3.1, §3.2, §3.3 and the §5.4 tenant-admin items have been fixed, committed and pushed; CI is green on all three repositories, and §5.1/§5.2 are closed against ADR 0002. See §10 for the run IDs and for the one correction this update makes to the audit's own diagnosis. Still open: the two browser checks, applying the RLS revoke migration, and the authenticated Hub rows (§10).

## 1. Executive summary

The architecture is substantially in place: `tm-websites` contains separate `tm-cms` SPA and `tm-web` SSR applications, shared Nuxt layers, customer composition, CMS domain APIs and public storefront readers. `tm-platform` provides shared packages and `tm-hub` remains the central identity/control plane.

**The immediate blocker was repository reproducibility, not missing features:** the CI runs that failed in `tm-websites` and `tm-platform` are now green on the pushed fixes (§10), and the security decisions that had drifted between documents are reconciled in §5. What is left is the V2 phase gates (P2–P4, P9) plus the verification items §10 still lists as open.

Do not reopen the previously deferred features listed in §7.

## 2. Revisions inspected

| Repository | Branch | Revision inspected | Relevant finding |
|---|---|---|---|
| `tuanmjnh/tm-websites` | `main` | `2e8fd0b5011620462a445ce42398b0ea20a13a06` | Registry `@tuanmjnh/tm-ui` 0.2.0 adopted with the package's 30-primitive globals plugin, root package renamed `tm-websites`, and this audit recorded. Quality Gates 37/37 on CI. |
| `tuanmjnh/tm-platform` | `main` | `5d18a04405325c8ff73e82b236563960e5b4a1fc` | CI workflow runs Node 24 / pnpm 12; `pnpm test` green with a non-zero count in every package. |
| `tuanmjnh/tm-hub` | `main` | `147cf56c7ab1dc7742bc8fd46a34a899af70de74` | Tenant administration page, the §5.4 hardening services/routes, `tests/tenant-admin-hardening.test.ts` and the first CI workflow. |

All three revisions equaled `origin/main` as reported by `git ls-remote` when this was checked. A later Hub fix (`a7c569c`, §5.4) is committed locally and not yet pushed.

## 3. P0 — Fix the two failing CI pipelines

> **Both fixed 2026-11-18, committed and pushed, and green on CI — see §10 for the run IDs.** The diagnoses below are kept as written; §3.2's recommended fix was wrong and §10 explains why.

### 3.1 `tm-websites`: remove the CI-breaking cross-repository link

Latest run: https://github.com/tuanmjnh/tm-websites/actions/runs/44223843866

Result: **36/37 gates passed**. The failing gate is `typecheck`:

```text
../tm-shared/nuxt-layers/cms-base/app/components/ModuleStatusBadges.vue(2,29):
error TS2307: Cannot find module '@tuanmjnh/tm-ui' or its corresponding type declarations.
```

Cause found in source:

- `tm-shared/nuxt-layers/cms-base/package.json` declares `@tuanmjnh/tm-ui` as `link:../../../../tm-platform/packages/tm-ui`.
- That link points outside the `tm-websites` repository. A clean GitHub runner checks out `tm-websites`, not the sibling `tm-platform` directory.
- `ModuleStatusBadges.vue` imports `StatusBadge` from that package.
- The linked-package-specific Vite filesystem/Vue alias and Tailwind source path also assume the sibling checkout exists.

**Recommended fix:** consume the registry package instead of a filesystem link. `tm-hub` already resolves `@tuanmjnh/tm-ui@0.2.0` from its lockfile, so align `cms-base` with the same published package version rather than adding a cross-repo checkout dependency.

When converting to the registry package:

1. Change the `cms-base` dependency from `link:` to `@tuanmjnh/tm-ui: ^0.2.0` (or an exact pinned version if release immutability is preferred).
2. Refresh `pnpm-lock.yaml` using a clean install.
3. Use the generated `tm-ui-globals.client.ts.txt` shipped by the exact package version; compare it with the current six-component registration plugin so no primitive is missing.
4. Update Tailwind `@source` to the published package root. The package README explicitly says the published `dist` contents are flattened, so an `.../tm-ui/dist` path is not the correct registry path.
5. Remove the Vite filesystem allow-list and Vue alias that exist only for the local sibling link, after verifying no other local linked package needs them.
6. Verify CMS rendering in a browser (not only build/typecheck): `StatusBadge` must resolve to a real Nuxt UI primitive, not an empty `<ubadge>` custom element.

Keep `tm-ui` usage in the CMS SPA only. Do not introduce it into `tm-web` SSR until its SSR/hydration compatibility is explicitly tested.

Acceptance:

- `pnpm install --frozen-lockfile` succeeds in a clean clone of `tm-websites` with no sibling repository present.
- `pnpm typecheck`, `pnpm lint`, `pnpm verify:all`, CMS build and Web build pass.
- Browser check confirms the status badges render and CSS tokens/styles are present.

**Applied 2026-11-18:** `cms-base` now declares `@tuanmjnh/tm-ui: ^0.2.0` and resolves it from the registry; the `link:` is gone and `pnpm-lock.yaml` no longer mentions `tm-platform`. The generated globals plugin was replaced with the package's own template, which registers all 30 primitives (the hand-kept list had 6). Tailwind's `@source` now points at the flattened registry package root, and the Vite `fs.allow` / `vue` alias that existed only for the sibling link were removed. `pnpm typecheck` and `pnpm verify:all` pass locally and on CI (37/37) — see §10.

**Browser check run 2026-11-18** on `2e8fd0b` with `TM_AUTH_MODE=mock` on `:4005`: `/orders` (the `ModulePendingPage` that mounts `ModuleStatusBadges`) renders both badges as real elements — a `span` carrying `bg-success/10 text-success ring ring-inset ring-success/25 rounded-[4px]` with computed `border-radius: 4px`, `padding: 2px 4px` and a resolved `oklch` background — and **no element matched `/^u[a-z]/`**, so nothing fell through to a dead custom element. This is a mock-session UI check only; it does not replace the authenticated Hub pass.

### 3.2 `tm-platform`: make package test discovery deterministic

Latest run: https://github.com/tuanmjnh/tm-platform/actions/runs/44224443317

Result:

- `pnpm install --frozen-lockfile`: pass
- `pnpm typecheck`: pass
- `pnpm build`: pass
- `pnpm test`: fail

Observed errors:

```text
packages/tm-ai-client: Could not find .../tests/**/*.test.mjs
examples/nuxt4-app: Could not find .../tests/**/*.test.mjs
packages/tm-cut-core: Could not find .../test/*.test.mjs
```

The repository tree contains test files in those directories. Several other packages (`tm-validators`, `tm-utils`, `tm-types`) also use similar quoted glob scripts, so do not fix only the three packages printed in the first failure output.

**Actual cause (corrected 2026-11-18):** the globs are correct; the workflow was not. `.github/workflows/ci.yml` pinned `node-version: 20` and `pnpm 9`, while `node --test <glob>` only accepts a glob from Node 21 onward and the projects are built on Node 24. Every package failed at once for that single reason, and the same scripts pass unchanged on Node 24.

**Fix applied:** raise the workflow to Node 24 / pnpm 12, matching `tm-websites` and the other repos. The package test scripts were left alone.

**Recommended follow-up (not applied):** assert a non-zero executed test count per package, so a future script that silently matches nothing fails instead of passing with zero tests. The current run prints a per-package `ℹ tests N` line that CI does not yet check.

Acceptance:

- Every workspace package with tests reports a non-zero executed test count.
- Every expected test file is executed on the CI runner; no package is silently skipped after another package fails.
- `pnpm test`, `pnpm typecheck` and `pnpm build` all pass from a clean clone.
- Include a Windows/local run if Windows is a supported contributor environment.

Node reference: https://nodejs.org/download/release/v24.22.2/docs/api/test.html

### 3.3 `tm-hub`: add a CI workflow

The `tm-hub` main tree has no `.github/workflows/` directory, and the Actions runs endpoint returned no workflow runs. This is not evidence that the code is broken, but there is no repository CI evidence to rely on.

**Fix applied 2026-11-18:** a workflow runs frozen install, typecheck and the existing test script on Node 24 / pnpm 12. No production credentials are used — the suite stubs Supabase and Mongo. A Nitro/Vercel production build is left to the deploy job, which does have the environment.

## 4. Cross-repository integration findings

### 4.1 Shared package versions

- `tm-websites` now uses `@tuanmjnh/tm-hub-client` 1.2.0, replacing the older unscoped `tm-hub-client` 1.0.9. This is aligned with the updated `tm-platform` package.
- `tm-platform` `tm-validators` is now version 0.2.0 and uses Zod 4.6.7. This removes the earlier Zod 3/Zod 4 mismatch.
- `tm-hub` now uses Nuxt 4.6.4, Zod 4.6.7 and `@tuanmjnh/tm-ui` 0.2.0.
- `tm-platform` still does not provide a shared CMS/Web business-domain package. That is not a blocker: the current `@tm/flow-contracts` and `@tm/flow-utils` packages can remain local to `tm-websites`; do not move business-domain schemas into `tm-platform` without a concrete cross-app consumer.

### 4.2 Documentation drift to correct

- ~~The current `tm-websites` audit note says `tm-ui` is deferred/not adopted…~~ **Corrected 2026-11-18:** the CMS layer now consumes registry `@tuanmjnh/tm-ui@0.2.0` (no `link:`), so the note in `TM-CMS-WEB-Remaining-Decisions-and-Repository-Audit-2026-11-18.md` §7.4 ("no publish, no version bump, no adoption into tm-cms") describes a superseded decision. `tm-web` still does not use `tm-ui`, so the SSR constraint there is unchanged and still real.
- `tasks/todo.md` and the CI log differ on gate count: the current `verify:all` runner has 37 gates, while older task notes still refer to 36. Update the count after the clean run.
- The root `tm-websites/package.json` named itself `tm-platform`. **Done 2026-11-18:** it is now `"name": "tm-websites"`.

## 5. P1 — Security and identity contract: reconcile before further expansion

**Resolved 2026-11-18 — both disagreements closed by restoring ADR 0002 as the single authority.** ADR 0002 (`docs/decisions/0002-owner-decisions.md`, 2026-11-09, committed) is the canonical record; the newer note had restated two decisions as if the owner had changed them, without a new ADR. The newer note was corrected to restate Q8 and D1, and both test matrices were realigned to the behaviour that already exists. No product code changed.

### 5.1 CSRF policy disagreement — closed

- **Canonical (ADR 0002 Q8):** `Origin` check + `SameSite=Lax`, no double-submit token.
- **What the code does** (`tm-cms/server/utils/csrf.ts`): compares `new URL(origin).host` with the request `Host`; without `Origin`, rejects `Sec-Fetch-Site` outside `same-origin`/`none`; allows a request with neither header because such a client carries no ambient cookie.
- **Resolution:** the newer note's "strict Origin/Fetch Metadata + double-submit" was withdrawn as never adopted. Its §3.1, status table, test matrix (row 3 now expects 2xx by design), acceptance list and §8 queue rows were rewritten to match Q8. `scripts/build/test-cms-iam.ts` was already correct and needed no change.
- **If a stricter policy is ever wanted** (e.g. a customer portal), it needs a new ADR plus coordinated changes to `csrf.ts`, its ~12 client call sites and that test — changing the test wording alone would hide the behaviour change.

### 5.2 Hub proxy policy disagreement — closed

- **Canonical (ADR 0002 D1):** `/api/v1/auth/**` blocked so token routes stay BFF-only; remaining `/api/v1/**` business paths proxied until each domain migrates.
- **What the code does:** `sanitizeHubProxyPath` rejects non-`/api/v1` paths (so no user-supplied Hub URL), `isHubProxyPathDenied` rejects `/api/v1/auth` and children, body methods also run the origin guard, then the request forwards.
- **Resolution:** the newer note's "deny-by-default method+path allowlist" was withdrawn as never adopted; §3.2, the matrix rows, the acceptance list and the queue rows were rewritten to describe D1 and to record that the broad passthrough is intended, with a note to keep the per-domain migration list current.
- **Accepted residual:** until each domain migrates, any Hub `/api/v1` business endpoint the caller's token can reach is reachable through the proxy. That is D1's explicit trade-off, not a defect.

### 5.3 Known Hub session limitations (not fixed by the dependency upgrade)

The latest Hub commit changes package/dependency files only. The auth contract remains as previously audited:

- Access JWTs do not carry a formal `sid`/session identifier or `tenantId` claim.
- `/api/v1/auth/introspect` verifies the JWT; it does not read the refresh-session row to check revocation.
- Revoking a refresh session prevents future refresh but does not invalidate an already-issued access JWT before expiry. Keep the documented `ACCESS_TOKEN_REVOCATION = NOT_IMMEDIATE` limitation (default access-token lifetime 15 minutes) unless the owner authorizes a Hub contract change.
- CMS refresh coordination is process-local singleflight. It does not coordinate two separate CMS instances; a cross-instance race can still result in a sign-out. This is already documented as an accepted limitation. Do not add Redis or weaken token-reuse detection as a workaround.

### 5.4 Hub tenant/API hardening still outstanding

The inspected Hub source still contains items that should be addressed before production use of tenant administration:

- ~~`listTenantApps()` selects and returns raw app rows (`select('*')`), which includes `secret_key`~~ **Fixed 2026-11-18:** the service now maps every row through `secret_key: '••••••••'` before returning, because the endpoint is reachable with `tenants.read` rather than root. Note the audit's own scoping was slightly off: `GET /api/v1/apps` already masked the field for non-root callers (`apps/index.get.ts:104`) and `GET /apps/:id` masks unless the caller holds `'*'` (`apps/[id]/index.get.ts:41`); the unmasked path was this tenant list specifically.
- ~~`createTenant()` defaults `database_binding` to `{ provider: 'mongodb', status: 'configured' }` without proving a database connection exists.~~ **Fixed 2026-11-18:** the default is now `status: 'unconfigured'`; nothing promotes it until a health check runs.
- ~~`apps/index.post.ts` defaults missing `allowedOrigins` to `['*']`~~ **Fixed 2026-11-18:** the field is now required by the request schema (at least one non-empty origin) and the `['*']` default is gone, so a caller must name its origins.
- ~~`deleteTenant()` physically deletes a tenant.~~ **Addressed 2026-11-18:** archiving is now the default row action (`PUT { status: 'archived' }`), and permanent deletion is a separate dialog that shows a live impact preview (sites / media records / config entries / linked apps), requires the operator to type the tenant id, and calls `DELETE ...?confirm=<tenantId>` — the route rejects a DELETE without that echo. `describeTenantDeletion()` supplies the counts. The cascade itself is unchanged by design: `sites`, `media_resources` and `app_configs` still go with the tenant, `apps` is only unlinked.
- **Browser check 2026-11-18 (root session, local Hub `:4000`):** the first attempt showed nothing opening at all — the handler ran (the `?impact=1` request returned 200) but no dialog appeared. Cause was in the Hub's own wrapper `app/components/base/ResponsiveModal.vue`, not in this page: it forwarded `:model-value="modelValue"`, and Vue supplies an absent Boolean prop as `false`, while tm-ui resolves `modelValue ?? open` — so `open` was always overridden to `false`. Every modal using that wrapper (tenant create, tenant detail, permanent delete) was silently dead. Fixed by making `open` a real `defineModel` and binding `v-model:open` (`tm-hub` commit `a7c569c`); after that all three dialogs open. The permanent-delete dialog was then verified read-only: impact preview rendered real counts (1 website, 0 media records, 0 config entries, 2 linked apps to unlink), the submit button stayed disabled for a wrong id and enabled only after typing the exact `tenant_default`, and no DELETE was sent.
- ~~`supabase/policies.sql` contains broad `USING (true)` policies for `anon` and `authenticated`.~~ **Addressed 2026-11-18, pending owner apply:** all 38 tables `ENABLE ROW LEVEL SECURITY` *and* carry a permissive `anon, authenticated` policy, so RLS currently protects nothing. The premise that makes this survivable is verified: the single DB client is built from `SUPABASE_KEY`, whose JWT role is `service_role` (server-only `runtimeConfig`, absent from the `public` block), and no browser bundle in any TM app holds a publishable key. `supabase/migrations/20261118000000_revoke_anon_access.sql` drops those policies and revokes the role grants; it is **not applied** — the owner runs it. `policies.sql` now states that this deployment is METHOD 1 so nobody re-applies METHOD 2 by habit.

All five items are pinned by `tests/tenant-admin-hardening.test.ts`; the suite is 273/273. The latest Hub dependency commit did not change these source files, which is why the audit saw them unchanged.

## 6. P2–P4 and P9 — what to continue after CI is green

The phase table in `docs/v2/07-delivery-roadmap.md` still marks the phases below as in progress. The dated slices in `docs/v2/05-feature-parity.md` show substantial features already implemented; do not rebuild them.

### P2 — tenant/data foundation

- Complete a repeatable two-tenant isolation test using disposable databases and a CMS-only customer configuration.
- Verify that tenant/app/database bindings cannot be widened by request input, that missing or mismatched bindings fail closed, and that audit rows retain actor, resource, reason and request identity.
- Keep actual customer production databases and legacy data import blocked until the owner supplies the real inputs and authorization.

### P3 — content/media/site vertical slice

- Finish the acceptance gate for CMS draft/edit/publish/unpublish, revisions/restore, localized fields, tags/categories, menus/settings, audit history and SSR public projections.
- Verify the public reader never exposes drafts or private fields; test slug changes/redirects and scoped cache invalidation end-to-end.
- Treat the local media adapter as the current V2 implementation. Cloudinary credentials and public media projection remain deferred; do not invent public URLs or leak CMS-local paths.
- The feature-parity document still lists legacy content formats/types without complete renderers. Decide which formats are genuinely required for new V2 content; do not implement migration-only renderers for records that are explicitly not being imported.

### P4 — catalog/storefront

- Close the phase gate for product/category CRUD, localized content, SKU/variant/attribute rules, effective-price calculation, published-only public projection, search and cart re-quotation.
- Test invalid/deleted variants, quantity caps, stale prices, disabled products and public-field allowlists across locales and customer builds.
- Keep serial/IMEI, inventory ledger and import flows out of this V2 slice as previously decided.

### P9 — hardening/parity

- Re-run the full enabled customer/app build matrix after the clean dependency and CI fixes.
- Keep actual authenticated Hub verification marked BLOCKED until a dedicated test account/app installation is supplied; the mock-session browser pass is useful but is not a replacement for the Hub-backed authentication test.
- Update the feature matrix and verification log only with dated evidence from the exact revision tested. Keep build gates, browser verification and production readiness as separate statuses.

## 7. Explicitly out of scope — do not reopen

Keep these deferred for this V2 delivery:

- Checkout, order persistence and payment flow (`WEB-06`).
- Contact/newsletter/inquiry forms (`WEB-07`).
- Public media URL projection, logo URL and dynamic OG media.
- Locale-prefixed URLs and `hreflang`; preserve `no_prefix`.
- Durable events, queues, workers, cron and scheduled jobs; keep publish/prune manual.
- Hub legacy content/config/media import and real-data migration for remaining customers.
- Orders, full Inventory, Finance, Reports and the broader ERP modules.
- AI Workspace UI.
- Serial/IMEI domain work.
- Vendor-specific CDN purge integration; keep only the current scoped internal cache purge.

## 8. Recommended execution order

1. ~~**P0.1:** Switch `tm-cms` `tm-ui` dependency from sibling `link:` to registry `@tuanmjnh/tm-ui@0.2.0`~~ **Done 2026-11-18** and green on CI (§10). Remaining: the browser render check.
2. ~~**P0.2:** Fix all `tm-platform` package test scripts~~ **Done locally 2026-11-18** — but the fix was the workflow's Node version, not the scripts (§10).
3. **P0.3:** ~~Add `tm-hub` CI~~ **done 2026-11-18, CI green**; the Hub tenant API secret DTO / database binding / origin defaults are fixed and pinned by tests, and tenant deletion now archives by default with a guarded permanent path. The guarded dialog is verified in a browser and a dead `ResponsiveModal` wrapper was fixed (§5.4). Still open before tenant administration reaches production: apply the RLS revoke migration (§5.4) and exercise archive plus a real permanent delete on a disposable tenant.
4. ~~**P1:** Reconcile CSRF and proxy policy documents with the actual owner-approved behaviour, then make tests and code agree.~~ **Closed 2026-11-18** (see §5.1, §5.2): ADR 0002 is authoritative and the newer note was corrected to it; no code changed.
5. **P2–P4:** Close tenant isolation, content and catalog phase gates within the approved V2 scope.
6. **P9:** Run all enabled customer builds and the Hub-backed CMS verification with a dedicated test account.
7. **P10:** Remains blocked until production Mongo connection, legacy snapshot, Vercel/domain access and explicit production authorization are available.

## 9. Audit limitations

- This is a GitHub source/CI review. No local dev server, production data, account login, production migration, deployment or live user session was exercised in this pass.
- CI failures and commit hashes above are directly observed from GitHub Actions and repository sources.
- No credentials, production URLs beyond the documented Hub endpoint, or test identities were inferred or fabricated.

## 10. Status update — what was actually fixed (2026-11-18)

All changes below are committed and pushed on `main`, and the CI runs on those commits are green:

| Repository | CI run | Result |
|---|---|---|
| `tm-websites` | Quality Gates [`44245249725`](https://github.com/tuanmjnh/tm-websites/actions/runs/44245249725) | success — `typecheck` (12.3s) and `37/37 gates passed in 32.2s` |
| `tm-platform` | CI [`44245218328`](https://github.com/tuanmjnh/tm-platform/actions/runs/44245218328) | success — every package reports tests (`tm-cut-core` 927, `tm-ai-client` 16, `tm-hub-client` 28, `tm-mongo` 12, `tm-core` 8, `tm-ui` 7, `tm-validators` 2, `tm-utils` 2, `tm-types` 1), no "Could not find" |
| `tm-hub` | CI [`44245872570`](https://github.com/tuanmjnh/tm-hub/actions/runs/44245872570) | success — `tests 273 / pass 273 / fail 0` |

The same gates were run locally before the commits (`pnpm typecheck` exit 0 and `pnpm verify:all` 37/37 in 102.7s; `pnpm test` exit 0 in `tm-platform`; 273/273 in `tm-hub`), so the CI result is the clean-environment confirmation rather than the only evidence.

| Item | Change | Evidence |
|---|---|---|
| §3.2 tm-platform CI | `.github/workflows/ci.yml`: Node 20 → 24, pnpm 9 → 12 | `pnpm test` locally: every package reports a non-zero count (tm-ai-client 16, tm-hub-client 28, tm-mongo 12, tm-core 8, tm-types 1, tm-utils 2, tm-cut-core 927, tm-validators 2, tm-ui 7); 0 "Could not find" |
| §3.1 tm-websites CI | `cms-base`: `link:` → `^0.2.0`; globals plugin replaced with the package's 30-primitive template; `@source` → package root; Vite `fs.allow` + `vue` alias removed | `pnpm typecheck` exit 0 / 0 `error TS`; `pnpm verify:all` **37/37 gates** (was 36/37); lockfile has 0 `tm-platform` references and no manifest keeps a `link:` |
| §3.3 tm-hub CI | new `.github/workflows/ci.yml` (frozen install, typecheck, test) | `pnpm typecheck` 0/0; `node tests/run-tests.mjs` **273/273** |
| §5.4 secret | `listTenantApps` masks `secret_key` | `tests/tenant-admin-hardening.test.ts` |
| §5.4 binding | `createTenant` defaults `status: 'unconfigured'` | same spec |
| §5.4 origins | `allowedOrigins` required, `['*']` default removed | same spec |
| §5.4 delete | archive is the default action; permanent delete = impact preview + typed id + `?confirm=` | same spec (2 cases); route and page |
| §5.4 modal | Hub `app/components/base/ResponsiveModal.vue` binds `open` through `defineModel` instead of forwarding a `false` `model-value` that overrode tm-ui's `modelValue ?? open` | browser (`root@example.com`, local `:4000`): create-tenant, tenant-detail and permanent-delete dialogs open; delete confirm stays disabled until the exact tenant id is typed |
| §5.4 RLS | migration drops the 38 `anon, authenticated` policies and revokes grants | `supabase/migrations/20261118000000_revoke_anon_access.sql` — **not applied**, owner runs it |

**Correction to this audit's own reasoning:** §3.2 attributed the CI failure to the package test scripts and recommended rewriting them. That was wrong. The scripts are correct and pass unchanged; the workflow ran Node 20, where `node --test <glob>` does not expand. Anyone acting on the original §3.2 text would have changed nine files for no effect.

**Still open** (do not read the table above as completion):
- ~~The §3.1 acceptance browser check~~ **Done 2026-11-18** (§3.1): no `u*` custom elements, badge classes and tokens resolve. Keep this as UI evidence only — it ran with a mock session.
- ~~The permanent-delete dialog is unverified in a browser~~ **Verified read-only 2026-11-18** (§5.4): it opens, the impact counts are real, and submission is gated on typing the exact tenant id. It was **not** submitted, so the cascade and the `?confirm=` rejection are still unexercised at runtime. The archive action was not executed either.
- **Blocker for any mutating tenant test:** the local Hub dev server on `:4000` is healthy but its `.env` points at the production Supabase project (`gnqvrmaucavzzpgednc.supabase.co`) and the production Mongo URIs, so it is not a sandbox — archiving or deleting anything there mutates production rows. A disposable tenant is required, and nothing may run against `tenant_sentuan`.
- `supabase/migrations/20261118000000_revoke_anon_access.sql` is written but **not applied**. Before applying, re-confirm no browser bundle holds a publishable key for that project; after applying, re-run the app suites because a caller that relied on PostgREST with a non-service key would now fail.
- The authenticated proxy/CSRF runtime rows — the Hub test account now exists and authenticates (seeded `root@example.com`, password in `tm-hub/scripts/seed/shared.ts`; `is_super_admin`, `root` role in the Hub app, `permissions: ['*']`), so this is no longer blocked on access. The CMS proxy/CSRF rows themselves have not been run.

