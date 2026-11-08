# 09 — AI execution contract

## Before editing

1. Read root and applicable host `AGENTS.md`, then [the canonical index](README.md), [baseline](01-current-state.md), [architecture](02-architecture.md), [IAM](03-hub-auth.md), [data](04-data-and-api.md), the relevant [parity rows](05-feature-parity.md) and [current queue](../../tasks/todo.md).
2. Check git status and current source. Do not overwrite existing code/asset/lockfile work. The reset's baseline is dated and was taken from a dirty checkout.
3. Select one vertical slice from the earliest unblocked phase. Identify exact legacy routes/APIs/models and actual target files before writing an implementation plan.
4. Classify each statement as current source, target requirement, historical evidence or unresolved assumption. Never convert one category into another without evidence.
5. Verify SDK exports, permission names, provider methods, Nuxt aliases and component APIs. Do not invent endpoints or infer behavior from README examples.

## Non-negotiable ownership

Only identity/authentication/authorization uses Hub. All business modules use tm-websites/MongoDB and locally owned provider adapters. Do not add more content/config/media/mail/notification business forwarding to Hub because an endpoint already exists there.

Do not rebuild local password/JWT/role authority from the legacy projects. Do not treat customer registry, menu visibility, UI capability helpers, browser headers or database selection as proof of authorization.

## Implementation discipline

- Use the relevant skills and approved task workflow. Apply test-first changes to behavior, then test the actual UI in a browser for frontend work.
- Reuse existing packages/components; keep public/admin DTOs and queries distinct. Do not create placeholder abstractions or duplicate a schema per host.
- Respect Nuxt 4 `app/`, `server/`, `shared/` boundaries and customer-first priority. Read generated aliases when a layer-local import is ambiguous.
- Keep both vi/en translations, loading/empty/error/forbidden states and accessibility in scope.
- Port business behavior and data compatibility, not legacy development auth bypasses, embedded credentials, broad Mongo filters or client-calculated order totals.
- Limit edits to the approved slice. Sibling legacy projects are read-only references. Hub/client changes require their own authorized scope.
- Avoid adding code comments; use clear names. Document non-obvious architectural decisions here rather than narrating tasks inside code.

## Evidence before completion

Run applicable commands from [08](08-operations-and-verification.md), capture exit status and inspect output, then perform feature-specific negative tests and browser scenarios. A compile, route skeleton, dependency entry or historical screenshot is not feature completion.

After every slice update the current queue and parity row with source revision, target files, exact commands, scenarios and remaining gaps. Use PASS/FAIL/BLOCKED/PARTIAL for a named scope only. If browser, provider or migration checks could not run, state that explicitly.

Do not edit archived documents to make old claims match the new direction. Add current evidence to the current queue or a new dated report linked from it; retain old history unchanged.

## Permission boundaries

Ordinary local scoped implementation/tests are not permission for commits, pushes, deployments, paid provider actions, database migration/seed/reset, real email/push, production writes or copying secrets. Ask for explicit authorization before those actions. Never bypass hooks, signing, validation or security checks to close a phase.

When blocked, continue independent safe work if possible and record the exact dependency. For private business authorization, fail closed; do not invent tenant membership or use a UI-only permission check as a fallback.

## Definition of done for the product

All required legacy parity rows have implemented flows and fresh evidence; customer/app/site and portal isolation are tested; money/stock invariants reconcile; existing data/URLs have a tested migration path; provider behavior is verified or explicitly excluded by the owner; per-customer builds and browser smoke pass; backups, rollback and operational monitoring are demonstrated. Documentation completion alone does not satisfy this definition.
