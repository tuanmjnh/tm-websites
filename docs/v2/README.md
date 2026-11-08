# TM Websites — Canonical documentation v2

Effective date: **2026-11-06**. Scope: the full reconstruction of `nuxt4-cms` and `nuxt4-website`, not only the current catalog MVP.

The user-selected boundary is fixed: **Nuxt 4 layers + Nuxt UI 4; TM Hub and tm-hub-client for identity/authentication/authorization; tm-websites and MongoDB for all business domains.** Implementation details below are a target specification unless explicitly described as observed source. This reset authorizes documentation, not application changes, Hub changes, deployment or data migration.

## Reading order

| Document | Purpose |
| --- | --- |
| [01 — Observed baseline](01-current-state.md) | What exists now, evidence, mismatches and limits of this review |
| [02 — Architecture](02-architecture.md) | Ownership, layer composition, package boundaries, customer/site model |
| [03 — Hub/IAM integration](03-hub-auth.md) | Actual SDK/API contracts, target BFF and unresolved authorization prerequisites |
| [04 — MongoDB and APIs](04-data-and-api.md) | Shared domain invariants, data model, command/query separation, migration |
| [05 — Feature parity](05-feature-parity.md) | Full CMS/ERP, website and portal backlog with acceptance criteria |
| [06 — UI and storefront](06-ui-and-storefront.md) | Nuxt UI 4, i18n, accessibility, SEO, cache and PWA requirements |
| [07 — Delivery roadmap](07-delivery-roadmap.md) | Ordered phases, dependencies and completion gates |
| [08 — Operations and verification](08-operations-and-verification.md) | Existing commands, configuration, build matrix and safe validation |
| [09 — AI execution contract](09-ai-execution.md) | How an agent selects, implements and verifies a vertical slice |
| [10 — Documentation verification](10-documentation-verification.md) | Evidence and limitations of this documentation reset |
| [11 — Target module layout](11-target-module-layout.md) | Planned package/folder/API/test conventions per domain |
| [12 — Legacy domain specs](12-legacy-domain-specs.md) | Extracted routes, models, enums, invariants and known defects from both legacy projects |
| [ADR 0001](../decisions/0001-rebuild-ownership.md) | User-selected ownership decision and consequences |
| [Source inventory](source-inventory.json) | File-path inventory for legacy and target modules; not behavior verification |
| [Legacy feature paths](legacy-feature-paths.json) | Path-only list of legacy pages/APIs/models/services (635 CMS, 219 website files) |
| [Current work queue](../../tasks/todo.md) | The single current implementation queue |

## Source-of-truth rules

1. The user's current request and applicable `AGENTS.md` instructions govern the task. This index is the canonical documentation entry point.
2. Source code is evidence of current implementation, not proof that a requirement is satisfied. Target requirements are not evidence of implemented behavior.
3. The [v1 archive](../archive/v1/INDEX.md) contains superseded documents unchanged. Its old plans, paths, PASS labels and Hub-business assumptions are historical only.
4. Each feature must trace to legacy source, target contracts/services/UI and fresh tests before completion. Raw route/model counts are not a parity measure.
5. Do not maintain a second active roadmap in archived superpowers files. Update the current queue and the relevant v2 document after each phase.
6. Re-read current source before acting on this dated baseline. The reviewed checkout was dirty; later changes may invalidate individual observations.

## Status vocabulary

- **Observed**: source exists and was inspected; runtime behavior may be untested.
- **Partial**: only part of the intended capability exists, or it uses the wrong owner.
- **Planned**: required target work, not claimed as implemented.
- **Blocked**: a named external contract, decision or safe test environment is missing.
- **Verified**: a specific command/scenario passed on an identified revision and environment, with retained non-secret evidence.

A screen, a dependency or a passing source-regex test alone cannot move a feature to Verified. The entire product remains **in progress**.
