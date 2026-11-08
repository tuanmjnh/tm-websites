# TODO — TM Websites current queue

> Canonical documentation: [`docs/v2/README.md`](../docs/v2/README.md) · Execution contract: [`docs/v2/09-ai-execution.md`](../docs/v2/09-ai-execution.md) · Ownership: [ADR 0001](../docs/decisions/0001-rebuild-ownership.md)
>
> This is the single active queue. Phase definitions live in [`07-delivery-roadmap.md`](../docs/v2/07-delivery-roadmap.md); scope lives in [`05-feature-parity.md`](../docs/v2/05-feature-parity.md). The v1-era record at the bottom is evidence only, not a plan.
>
> Open decisions and environment blockers for the owner: [`questions.md`](questions.md). Unanswered questions do not stop the slices recorded here.

## Phase status

| Phase | Deliverable | Status |
| --- | --- | --- |
| P0 | Documentation reset (v2 docs, ADR, archive) | Done — links verified, no application PASS implied |
| P1 | IAM contract and BFF | **In progress** — P1.a (adapter/CSRF/proxy) and P1.b (verified-context gate) landed |
| P2 | Business foundation (trusted DB binding, shared models, audit/idempotency) | **In progress** — tenant-bound DB binding, validated model, migrations v1–v3, content audit and idempotent retries landed |
| P3 | Content/media/site vertical slice on MongoDB | **In progress** — CMS content module with audit, retry safety and revision diff/restore runs on MongoDB; Web reads the same collection for pages and the `/bai-viet` listing; media library with local storage, uploads and content attachments (P3.e); bulk publish/archive/delete with per-row results (P3.f); Web discovery with tag/category landing pages and bounded public search (WEB-02); unified public search page over content and products (WEB-04); crawl policy with robots.txt and a sitemap covering tag/category pages (WEB-08); client-owned cart with server-side re-quoting (WEB-05) |
| P4 | Catalog/search | Planned |
| P5–P10 | Commerce/CRM, inventory/purchasing, finance, HR/comms, hardening, migration | Planned |

## P1 — IAM contract and BFF

### Landed: slice P1.a (2026-11-06)

| Item | Target files |
| --- | --- |
| Server-only SDK adapter, built per request, replaces the handwritten `$fetch` transport | `tm-cms/server/utils/hubClient.ts` (depends on `tm-hub-client@1.0.9`) |
| App-binding rejection: a Hub session carrying another `appId` fails as `APP_MISMATCH` (403) instead of being relabelled | same |
| Same-origin CSRF guard on every cookie-authenticated mutation (login, TOTP, refresh, logout, proxy writes) | `tm-cms/server/utils/csrf.ts`, `tm-cms/server/api/**` |
| Generic Hub proxy refuses `/api/v1/auth/**` so raw Hub tokens can never reach the browser | `tm-shared/packages/flow-utils/src/hub.ts` (`isHubProxyPathDenied`), `tm-cms/server/api/hub/[...path].ts` |
| Contract/unit suite for mapping, login/TOTP discriminants, refresh, proxy policy and CSRF | `scripts/build/test-cms-iam.ts` (`pnpm test:iam`, 27 checks) |

Behavioral notes:

- Tokens stay in HttpOnly cookies; the session DTO still carries no tokens. The SDK instance lives only for one request, so its permission/refresh cache cannot cross users.
- TOTP still uses the discriminated result (`totpRequired` + `pendingTotpToken`) because the SDK login type overstates token presence.
- The proxy denial is a policy check on the already-sanitized path; business paths (`/api/v1/apps/*`, content, mail, media) keep working unchanged.

### Evidence

Environment: local `tm-hub` on `:4000` (`db: ok`), CMS dev on `:4005`, customer `sentuan`, revision = working tree at 2026-11-06 (uncommitted).

