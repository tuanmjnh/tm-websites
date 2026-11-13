# 01 — Observed baseline

Reviewed on 2026-11-06 against commit `e76865ebda0ffb344378b40b88e3bd766fd3fa6a` plus pre-existing uncommitted changes. This was a read-only source review followed by documentation edits. No runtime, security exploitation, browser, migration or deployment checks were run in this reset.

**Update 2026-11-07:** a parallel implementation pass landed uncommitted CMS foundation code (verified-context gate, CSRF origin check, customer DB binding, health endpoint, content/category/media services with revisions, audit, idempotency). It is described in *Newly landed foundation* below as **observed source, not verified behavior**. It also adds `tasks/questions.md` with open decisions. None of it changes the ownership decision or removes the P1 verification prerequisite.

## Repositories and scope

| Source | Role in the rebuild |
| --- | --- |
| [tm-websites root](../../README.md) | Active implementation and documentation target |
| [Legacy CMS](../../../nuxt4-cms/package.json) | Read-only reference for administration, ERP and portals |
| [Legacy website](../../../nuxt4-website/package.json) | Read-only reference for storefront, content, search, cart and checkout |
| [TM Hub](../../../tm-hub/package.json) | IAM owner; changes require a separate authorized task |
| [TM Hub Client](../../../tm-hub-client/package.json) | SDK source/contract reference; not currently integrated into these hosts |

The [path inventory](source-inventory.json) records source candidates without opening environment files. It is not an exhaustive behavioral audit. Legacy documentation counts and screen labels must be reconciled against source per delivery slice.

## Newly landed foundation (2026-11-07, uncommitted, unverified)

| Area | Source | What it does | Not yet proven |
| --- | --- | --- | --- |
| Verified context | [context.ts](../../tm-cms/server/utils/context.ts) | `requireVerifiedContext` resolves `/me`, refreshes once on 401, fails closed, blocks mock mode outside development; `requireCapabilities` throws 403 | Authoritative revocation still unavailable from Hub; `/me` remains claim-based |
| CSRF | [csrf.ts](../../tm-cms/server/utils/csrf.ts) | Same-origin check via `Origin`, falls back to `Sec-Fetch-Site`; non-browser clients without either header pass | Depends on deployment host header correctness; no double-submit token |
| DB binding | [database.ts](../../tm-cms/server/utils/database.ts) | Registry decides database name; a disagreeing `TM_MONGO_DB` fails 503; per-binding connection pool via `createConnection` | No transaction topology tested; production URI still unspecified |
| Idempotency | [idempotency.ts](../../tm-cms/server/utils/idempotency.ts) | Request digest + stored result replay for retryable mutations | Concurrency across instances untested |
| Content domain | [contentService.ts](../../tm-cms/server/services/contentService.ts), [models](../../tm-cms/server/models), [admin API](../../tm-cms/server/api/v1/admin/content) | CRUD, state events, revisions/restore, bulk, history/audit | Browser flows, cache invalidation to Web, Hub→Mongo data migration |
| Category domain | [categoryService.ts](../../tm-cms/server/services/categoryService.ts), [categories API](../../tm-cms/server/api/v1/admin/categories) | Tree/list/create/update/delete with depth limit | Public renderers for category trees |
| Media domain | [mediaService.ts](../../tm-cms/server/services/mediaService.ts), [media API](../../tm-cms/server/api/v1/admin/media), [serve route](../../tm-cms/server/routes/media/%5B...key%5D.get.ts) | Metadata CRUD, upload/serve with MIME/size limits | Real provider credentials, virus/EXIF handling, CDN behavior |
| Public content | [content public API](../../tm-web/server/api/public/content), [public model](../../tm-web/server/models/contentPublic.ts) | Web reads published content from the same database | Full resolver parity, locale/SEO acceptance |
| Health | [health.get.ts](../../tm-cms/server/api/health.get.ts) | Reports `status/hub/database` without leaking URI/tenant | Monitoring integration |
| Contracts | [flow-contracts](../../tm-shared/packages/flow-contracts/src) | Admin content/category/media and public content Zod contracts | Contract tests for every new schema |

Test scripts exist under [scripts/build](../../scripts/build). As of 2026-11-08 they are `test-cms-iam`, `test-database-binding`, `test-content-model`, `test-content-service`, `test-category-service`, `test-media-service`, `test-bulk-service`, `test-audit-service`, `test-retention-service`, `test-settings-service`, `test-menu-service`, `test-web-content`, `test-web-content-db`, `test-web-cart`, `test-web-site`, `test-web-site-db`, `test-hub-contracts`, `test-layer-priority`, plus the operator command [prune-retention.ts](../../scripts/ops/prune-retention.ts).

**The documentation reset itself executed none of them.** Pass/fail claims come only from the dated slice records at the end of [05](05-feature-parity.md), each tied to one slice and one run; a script's presence is not a PASS and no slice's evidence certifies a later revision.

