# Historical documentation archive v1

Archived on 2026-11-06 during the MongoDB-business / Hub-IAM documentation reset. **Read-only history; not the current source of truth.** Start at the [canonical v2 index](../../v2/README.md).

Seventeen original Markdown files were moved here with their repository-relative layout and byte contents preserved, including the pre-existing uncommitted report/task changes. [manifest.json](manifest.json) records original paths and SHA-256 digests. This archive does not endorse the correctness of historical claims, credentials guidance, URLs or PASS labels.

## Replacement map

| Archived original | Current replacement |
| --- | --- |
| `docs/TM-CMS-WEB-HUB-Blueprint-Index.md` | [v2 index](../../v2/README.md) and [ownership ADR](../../decisions/0001-rebuild-ownership.md) |
| `docs/TM-Shared-Packages-Architecture.md` | [Architecture](../../v2/02-architecture.md) and [data/API](../../v2/04-data-and-api.md) |
| `docs/TM-CMS-Project-Blueprint.md` | [Feature parity](../../v2/05-feature-parity.md), [UI](../../v2/06-ui-and-storefront.md), [roadmap](../../v2/07-delivery-roadmap.md) |
| `docs/TM-WEB-Project-Blueprint.md` | [Feature parity](../../v2/05-feature-parity.md) and [storefront policy](../../v2/06-ui-and-storefront.md) |
| `docs/TM-Hub-Tenant-App-Installation-Upgrade.md` | [Actual Hub/IAM contract and gaps](../../v2/03-hub-auth.md) |
| `docs/TM-Vercel-Multi-Customer-Layers-Build-Architecture.md` | [Architecture](../../v2/02-architecture.md) and [operations](../../v2/08-operations-and-verification.md) |
| `docs/YÊU CẦU ĐIỀU CHỈNH KIẾN TRÚC CUSTOMER LAYERS & VERCEL BUILD..md` | [Architecture](../../v2/02-architecture.md) |
| `docs/superpowers/specs/2026-11-02-tm-websites-scaffolding-design.md` | [Architecture](../../v2/02-architecture.md) |
| `docs/superpowers/plans/2026-11-02-tm-websites-scaffolding.md` | [Roadmap](../../v2/07-delivery-roadmap.md) |
| `docs/superpowers/plans/2026-11-04-next-work-plan.md` | [Roadmap](../../v2/07-delivery-roadmap.md) and [current queue](../../../tasks/todo.md) |
| `docs/superpowers/reports/2026-11-04-customer-build-verification.md` | Historical evidence only; [new baseline](../../v2/01-current-state.md) does not repeat its runtime PASS claims |
| `tasks/todo.md` | [Current queue](../../../tasks/todo.md) |
| `README.md` | [Root README](../../../README.md) |
| `AGENTS.md` | [Root AI instructions](../../../AGENTS.md) |
| `tm-cms/AGENTS.md`, `tm-web/AGENTS.md`, `tm-cms/.agents/AGENTS.md` | Their current same-named host instructions |

## Historical links

Internal document/task relationships retain their original relative tree where possible. Some originals already referenced missing or differently named documents, including `TM-CMS-TM-Web-Architecture-v2.2.md`, `nuxt4-cms.md` and `nuxt4-website.md`. Other original links pointed to source files relative to their old position; those are historical references, not maintained navigation.

Do not rewrite originals to repair those links: byte preservation is intentional. Use the replacement map and current source inventory for navigation. The documentation checker distinguishes active-document link failures from archived historical links; archived links are not represented as all valid.