| Command / scenario | Result |
| --- | --- |
| `pnpm test:iam` | 33/33 checks pass |
| `pnpm test:db` | 8/8 checks pass, including live isolation of two databases on local MongoDB 8.2.3 |
| `pnpm test:content` | 42/42 checks pass (25 model/invariant + 17 live service), including unique `(siteId, key)`/`(siteId, locale, slug)` indexes, idempotent preparation, revision conflict, schedule/publish windows and cursor pagination on local MongoDB 8.2.3 |
| `pnpm test:hub` | 28/28 checks pass |
| `pnpm test:layers`, `pnpm test:web-content`, `pnpm validate:registry`, `pnpm verify:scaffold` | all exit 0 (scaffold 145/145) |
| `GET /api/health` (dev, no Mongo env) | `{ status: ok, hub: configured, database: unconfigured }` |
| `GET /api/health` (dev with `TM_MONGO_URI` + `TM_MONGO_DB=sen-tuan`) | `{ status: ok, hub: configured, database: ok }` |
| `pnpm --dir tm-shared run typecheck` | exit 0 |
| `pnpm typecheck` (recursive) | exit 0 |
| `pnpm lint` (recursive, after final Nuxt prepare) | exit 0 |
| `TM_CUSTOMER_ID=sentuan pnpm validate:build:cms` | PASS |
| `TM_CUSTOMER_ID=sentuan pnpm build:cms` | Build complete in 28.7s |
| `POST /api/auth/login` (no Origin, Hub credentials) | 200, `appId=app_sentuan_cms`, 54 permissions |
| `POST /api/auth/login` with `Origin: https://evil.test` | 403 `CSRF_ORIGIN_MISMATCH` |
| `GET /api/auth/session` with cookies | 200, same user/app |
| `GET /api/hub/api/v1/auth/refresh` with cookies | 403 `PROXY_PATH_FORBIDDEN` |
| `GET /api/hub/api/v1/apps/app_sentuan_cms/users` with cookies | 200, `success: true` |
| Browser: login form on `:4005` → `/` | Control Center renders, console clean |

### Landed: slice P1.b (2026-11-06)

| Item | Target files |
| --- | --- |
| One context gate for private endpoints: session from cookies, refresh-once on 401, cookie rotation, fail-closed errors | `tm-cms/server/utils/context.ts` (`resolveSession`, `requireVerifiedContext`, `requireCapabilities`) |
| Session endpoint now delegates to that gate instead of duplicating refresh logic | `tm-cms/server/api/auth/session.get.ts` |
| Mock auth is refused outside development (`AUTH_MODE_FORBIDDEN`, 503) | `tm-cms/server/utils/context.ts` |
| 6 more unit checks (refresh-once, expiry, app mismatch not retried, Hub outage, mock policy) | `scripts/build/test-cms-iam.ts` (33 total) |

### Landed: slice P2.a (2026-11-06)

| Item | Target files |
| --- | --- |
| Tenant-bound database binding: registry owns the database name, `TM_MONGO_DB` may only repeat it, URI/name validated | `tm-cms/server/utils/database.ts` (`resolveDatabaseBinding`) |
| Connection cache keyed by binding, so two tenants can be served in one process without swapping a global connection | `tm-cms/server/utils/database.ts` (`connectDatabase`, `closeDatabaseConnections`) |
| Server-only runtime config (`mongoUri`, registry `mongoDbName`, `mongoDbOverride`) — never public | `tm-cms/nuxt.config.ts` |
| Secret-free readiness endpoint that exercises Hub config and the DB binding | `tm-cms/server/api/health.get.ts` |
| Live two-database isolation test (creates, verifies, drops two disposable DBs) | `scripts/build/test-database-binding.ts` (`pnpm test:db`, 8 checks) |

Deliberate limits of P2.a: no shared model package yet, no schema validation, no audit/idempotency collections, no replica-set transaction test. Those stay P2/P3.

### Landed: slice P2.b (2026-11-06)

| Item | Target files |
| --- | --- |
| Validated content model: types/statuses, normalized keys and slugs, locale entries, tags/attributes, publish window, schema version | `tm-cms/server/models/content.ts` |
| Publication invariants as a pure state machine (publish/schedule/unpublish/archive/restore/delete, revision bump, deleted records restorable only through draft) | same (`applyContentTransition`) |
| Public projection allowlist: published records inside their window only, no status/revision/actor fields | same (`isPubliclyVisible`, `toPublicContent`) |
| Per-connection model registration and index creation (`createIndexes()`, never `syncIndexes()`) | same (`contentModel`, `syncContentIndexes`) |
| Migration-version records with id/version/checksum, conflict instead of silent re-run, apply-then-record order | `tm-cms/server/models/migrations.ts` |
| One preparation step per connection (migrations + models), cached, failed preparation not cached; endpoint helper `withPreparedDb` | `tm-cms/server/utils/modelRegistry.ts` |
| Pure + live suite (normalization, transitions, projection, planning, unique indexes, idempotent re-run) | `scripts/build/test-content-model.ts` (`pnpm test:content`, 25 checks) |

Deliberate limits of P2.b: no HTTP endpoints and no CMS editor yet (that is P3), no rich-format renderers, no revision-history collection, no optimistic-concurrency check against `revision` in a command path, no audit/idempotency collections, single-node MongoDB only (no transaction test). The model lives in `tm-cms/server` because Q11 (shared package naming) is unanswered; Web keeps its loose reader until P3.