Open decisions blocking scope are recorded in [tasks/questions.md](../../tasks/questions.md): production MongoDB URI/database names, Hub session-revocation contract, whether Hub content may be exported, media provider choice, deploy ownership, AI scope. Until answered, the defaults in that file apply.

## Existing implementation

| Area | Observed evidence | Assessment against target |
| --- | --- | --- |
| Hosts | [CMS config](../../tm-cms/nuxt.config.ts), [Web config](../../tm-web/nuxt.config.ts) | SPA CMS and SSR Web already exist |
| Versions | [CMS package](../../tm-cms/package.json), [Web package](../../tm-web/package.json) | Declared Nuxt `^4.6.4`, UI `^4.12.0`; actual installed versions must be taken from the lockfile/environment |
| Layers | [resolver](../../tm-shared/customer-layers/registry/resolver.ts) | Customer-first, app-base, api-base, config-base, core-base already selected explicitly |
| Shared packages | [packages](../../tm-shared/packages) | `@tm/flow-contracts`, `@tm/flow-config`, `@tm/flow-utils`, `@tm/design-system`; do not invent renamed packages |
| Auth | [CMS auth handlers](../../tm-cms/server/api/auth), [handwritten client](../../tm-cms/server/utils/hubClient.ts) | Login/refresh/logout/session/TOTP exist; SDK adapter and stronger context validation remain target work |
| Generic proxy | [Hub proxy](../../tm-cms/server/api/hub/%5B...path%5D.ts) | Broad sanitized `/api/v1` forwarding returns raw upstream bodies; not a narrow IAM allowlist |
| CMS pages | [base pages](../../tm-shared/nuxt-layers/cms-base/app/pages) | IAM and several Hub-backed business pages exist; ERP placeholders are not parity |
| Business ownership | [useHubAdmin](../../tm-shared/nuxt-layers/cms-base/app/composables/useHubAdmin.ts) | Content, configuration, media, mail, notifications and connections still use Hub; migrate them to local business services |
| Catalog | [Mongo connection](../../tm-web/server/utils/mongo.ts), [read models](../../tm-web/server/models/catalog.ts) | Web-only Mongo reader exists; loose legacy-compatible schemas are not shared validated write models |
| Web content/config | [publicContent](../../tm-web/server/utils/publicContent.ts), [hubPublicConfig](../../tm-web/server/utils/hubPublicConfig.ts) | Still read Hub public resources; replace with MongoDB-backed services |
| Web routes | [base pages](../../tm-shared/nuxt-layers/web-base/app/pages) | Home, products, categories and catch-all exist; full search/cart/checkout/portal parity remains open |
| Cache | [catalogCache](../../tm-web/server/utils/catalogCache.ts), [purge](../../tm-web/server/api/_internal/purge.post.ts) | Database/path cache key and shared-secret purge exist; purge scans handler cache, not durable tenant/site-tag delivery |
| PWA | [worker](../../tm-web/service-worker/sw.ts), [Web config](../../tm-web/nuxt.config.ts) | Verified on a production build in a real browser (2026-11-12): installs and controls the page, serves `offline.html` for offline navigations, caches no API response and no SSR document, and swaps its precache on a second build — including across a closed browser session — without a manual unregister. Untested: install-to-home-screen UI, a check that a build cannot ship another customer's assets, and any CMS-side offline worker |

## Customer matrix observed in registry

[Registry](../../tm-shared/customer-layers/registry/customers.ts) remains the authority; this table is a dated summary, not a second editable registry.

| Customer | CMS | Web | Declared Mongo database |
| --- | --- | --- | --- |
| default | Enabled | Enabled | Not declared |
| sentuan | Enabled | Enabled | `sen-tuan` |
| bagpost | Enabled | Enabled | `bag-post` |
| thanhtung | Enabled | Not enabled | Not declared |
| hoangvi | Enabled | Not enabled | Not declared |

A registry database name does not prove the database is provisioned, its credentials are restricted, or its schema is compatible. CMS-only customers still need their own business database binding before business modules can launch.

## Gaps that change implementation order

1. Establish trustworthy IAM context and narrow the BFF before enabling private MongoDB business operations. Do not claim tenant membership from configured `tenantId` alone.
2. Introduce validated shared server-side business models/invariants; current catalog readers must not become write schemas accidentally.
3. Move Hub-backed business modules deliberately, including existing content/config records. Availability of Hub business APIs is not a reason to keep them as target owners.
4. Restore the full feature surface in [the parity matrix](05-feature-parity.md), not only current top-level placeholder routes.
5. Treat purge delivery, PWA cache isolation, checkout repricing, legacy data mapping and provider integration as separate acceptance gates.

## Historical evidence and exclusions

Old reports and the previous task queue were preserved in [the archive](../archive/v1/INDEX.md). Their past build/browser claims were not independently repeated here and do not certify this dirty checkout. Existing code, lockfile and asset changes were not discarded or committed by this reset.

No live Hub endpoints, provider services, customer data or production credentials were needed. This review is not a comprehensive security audit; source-grounded IAM concerns are implementation prerequisites in [03](03-hub-auth.md), not newly reproduced exploit findings.
