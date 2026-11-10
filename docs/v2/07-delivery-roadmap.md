# 07 — Ordered delivery roadmap

This replaces the old Hub-business/MVP plan. It is not a claim that old code should be deleted. Keep working behavior while replacing its ownership through tested slices. The [current queue](../../tasks/todo.md) tracks active work; [feature parity](05-feature-parity.md) defines scope.

**Status note (2026-11-07):** uncommitted work already implements parts of P1 (verified context, CSRF origin guard, proxy auth denial) and P2 (customer DB binding, content/category/media services, idempotency, audit, migrations), with `pnpm test:iam|db|content|categories|media|bulk` scripts. Those scripts were **not run by the documentation reset**, so the phases remain in progress. P3 public content read is also partially wired. Treat the phase table as the dependency map, and the dated slice records in [05](05-feature-parity.md) as the status.

**Status note (2026-11-08):** later slices added settings, site menus, a site-scoped audit read API, retention pruning, Web catalog/site readers, cart re-quoting, discovery, unified search and crawl policy, each with its own script and dated record in [05](05-feature-parity.md). The phase table below is unchanged deliberately: phase exit gates are end-to-end criteria, not a sum of slice tests. P1's authoritative-session gate and P2's two-tenant transaction gate remain open, and no phase is marked done because its scripts pass. Read the dated records for what was actually run, on which tree.

## Phase sequence

| Phase | Deliverable | Dependencies | Exit gate |
| --- | --- | --- | --- |
| P0 — Documentation reset | Baseline, ownership decision, feature inventory, archive, AI rules | User-selected direction | Local links and archive hashes verified; no application PASS implied |
| P1 — IAM contract and BFF | Server-only SDK adapter, narrow auth/IAM routes, CSRF, app/context checks, refresh/session strategy | Actual Hub/client contracts | Stub integration and browser token checks pass; authoritative verification policy approved and tested before production private access |
| P2 — Business foundation | Trusted customer DB binding, shared server models/invariants, safe contracts, site/settings, audit/idempotency infrastructure | P1 context contract | Two dummy tenants isolated, CMS-only fixture, no browser server imports, DB unavailable/invalid-binding tests |
| P3 — Content/media/site vertical slice | Local content/config/media metadata, CMS editor/publish, Web resolver/SEO, migration of existing Hub content | P2 | CMS create/edit/publish/unpublish -> SSR Web, draft rejection, safe HTML, localized URLs and invalidation evidence |
| P4 — Catalog/search | Full CMS catalog/categories/variants/prices; public list/detail/search/tags (CRUD + migration landed 2026-11-10; variant editor and bulk tools are CAT-02) | P2; P3 resolver/site contract | CRUD -> public results, safe projection, SKU/variant invariants, cursor/locale/site tests |
| P5 — Commerce/CRM/customer portal | Customers, cart, checkout, orders/POS, quotations, payments boundary, stock reservation | P4 plus minimal inventory command core | Repricing, concurrency, duplicate-submit, ownership, order lifecycle and rollback tests |
| P6 — Inventory/purchasing/supplier portal | Warehouses, movement/transfer/stocktake, suppliers, purchase/receipt, serials, fulfillment | P5 domain contracts | Ledger reconciliation, partial receipts, concurrent stock operations, scoped supplier access |
| P7 — Finance/reporting | Payments/allocations/debts/ledger, reversals, financial reports | P5–P6 | Fixture totals reconcile; currency/date/permission/export tests; real gateway acceptance remains separate |
| P8 — HR/communications/operations | Staff/attendance/payroll, notification/mail/form delivery, providers, remaining imports/exports | P2 and relevant domain events | Privacy, approval, job retry/idempotency, provider failure and end-to-end workflows |
| P9 — Hardening and parity closure | Finish cache delivery, PWA, accessibility, SEO/performance, all customer build matrices, gap reconciliation | P3–P8 | Every required matrix row has evidence or explicit owner-approved deferral; no unresolved critical isolation or data integrity issue |
| P10 — Migration and launch | Dry-run, backups/restore, one-customer cutover, monitoring/rollback, expansion | P9 and explicit production authorization | Reconciliation + browser smoke + rollback evidence per customer; production launch separately approved |

P1/P2 contract research and pure-domain tests may proceed independently where safe. Do not launch private business mutations before the context prerequisite is met. Provider-dependent work may be blocked without blocking unrelated local domain development.

## First implementation slice

Start with P1, not additional Hub-backed business pages:

1. Read current `hubClient.ts`, auth handlers, generic proxy, shared session schemas and actual SDK methods.
2. Specify the BFF response union and verified-context contract; record missing Hub authority as a cross-repository issue, without fabricating a replacement endpoint.
3. Write isolated fixtures for login/TOTP/refresh/logout/app mismatch and proxy token leakage before replacing transport.
4. Introduce a request-isolated server adapter around `tm-hub-client`; keep tokens out of UI/SSR state.
5. Narrow allowed IAM operations, add CSRF and coordinate refresh according to the reviewed deployment strategy.
6. Run scoped tests, full applicable gates and browser checks; update queue and evidence. Do not claim authoritative revocation from current introspection.

P2 follows with a small local content/settings model and two-tenant test harness; do not start by copying every legacy schema at once.

## Vertical-slice execution order

For each parity row: inventory legacy behavior -> contract/state machine -> failing tests -> server model/service -> protected API -> UI/SSR -> migration fixture -> negative/security tests -> browser verification -> evidence update. Include loading/empty/error states and both locales in the same slice.

A layer refactor alone does not deliver a feature. A UI placeholder alone does not deliver a feature. A live provider is not required for pure-domain unit tests, but a stub does not certify that provider integration works.

## Phase evidence template

```text
Phase and parity IDs:
Source revision and dirty files:
Customer/environment (non-secret):
Legacy source inspected:
Target files and contracts:
Schema/migration changes:
Authorization and data-isolation checks:
Commands with exit codes and relevant output:
Browser scenarios and observed results:
Provider/live checks not run:
Status: PASS / FAIL / BLOCKED / PARTIAL
Remaining gap and next safe action:
```

Use PASS only for the named verified scope. Build gates, feature gates, migration readiness and launch readiness are separate. Update a failed or blocked result immediately; never carry forward a prior revision's PASS.

## External blockers and authorization

- Hub authoritative session/app/tenant entitlement semantics: external contract work; no permission to modify Hub is implied by these docs.
- Customer database credentials, provider configuration and production topology: owner-supplied, never extracted from legacy defaults.
- Production migration, seed, writes, deployment, DNS, publishing and commits: require explicit authorization for that action.
- Optional AI: separately scoped; does not replace the required legacy parity backlog.