### Landed: slice P3.a — CMS content module (2026-11-06)

| Item | Target files |
| --- | --- |
| Content commands/queries: list with cursor + status buckets, create, get, update with `revision` concurrency, publication events, public read | `tm-cms/server/services/contentService.ts` |
| Admin API v1: `GET/POST /api/v1/admin/content`, `GET/PATCH /:id`, `POST /:id/events` — verified context, `content.read`/`content.write`, same-origin mutations, `no-store` | `tm-cms/server/api/v1/admin/content/**`, `tm-cms/server/utils/contentApi.ts`, `tm-cms/server/utils/site.ts` |
| Shared admin DTO (enums, locale/record schemas, draft payload) | `tm-shared/packages/flow-contracts/src/content-admin.ts` |
| CMS UI rewritten on Mongo content: status/format filters + search + load more, locale tabs (vi/en), slug/title/excerpt/body/SEO, publish window, row actions, detail modal, schedule modal, delete confirm | `tm-shared/nuxt-layers/cms-base/app/pages/content.vue`, `.../composables/useContentAdmin.ts`, `tm-cms/i18n/locales/{vi,en}.json` |
| Site id from deployment config only (`TM_SITE_ID` else registry customer) | `tm-cms/nuxt.config.ts`, `tm-cms/server/utils/site.ts` |
| Live service suite (17 checks) added to `pnpm test:content` (42 total with the model suite) | `scripts/build/test-content-service.ts` |

Verified in browser on `:4005` (customer `sentuan`): create → edit → publish → unpublish → schedule → archive → restore → delete → restore, with counts and revision moving as expected; cross-origin mutation rejected 403, stale revision rejected 409 (API smoke).

Still missing in P3: category tree, richer editorial formats, media attachments, revision history, audit/idempotency (P2.c).

### Still open in P1 (do not mark P1 complete)

- [ ] Narrow the proxy further: replace broad business forwarding with per-module allowlisted routes as each domain migrates (P3+).
- [ ] Coordinate refresh rotation across concurrent tabs and instances; the current BFF refreshes per request.
- [ ] CSRF hardening beyond origin matching (double-submit or token binding), and decide the policy for clients that send neither `Origin` nor `Sec-Fetch-Site`.
- [ ] Web portal auth BFF (no auth handlers exist in `tm-web` yet).
- [ ] **Blocked (cross-repo):** authoritative session/revocation and tenant/site entitlement contract from Hub. Until then no claim of immediate revocation, and `tenantId` in the session DTO is still deployment-configured rather than membership-proven.

### P3.b — Web public content read (landed 2026-11-07)

| Slice | Evidence |
| --- | --- |
| Web reads the customer `content` collection directly (no Hub, no admin API): `withSiteDb`, public projection/guard, locale fallback, key-or-slug resolution | `tm-web/server/models/contentPublic.ts`, `tm-web/server/utils/publicContent.ts`, `tm-web/server/api/public/content/[...slug].get.ts` |
| Shared public DTO (subpath `@tm/flow-contracts/content-public`): `PublicContentSchema`, `normalizePublicLocale`, `PUBLIC_CONTENT_BODY_FORMATS`, `PublicContentEntrySchema` | `tm-shared/packages/flow-contracts/src/content-public.ts` |
| Storefront rendering from the DTO, with sanitized HTML / safe Markdown / plain text per locale `format` | `tm-shared/nuxt-layers/web-base/app/pages/[...slug].vue`, `.../components/WebContentBody.vue` |
| Sitemap built from published records only, locale-free URLs, `lastmod` from `updatedAt` | `tm-web/server/routes/sitemap.xml.ts` |
| CMS editor picks the body format per locale (Markdown / HTML / Plain text), with a format-specific placeholder | `tm-shared/nuxt-layers/cms-base/app/pages/content.vue`, `tm-cms/i18n/locales/{vi,en}.json` |
| Suites: `pnpm test:content` 42, `pnpm test:web-content` 24 contract + 12 live reader checks, `pnpm test:layers`, typecheck cms/web/shared, CMS lint, `validate:build:cms`, `build:cms` | `scripts/build/test-web-content.ts`, `scripts/build/test-web-content-db.ts` |

Verified over HTTP/browser on `:4005` + `:4006` (`sentuan`): published record `200` by key and by slug, draft `404`, `?locale=en` fallback `200` with `Content-Language: vi`, sitemap listing only the published record, and the format select driving real HTML/Markdown rendering (record restored to `format: html` afterwards). Doc record: [05-feature-parity.md](../docs/v2/05-feature-parity.md).

