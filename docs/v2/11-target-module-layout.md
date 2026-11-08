# 11 — Target module layout and conventions

Status: target conventions. Nothing here exists yet unless the path is marked **existing**. Do not create the whole tree up front: create the folders a slice needs, in the order the slice requires them.

## Packaging decision

| Package / location | Purpose | Status |
| --- | --- | --- |
| `@tm/flow-contracts` | Zod DTOs, enums, public/admin response contracts shared by app and server | existing |
| `@tm/flow-config` | Build/customer configuration schemas | existing |
| `@tm/flow-utils` | Pure helpers (slug, price, seo, markdown, …) | existing |
| `@tm/design-system` | CSS tokens and primitives | existing |
| `@tm/flow-domain` | **Planned** server-only business core: Mongoose schema factories, commands, invariants, migrations | not yet created |

`@tm/flow-domain` follows the existing `@tm/flow-*` naming family. It must never be imported from `app/` code. Its `exports` map must not expose browser-safe entry points; if a type is needed in the UI, move that type to `@tm/flow-contracts`.

Split the package internally by domain, one folder per bounded context:

```text
tm-shared/packages/flow-domain/src/
  catalog/      content/     commerce/    inventory/
  purchasing/   finance/     hr/          crm/
  site/         media/       comms/       operations/
```

Each domain folder follows the same shape:

| File | Contains |
| --- | --- |
| `model.ts` | Mongoose schema factory + indexes, `strict: true`, collection name |
| `types.ts` | Server-internal document/aggregate types (not public DTOs) |
| `commands.ts` | Write operations: validate → authorize precondition → persist → emit event |
| `queries.ts` | Admin/portal read operations returning domain projections |
| `invariants.ts` | Pure rules shared by commands and tests (totals, state transitions, stock math) |
| `events.ts` | Domain event names + payload schemas for invalidation/audit/jobs |
| `index.ts` | Explicit exports only; no wildcard re-export |

## Placement rules by concern

| Concern | Location |
| --- | --- |
| Admin page | `tm-shared/nuxt-layers/cms-base/app/pages/<domain>/…` or a domain layer |
| Customer page override | `tm-shared/customer-layers/cms/<customer>/app/pages/…` |
| Admin component | `tm-shared/nuxt-layers/cms-base/app/components/<domain>/…` |
| Shared UI primitive | `@tm/design-system` or `core-base` components |
| CMS admin endpoint | `tm-cms/server/api/v1/admin/<domain>/…` |
| CMS server adapter/authorization | `tm-cms/server/services/<domain>/…`, `tm-cms/server/utils/…` |
| Public/portal endpoint | `tm-web/server/api/v1/{public,customer,supplier}/<domain>/…` |
| Portal page | `tm-shared/nuxt-layers/web-base/app/pages/…` plus customer override |
| Public DTO | `@tm/flow-contracts/<domain>-public.ts` |
| Admin DTO | `@tm/flow-contracts/<domain>-admin.ts` |
| Business rule | `@tm/flow-domain/<domain>/invariants.ts` |
| Migration | `tm-cms/server/migrations/<yyyy-mm-dd>-<slug>.ts` + dry-run command |
| Tests | see table below |

Host `app/pages` and `app/layouts` stay empty. A domain that becomes optional gets a Nuxt module layer only when customer composition actually requires enabling/disabling it; do not create empty layers per domain.

## API conventions

Namespace ownership (target, not existing everywhere):

| Prefix | Caller | Auth |
| --- | --- | --- |
| `/api/auth/*` | Browser login/session | none for login, cookie for session |
| `/api/v1/admin/*` | CMS browser | verified Hub context + capability |
| `/api/v1/public/*` | Web visitors | none; public read/command policy |
| `/api/v1/customer/*`, `/api/v1/supplier/*` | Portals | Hub identity + resource ownership |
| `/api/_internal/*` | Trusted operations only | signature/secret + replay protection |

Rules:

- One resource per file: `index.get.ts`, `index.post.ts`, `[id].get.ts`, `[id].patch.ts`.
- Validate request input with a Zod schema from `@tm/flow-contracts`; parse, never cast.
- Response envelope: `{ success: true, data, nextCursor? }` or `{ success: false, code, message, details? }`.
- Error codes are stable strings in `SCREAMING_SNAKE_CASE`; HTTP status must match the failure class. Never return upstream/provider messages.
- Lists: `cursor` + `limit` (bounded, default ≤ 50), stable sort with unique tie-breaker, `nextCursor: null` at the end.
- Mutations that can be retried accept an idempotency key; the record lives in `operations` with a unique index.
- Public endpoints declare an explicit projection builder. Never `toObject()` an admin document into a response.

## Permission naming

Proposed pattern: `<domain>.<action>` (e.g. `catalog.read`, `catalog.write`, `finance.approve`, `hr.payroll`). **These strings must be confirmed against provisioned Hub role grants before any endpoint depends on them.** Until confirmed, keep capability names in one constant map per domain and reference the map, never inline string literals scattered across files.

Separate capability (`may this actor use this module action`) from ownership (`may this actor touch this record`). Ownership is always a query predicate or explicit check against the verified subject, never a UI filter.

## Module enablement

`registry/customers.ts` decides which app kinds and modules a build includes. It does not grant access. A module must be safe when reached directly by URL: the API still enforces capability and ownership. When a module is disabled for a customer, its API returns 404 from the adapter layer, not an empty list that looks like missing data.

## Test layout

| Test kind | Location | Notes |
| --- | --- | --- |
| Pure invariants | `tm-shared/packages/flow-domain/test/<domain>.test.ts` | No DB, no Nest/H3 |
| Command/query integration | `tm-cms/test/integration/<domain>/` | Disposable Mongo, replica set if transactions used |
| Contract/scaffold | existing `scripts/build/test-*.ts` | Add cases only when the contract changes |
| Public API | `tm-web/test/api/<domain>/` | Ownership, projection, cache headers |
| Browser/E2E | `tm-web/test/e2e/`, `tm-cms/test/e2e/` | Explicitly state if not run |

Prefer Node's built-in test runner or the project's existing runner; do not add a second framework. Any new script must be added to root `package.json` and documented in [08](08-operations-and-verification.md) in the same change.

## Bootstrap checklist for one domain

1. Copy the parity row into the current queue with its legacy source paths.
2. Write `invariants.ts` and failing tests for state transitions and totals.
3. Write `model.ts` with indexes justified by the actual queries; state collection name and migration impact.
4. Implement commands/queries; return domain results, not Mongoose documents.
5. Add DTOs to `@tm/flow-contracts`; add integration tests with two tenants/sites.
6. Add admin endpoint + capability check; verify 401/403/404 semantics.
7. Add admin UI with loading/empty/error/forbidden states and vi/en copy.
8. Add public/portal endpoint only if the parity row requires it, with an explicit projection.
9. Add migration dry-run if legacy data exists.
10. Run gates, browser checks, update the parity row and queue with evidence.

Do not mark a domain complete because its CRUD screens exist: the parity row's acceptance column decides.