Still open in P3.b: `format: text` not exercised in the browser, no purge/revalidation hook (30s TTL only), no Hub content export (Q5).

### P3.c — revision snapshots, diff and restore (landed 2026-11-07)

| Slice | Evidence |
| --- | --- |
| Every content mutation stores one immutable snapshot of the editable fields (unique site/content/revision) | `tm-cms/server/models/revision.ts`, `tm-cms/server/services/contentRevisions.ts`, migration `content-revision-indexes` v3 |
| Read revisions and one snapshot with a field-level diff to the current record | `GET /api/v1/admin/content/:id/revisions`, `GET .../revisions/:revision` |
| Restore an earlier snapshot as a new revision, audit action `revert`, publication state untouched | `POST .../revisions/:revision/restore`, `restoreContentRevision` in `tm-cms/server/services/contentService.ts` |
| CMS modal lists versions with View/Restore and a diff + snapshot preview | `tm-shared/nuxt-layers/cms-base/app/pages/content.vue`, `.../composables/useContentAdmin.ts`, `tm-cms/i18n/locales/{vi,en}.json` |
| Suites: `pnpm test:content` 26 live service checks (snapshots per mutation, newest-first list, site scope, restore writes revision + `revert` audit, stale/current/unknown rejection) | `scripts/build/test-content-service.ts` |

Verified over HTTP on `:4005`: create + edit produced `[update v2, create v1]`; the v1 detail diff showed `locales`/`tags`; restoring v1 produced revision 3 with the original title/body and a `Reverted to version` activity entry; the CMS versions panel and preview modal rendered correctly. Probe rows were removed.

Still open in P3.c: no backfill of snapshots for records created before this slice, no retention policy for `content_revisions`, no restore preview/confirmation step, and no bulk revision actions.

### P3.d — public content listing + `/bai-viet` (landed 2026-11-07)

| Slice | Evidence |
| --- | --- |
| `GET /api/public/content` with type/tag/category facets, `newest|oldest`, `_id` cursor and no body in the projection | `tm-web/server/api/public/content/index.get.ts`, `tm-web/server/utils/publicContent.ts`, `tm-web/server/models/contentPublic.ts` |
| Same publish policy and locale fallback as a single record (requested locale, then `vi`) | `buildPublishedListFilter` + `contentLocaleCandidates` |
| Storefront listing page with tag/category filter chip, cards and load-more | `tm-shared/nuxt-layers/web-base/app/pages/bai-viet/index.vue`, `tm-web/i18n/locales/{vi,en}.json` |
| Contracts for the listing row and envelope | `PublicContentListItemSchema`, `PublicContentListSchema` in `@tm/flow-contracts/content-public` |

Verified on `:4006`: only published records returned; `tag=about` → 1 row, `tag=missing` → empty; `type=bogus` and a malformed cursor → `422`; `limit=2` pages were `[tin-c, tin-b]` then `[tin-a, gioi-thieu]` with exact `nextCursor`; `/bai-viet` rendered 4 cards and `?tag=huong-dan` narrowed to one with the filter chip. Demo posts were removed afterwards.

Still open in P3.d: no tag/category landing pages (only query filters), no search, no cache purge on publish (30s/300s TTL only), and the listing is not on the home page yet.

### P3.e — category tree (landed 2026-11-07)

| Slice | Evidence |
| --- | --- |
| Site-scoped category tree: immutable normalized `key`, `parent` as a key, `order` 0–9999, per-locale `{ name, slug }`, depth ≤ 5 | `tm-cms/server/models/category.ts`, `tm-cms/server/services/categoryService.ts`, migration `category-indexes` v4 |
| Admin API `GET`/`POST /api/v1/admin/categories`, `PATCH`/`DELETE /api/v1/admin/categories/:id` with the content capabilities | `tm-cms/server/api/v1/admin/categories/*`, `tm-cms/server/utils/contentApi.ts` (error mapping) |
| Delete only when the category has no children and no content uses the key; optimistic lock via `revision`; one `audit_logs` entry per mutation (`resourceType: category`) | `deleteCategory`, `updateCategory`, `recordContentAudit` |
| DTOs shared by CMS and future Web filters | `@tm/flow-contracts/category-admin` (`AdminCategorySchema`, `AdminCategoryNodeSchema`, `AdminCategoryDraftSchema`, `ADMIN_CATEGORY_MAX_DEPTH`) |
| CMS `/categories` tree page (indent, add child, edit, delete with inline guard) plus nav entry gated on `content.read` | `tm-shared/nuxt-layers/cms-base/app/pages/categories.vue`, `.../composables/useCategoryAdmin.ts`, `.../layouts/default.vue`, `tm-cms/i18n/locales/{vi,en}.json` |
| Content editor picks categories from that tree instead of typing comma-separated text | `tm-shared/nuxt-layers/cms-base/app/pages/content.vue` (`loadCategoryOptions`, `USelectMenu`) |
| Suites: `pnpm test:categories` 11 live service checks | `scripts/build/test-category-service.ts` |

Verified over HTTP/browser on `:4005`: `trang-suc` + child `nhan` created through the UI, the child rendered indented and an edit moved it to `Order: 3 · Revision 2`; deleting the parent returned `409 CATEGORY_HAS_CHILDREN` with the reason shown inside the dialog; deleting the child then the parent restored the empty state. The content editor's picker listed the tree and saved `categories: ["trang-suc"]` on a probe record (`revision 2`). Probe content, its revisions/audit rows and the test categories were removed afterwards.

Still open in P3.e: no media attachments yet, no drag-and-drop ordering, no tag management, no bulk move/delete, and the storefront has no category landing pages.

### P3.e (rest) — media library + attachments (landed 2026-11-07)

| Slice | Evidence |
| --- | --- |
| `media` collection (site, folder, storage key, MIME, size, checksum, kind, title/alt, revision, uploader) with unique `(siteId, storageKey)`; bytes live on the storage adapter, never in Mongo | `tm-cms/server/models/media.ts`, migration `media-indexes` v5 |
| Storage adapter: root from `TM_MEDIA_DIR` (default `.data/media`), key `<site>/<yyyy>/<uuid>.<ext>`, path-traversal guard, checksum | `tm-cms/server/utils/mediaStorage.ts` |
| Upload allowlist png/jpeg/webp/avif/gif/pdf, 5 MB, extension derived from MIME, `originalName` sanitized to display metadata | `assertUploadAllowed`, `mediaStorageKey`, `sanitizeOriginalName` |
| Admin API `GET`/`POST /api/v1/admin/media`, `PATCH`/`DELETE /api/v1/admin/media/:id`; delete refused while content still references the id (`422 MEDIA_IN_USE`) | `tm-cms/server/api/v1/admin/media/*`, `tm-cms/server/services/mediaService.ts` |
| Public byte route `GET /media/<site>/<yyyy>/<uuid>.<ext>` with `nosniff`, `immutable` caching, cross-origin embedding and a site check | `tm-cms/server/routes/media/[...key].get.ts` |
| Content records carry `media` ids through draft, revision snapshot, restore and `changedFields`; new `audit_logs` resource type `media` | `tm-cms/server/models/content.ts`, `contentRevisions.ts`, `contentAudit.ts`, `audit.ts` |
| Shared DTOs and upload limits | `@tm/flow-contracts/media-admin` |
| CMS `/media` library: multi-file upload with inline errors, debounced search, kind/folder filters, counts, thumbnail grid, copy URL, edit/delete dialogs, load more | `tm-shared/nuxt-layers/cms-base/app/pages/media.vue`, `.../composables/useMediaAdmin.ts` |
| Content editor: searchable media picker replaces the free-text attachments field; attached files listed in the detail view | `tm-shared/nuxt-layers/cms-base/app/pages/content.vue` |
| Suites: `pnpm test:media` 11 live service checks | `scripts/build/test-media-service.ts` |

Verified on `:4005`: upload → `201` (`folder: landing/hero`, `key: sentuan/2026/<uuid>.png`), the served URL returned identical bytes with `image/png` + `immutable` + `nosniff` + `cross-origin`, `PATCH` → `revision 2`, list `meta` carried `{ all, image, document }` and `["landing/hero"]`. In the browser the library rendered the thumbnail, upload through the page's input appeared without a reload, the edit dialog saved a new title/alt, and the content editor's picker saved `media` on `pages/dich-vu`. Deleting the attached file returned `422 MEDIA_IN_USE` with the reason shown in the dialog. Probe media, their bytes, the attachment and the media/content audit + revision rows were removed afterwards.

Still open in the media slice: no provider adapter (local disk only), no image transforms or stored dimensions, no folder tree or move-batch, no idempotency for multipart uploads, no inline upload from the rich-text body, and the storefront projection does not expose media yet.

### P3.f — bulk content actions (landed 2026-11-07)

| Slice | Evidence |
| --- | --- |
| One request per action (`publish`/`archive`/`delete`) over 1–50 `{ id, revision }` items, answered as per-row results (`200` + `succeeded`/`failed`) | `tm-cms/server/services/contentBulk.ts` (`runBulkContentCommand`, `BULK_MAX_ITEMS`), `tm-cms/server/api/v1/admin/content/bulk.post.ts` |
| Every row reuses the single-record command, so it keeps its own optimistic lock, audit entry and revision snapshot; a bad row never rolls back the others | `tm-cms/server/services/contentService.ts`, `contentAudit.ts`, `contentRevisions.ts` |
| Shared request/result DTOs | `@tm/flow-contracts/content-admin` (`AdminContentBulkRequestSchema`, `AdminContentBulkAction`, `AdminContentBulkRow`, `AdminContentBulkResult`) |
| CMS list: select-all bar, per-row checkbox, action dialog with confirm text and a per-row failure list | `tm-shared/nuxt-layers/cms-base/app/pages/content.vue`, `.../composables/useContentAdmin.ts`, `tm-cms/i18n/locales/{vi,en}.json` |
| Suite: `pnpm test:bulk` 9 live checks (mixed outcomes, duplicate id, foreign id, per-row audit/revision, retry, request cap) | `scripts/build/test-bulk-service.ts` |

Verified over HTTP on `:4005`: publishing two drafts returned `200` with `succeeded: 2`; resending the same items at their old revisions returned `200` with `failed: 2` and `CONTENT_REVISION_CONFLICT` on each row; `schedule` with no items returned `422 CONTENT_BULK_INVALID`. In the browser the select-all bar enabled the actions only for a real selection, archiving two records reported `Processed 2/2 records` and cleared the selection, and a run over an already-archived record reported `Processed 0/1 records` with that row's reason. The select-all run also covered the two demo records, which were restored by hand afterwards (including the post's `publishedAt`, reset to the restore time because the soft delete had cleared it).

Still open in P3.f: bulk is limited to the loaded page (no "all matching the filter"), no bulk schedule or shared-field edit, no undo, no media batch move/delete, and no import/export or background job runner.

### WEB-02 — discovery landing pages + public search (landed 2026-11-07)

| Slice | Evidence |
| --- | --- |
| Tag landing `/tag/<tag>` and content-category landing `/danh-muc/<slug>`, with breadcrumbs, empty/error states and load-more | `tm-shared/nuxt-layers/web-base/app/pages/tag/[tag].vue`, `.../pages/danh-muc/[slug].vue`, `.../components/WebContentList.vue` |
| Bounded literal search (`q` ≤80) over title/slug/excerpt/key, combined with the existing type/tag/category facets and publish policy | `tm-web/server/models/contentPublic.ts` (`escapePublicSearchTerm`), `tm-web/server/api/public/content/index.get.ts`, `.../pages/bai-viet/index.vue` |
| Category slug → immutable key resolution with `vi` fallback; unknown slug `404` | `tm-web/server/models/contentCategoryPublic.ts`, `tm-web/server/utils/publicCategories.ts`, `.../api/public/content/categories/*` |
| Shared DTOs (`key`, `slug`, `name`, `parent`, `locale`) and the search cap | `@tm/flow-contracts/content-public` (`PublicContentCategorySchema`, `PUBLIC_CONTENT_SEARCH_MAX`) |
| Tag chips on an article link to the tag page; sitemap lists tag/category URLs | `.../pages/[...slug].vue`, `tm-web/server/routes/sitemap.xml.ts` |
| Suites: `pnpm test:web-content` 25 contract + 19 live checks | `scripts/build/test-web-content.ts`, `scripts/build/test-web-content-db.ts` |

Verified on `:4006`: `?q=gioi` returned the demo page, `?q=.*` returned 0 rows (literal match), an 81-character term returned `422`, `/tag/about` rendered `<h1>#about</h1>`, `/danh-muc/khong-co` returned `404`, and the sitemap listed the tag URLs. With a probe category `trang-suc` and a probe published post `posts/tin-thu`, `/danh-muc/trang-suc` rendered `Jewelry` (en locale) with 1 card, `/danh-muc/jewelry` resolved the same category, `/tag/about` rendered 2 cards, the search box submitted to `/bai-viet?q=bản` and matched, and the article's tag chip navigated to `/tag/about`. Probe rows were deleted afterwards and the database returned to `content 2 / categories 0 / revisions 0 / audits 0 / media 0`.

Still open in WEB-02: no legacy redirects/410s, no tag management UI, no category index inside the storefront nav, the `/bai-viet` category badge still prints the key, catalog routes remain legacy, and media in the public projection is deferred until the public media origin is decided.

### WEB-04 — public search page (landed 2026-11-08)

| Slice | Evidence |
| --- | --- |
| `/tim-kiem` searches published content and catalog products with one bounded literal query (`q` ≤80) and two result groups | `tm-shared/nuxt-layers/web-base/app/pages/tim-kiem.vue` |
| Escape-then-`<mark>` highlighting for content titles/excerpts, with the term escaped before it becomes a pattern | `.../components/WebSearchHighlight.vue`, `@tm/flow-utils/html` |
| No merged cross-collection cursor: each group is capped at 8 rows and links to `/bai-viet?q=` or `/products?search=` | same page, existing public content/catalog endpoints |
| Result pages are `noindex, follow`; nav entry added for both desktop and mobile menus | page SEO meta, `.../layouts/default.vue` |
| i18n for the page and the content-type labels | `tm-web/i18n/locales/{vi,en}.json` (`search.*`, `contentType.*`, `nav.search`) |

Verified on `:4006`: `?q=Giới` rendered one content row with `<mark>Giới</mark>`, `?q=khongcoketqua` rendered the empty state, no query rendered the hint, the input capped at 80 and the page carried `noindex, follow`. Against the real catalog `?q=hn-bo` rendered 6 product cards linking to `/products/bo-hn-bo*` and `?q=ban` returned 3; a seeded probe product showed as a card and was deleted afterwards. The `items` collection has 241 records (229 published), all carrying the legacy `searchString` the catalog filter matches.

Still open in WEB-04: no per-group pagination, no typo tolerance or synonyms, product names are not highlighted, category/tag discovery stays on the landing pages, no zero-result suggestions, and no search analytics.

### WEB-05 — cart (landed 2026-11-08)

| Slice | Evidence |
| --- | --- |
| Cart contract + pure builder: caps (20 lines, qty 1–99), variant resolution, `item_unavailable` / `variant_unavailable` / `out_of_stock` / `price_changed` | `@tm/flow-contracts/public-cart`, `scripts/build/test-web-cart.ts` |
| `POST /api/public/cart/validate` re-quotes from the published catalog, `no-store`, never trusts stored prices | `tm-web/server/api/public/cart/validate.post.ts`, `tm-web/server/utils/cartService.ts` |
| `/gio-hang`: quantity edit, remove, clear, per-line issue messages, subtotal, empty state, `noindex` | `web-base` page + `useCart` composable |
| Product page purchase panel: variant picker (out-of-stock disabled), quantity, add-to-cart, cart badge | `web-base` product page + layout |

Verified on `:4006` with temporary probe records: HTTP `200`/`422` branches as above, and in the browser add → reload (badge + totals persist), quantity change (`300,000` → `450,000`), variant add (two rows, `570,000`), price raise (one-time notice, then quiet), deleted record (`item_unavailable`, excluded from subtotal), remove and clear. Probes were deleted and the cart storage cleared; `items` is back to 241. Gates: `test:web-cart` (14), `test:web-content`, `test:content`, `test:categories`, `test:media`, `test:bulk`, `test:iam`, `test:db`, `test:layers`, root `typecheck`, root `lint`, `build:web`.

### WEB-08 — crawl policy + robots.txt (landed 2026-11-08)

| Slice | Evidence |
| --- | --- |
| Dynamic `robots.txt`: indexable deployments block only `/api/` and `/tim-kiem` and advertise the sitemap; `TM_SITE_INDEXABLE=false` blocks everything | `tm-web/server/routes/robots.txt.ts`, `buildRobotsTxt` in `@tm/flow-utils/seo` |
| Sitemap includes content, tag and category URLs; search pages are `noindex, follow` and excluded from robots | `tm-web/server/routes/sitemap.xml.ts`, `.../pages/tim-kiem.vue` |
| Both robots branches are unit-tested | `scripts/build/test-web-content.ts` |

Verified on `:4006`: `GET /robots.txt` returned `200 text/plain` with `Disallow: /api/`, `Disallow: /tim-kiem` and `Sitemap: http://localhost:4006/sitemap.xml`, plus a 300s/600s cache window. The preview branch is covered by the contract test rather than a second running server. Full gate run on the same tree: `test:content`, `test:categories`, `test:media` (11), `test:bulk` (9), `test:iam`, `test:db`, `test:layers`, `test:web-content` (27 + 19), root `typecheck`, root `lint`, `build:web` 46.5s.

Still open in WEB-08: no locale-prefixed URLs/hreflang, no per-record OG images, no crawl report against a real deployment.

### P2.c — audit + idempotency (landed 2026-11-07)

| Slice | Evidence |
| --- | --- |
| Every content mutation writes an audit entry (actor from the verified session, resulting revision, from/to status, changed fields, request id) | `tm-cms/server/models/audit.ts`, `tm-cms/server/services/contentAudit.ts`, migration `content-audit-idempotency-indexes` v2 |
| Read-only activity trail `GET /api/v1/admin/content/:id/history` (`content.read`, site-scoped, 404 for a foreign id) | `tm-cms/server/api/v1/admin/content/[id]/history.get.ts` |
| Retry safety: `Idempotency-Key` runs a mutation once per site/24h, replays the stored response, `409` on payload mismatch, `422` on a malformed key | `tm-cms/server/utils/idempotency.ts`, `tm-cms/server/models/idempotency.ts`, wired into the create/patch/events routes |
| CMS shows the trail in the record modal with action, revision, actor, changed fields and time | `tm-shared/nuxt-layers/cms-base/app/pages/content.vue`, `.../composables/useContentAdmin.ts`, `tm-cms/i18n/locales/{vi,en}.json` |
| Suites: `pnpm test:content` 25 model + 22 live service checks (audit shape, changedFields, ordering, site scope, replay, `409`, `422`) | `scripts/build/test-content-service.ts`, `scripts/build/test-content-model.ts` |

Verified over HTTP on `:4005`: two identical creates with one key produced one record and a replay header; the history returned create + update entries with the session actor; the CMS modal rendered both. Probe data was removed afterwards.

Still open in P2.c: audit covers content only, no retention policy, no concurrent-key race test, no idempotency for public writes.

## Next slices

1. **WEB-07 — forms**: contact/newsletter needs an email or CRM provider decision, so it starts with the provider choice rather than a local-only stub.
2. **P2.d — other domains on the same foundation**: configs/settings move onto the same model + audit + idempotency pattern; prove a CMS-only customer (`thanhtung`, `hoangvi`) can bind a database once Q2 names them.
3. **P3.f (rest) — media batch operations and CMS UI checks**: needs the local Hub on `:4000` so the CMS session can be exercised in the browser again.
4. **WEB-06 — checkout**: builds on the cart quote, but needs a payment provider decision plus the same server-side repricing rules.

Blocked on owner decisions (see [`questions.md`](questions.md)): WEB-09 durable revalidation and media in the public projection need Q12 (cache/revalidation infrastructure) and Q13 (media provider/public origin); importing the existing catalog/content data and enabling `default`/`thanhtung`/`hoangvi` need Q2; revoke/entitlement freshness needs Q6; moving the models into a shared server package needs Q11.

P3 also needs Q1–Q3 answered (real database URI and names); without them only local disposable databases are exercised.

## Superseded v1 decisions

- "Use TM Hub as the general business backend" — reversed by ADR 0001: Hub owns IAM only. Existing Hub-backed content/config/media/mail/notification pages are transitional and must migrate to MongoDB services (P3/P8).
- "AI Workspace via Hub AI endpoints" — dropped from scope; AI is optional and would live in tm-websites, not Hub business APIs.
- Open questions from the v1 queue (git init, Hub-public content API, catalog data source) are resolved or superseded by the v2 docs and ADR; do not reopen them from this file.

## V1-era record (evidence only — not the current plan)

Kept because the earlier Hub-backed modules and the Web PWA were verified live before the v2 reset; the v2 baseline marks all of it as transitional and requires fresh parity evidence per slice.

- Hub resource modules delivered and live-verified on 2026-11-06 against `tm-hub` (`sentuan`): dashboard aggregates, `/users`, `/roles`, `/routes` (Hub returns 0), `/configs` (0 keys), `/media` (`error.cloudinaryNotConfigured` callout), `/mail` (queue offline without Redis), `/notifications` (empty), `/connections` (7 providers), `/content` (1 published record of the paired `app_sentuan_web`).
- Web PWA (Task 16) — `injectManifest` worker `tm-web/service-worker/sw.ts`, offline page `tm-web/public/offline.html`, `globPatterns` scoped to assets, navigation network-first with `/offline.html` fallback. Verified on a production build at `127.0.0.1:4016`: worker activated and controlling, 71 precache URLs plus a `tm-offline` cache, offline navigation rendered the offline page, SSR returned after the server restarted. CMS still has a manifest only, no service worker.
- Historically passing gates for those changes: `validate:registry`, `verify:scaffold`, `test:layers`, `test:hub`, `test:web-content`, typecheck, lint, `validate:build:cms|web`, CMS build matrix (`default`, `sentuan`, `bagpost`, `thanhtung`, `hoangvi`), Web builds for `sentuan`/`bagpost`/`default`.
