# TODO — TM Websites current queue

> Canonical documentation: [`docs/v2/README.md`](../docs/v2/README.md) · Execution contract: [`docs/v2/09-ai-execution.md`](../docs/v2/09-ai-execution.md) · Ownership: [ADR 0001](../docs/decisions/0001-rebuild-ownership.md)
>
> This is the single active queue. Phase definitions live in [`07-delivery-roadmap.md`](../docs/v2/07-delivery-roadmap.md); scope lives in [`05-feature-parity.md`](../docs/v2/05-feature-parity.md). The v1-era record at the bottom is evidence only, not a plan.
>
> Decisions: [`tasks/questions.md`](questions.md) (status table H) and [ADR 0002](../docs/decisions/0002-owner-decisions.md) — Q1–Q22 and D1–D5 were closed on 2026-11-09, so no slice waits on a question any more. Only four external facts are still missing (production Mongo URI, Cloudinary credentials, Vercel credentials/domains, legacy snapshot); see [§4 of ADR 0002](../docs/decisions/0002-owner-decisions.md#4-waiting_input-facts-with-no-workaround).

## Phase status

| Phase | Deliverable | Status |
| --- | --- | --- |
| P0 | Documentation reset (v2 docs, ADR, archive) | Done — links verified, no application PASS implied |
| P1 | IAM contract and BFF | **In progress** — P1.a (adapter/CSRF/proxy) and P1.b (verified-context gate) landed |
| P2 | Business foundation (trusted DB binding, shared models, audit/idempotency) | **In progress** — tenant-bound DB binding, validated model, migrations v1–v3, content audit and idempotent retries landed |
| P3 | Content/media/site vertical slice on MongoDB | **In progress** — CMS content module with audit, retry safety and revision diff/restore runs on MongoDB; Web reads the same collection for pages and the `/bai-viet` listing; media library with local storage, uploads and content attachments (P3.e); bulk publish/archive/delete with per-row results and bulk media move/delete (P3.f); Web discovery with tag/category landing pages, a category index and bounded public search (WEB-02); unified public search page over content and products (WEB-04); crawl policy with robots.txt and a sitemap covering tag/category pages (WEB-08); client-owned cart with server-side re-quoting (WEB-05) |
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
| Sitemap built from published records only, locale-free URLs, `lastmod` from `updatedAt`; product detail and catalog category URLs come from the same published/live filter and canonical path as the storefront, de-duplicated and capped at 5000 | `tm-web/server/routes/sitemap.xml.ts`, `tm-web/server/utils/catalogService.ts` |
| CMS editor picks the body format per locale (Markdown / HTML / Plain text), with a format-specific placeholder | `tm-shared/nuxt-layers/cms-base/app/pages/content.vue`, `tm-cms/i18n/locales/{vi,en}.json` |
| Suites: `pnpm test:content` 42, `pnpm test:web-content` 24 contract + 12 live reader checks, `pnpm test:layers`, typecheck cms/web/shared, CMS lint, `validate:build:cms`, `build:cms` | `scripts/build/test-web-content.ts`, `scripts/build/test-web-content-db.ts` |

Verified over HTTP/browser on `:4005` + `:4006` (`sentuan`): published record `200` by key and by slug, draft `404`, `?locale=en` fallback `200` with `Content-Language: vi`, sitemap listing only the published record, and the format select driving real HTML/Markdown rendering (record restored to `format: html` afterwards). Doc record: [05-feature-parity.md](../docs/v2/05-feature-parity.md).

Still open in P3.b: `format: text` not exercised in the browser, no Hub content export (Q5); a content publish needs no purge (the public content handlers are not cached).

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

Still open in P3.d: no tag/category landing pages (only query filters), no search, and the listing is not on the home page yet; a content publish needs no purge (the public content handlers are not cached).

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

Still open in P3.e: no media attachments yet, no drag-and-drop ordering, no tag management, no bulk move/delete, and the storefront has no category landing pages. Drag-and-drop ordering and tag management were closed on 2026-11-10 (records under "Next slices"); media fields on a category and bulk move remain open.

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

### P3.f (rest) — bulk media operations (landed 2026-11-08)

| Slice | Evidence |
| --- | --- |
| `POST /api/v1/admin/media/bulk` moves or deletes 1–50 files with one result row per file | `mediaService.ts` (`runBulkMediaCommand`), `media/bulk.post.ts`, `@tm/flow-contracts/media-admin` |
| Media page: per-card selection, select-all/clear, move dialog with a shared folder, delete dialog with inline failures | `cms-base/app/pages/media.vue` |
| Per-row rules stay in the single-file commands (revision lock, normalized folder, `MEDIA_IN_USE`, audit) | `scripts/build/test-media-service.ts` (12 checks) |

Verified on CMS `:4005` with mock auth against `sen-tuan`: the service suite is green, HTTP `200`/`422` branches behave as documented in `04`, and in the browser a two-file move (`landing/banner` → `landing/featured`, revision 3) succeeded while a mixed delete kept the attached file and reported it inline. Probe files were removed (`media 0`, `content 2`, `items 241`) and the dev server stopped. Gates: `test:media`, root `typecheck`, root `lint`. Dialog dismissal could not be observed in the automated preview (exit animations do not advance there; the untouched `/categories` page behaves the same), so it remains unverified.

Still open in P3.f: bulk limited to the loaded page, no undo, and no media in the public projection (Q13).

### P3.f — bulk content actions (landed 2026-11-07)

| Slice | Evidence |
| --- | --- |
| One request per action (`publish`/`archive`/`delete`) over 1–50 `{ id, revision }` items, answered as per-row results (`200` + `succeeded`/`failed`) | `tm-cms/server/services/contentBulk.ts` (`runBulkContentCommand`, `BULK_MAX_ITEMS`), `tm-cms/server/api/v1/admin/content/bulk.post.ts` |
| Every row reuses the single-record command, so it keeps its own optimistic lock, audit entry and revision snapshot; a bad row never rolls back the others | `tm-cms/server/services/contentService.ts`, `contentAudit.ts`, `contentRevisions.ts` |
| Shared request/result DTOs | `@tm/flow-contracts/content-admin` (`AdminContentBulkRequestSchema`, `AdminContentBulkAction`, `AdminContentBulkRow`, `AdminContentBulkResult`) |
| CMS list: select-all bar, per-row checkbox, action dialog with confirm text and a per-row failure list | `tm-shared/nuxt-layers/cms-base/app/pages/content.vue`, `.../composables/useContentAdmin.ts`, `tm-cms/i18n/locales/{vi,en}.json` |
| Suite: `pnpm test:bulk` 9 live checks (mixed outcomes, duplicate id, foreign id, per-row audit/revision, retry, request cap) | `scripts/build/test-bulk-service.ts` |

Verified over HTTP on `:4005`: publishing two drafts returned `200` with `succeeded: 2`; resending the same items at their old revisions returned `200` with `failed: 2` and `CONTENT_REVISION_CONFLICT` on each row; `schedule` with no items returned `422 CONTENT_BULK_INVALID`. In the browser the select-all bar enabled the actions only for a real selection, archiving two records reported `Processed 2/2 records` and cleared the selection, and a run over an already-archived record reported `Processed 0/1 records` with that row's reason. The select-all run also covered the two demo records, which were restored by hand afterwards (including the post's `publishedAt`, reset to the restore time because the soft delete had cleared it).

Still open in P3.f: bulk is limited to the loaded page (no "all matching the filter"), no bulk schedule or shared-field edit, no undo, and no import/export or background job runner. Media bulk move/delete landed separately (see the P3.f rest entry above).

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

Still open in WEB-02: no legacy redirects/410s (tag management landed 2026-11-10), catalog routes remain legacy, and media in the public projection is deferred until the public media origin is decided. The category index, the display-name badge and the storefront nav entries landed on 2026-11-09.

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

### P2.c (rest) — audit read surface (landed 2026-11-08)

| Slice | Evidence |
| --- | --- |
| `GET /api/v1/admin/audit`: site-scoped business trail with resource/action/actor/id/search/date filters and an `_id` cursor, `apps.logs.read`, `no-store` | `tm-cms/server/api/v1/admin/audit/index.get.ts`, `tm-cms/server/services/auditService.ts`, `flow-contracts/src/audit-admin.ts` |
| The Audit Log page reads that endpoint instead of the Hub IAM proxy, with filter selects, debounced search, "load more" and an empty state | `cms-base/app/pages/audit.vue`, `.../composables/useAuditAdmin.ts`, `tm-cms/i18n/locales/{vi,en}.json` |
| Suites: `pnpm test:audit` 7 live checks (site scope, filters, search, paging, invalid cursor) | `scripts/build/test-audit-service.ts` |

Verified over HTTP on `:4005` (2 entries, filters, paging, `422` cases, `401` anonymous) and in the browser (rows, stats, action filter, search empty state, `200` requests). Probe record, audit entries and revisions were removed afterwards.

### P2.c (rest) — retention command (landed 2026-11-08)

| Slice | Evidence |
| --- | --- |
| `pnpm prune:retention`: per-content snapshot cap and audit age cutoff, site-scoped, dry run unless `--apply`, idempotent re-run, invalid options refused | `tm-cms/server/services/retentionService.ts`, `scripts/ops/prune-retention.ts` |
| Suites: `pnpm test:retention` 5 live checks (cap, cutoff, site isolation, dry run, re-run no-op, option bounds) | `scripts/build/test-retention-service.ts` |
| Operator runbook + dry-run/apply evidence on `sen-tuan` | `docs/v2/08-operations-and-verification.md`, `docs/v2/05-feature-parity.md` |

Still open in P2.c: audit covers content only, the retention periods are placeholder defaults pending Q16 and nothing schedules the command, no concurrent-key race test, no idempotency for public writes, no per-record history for category/media.

### P2.d — site settings (landed 2026-11-08)

| Slice | Evidence |
| --- | --- |
| One settings document per site (company, SEO defaults, locales, module switches), unique `siteId`, monotonic revision, `updatedBy` | `tm-cms/server/models/settings.ts`, migration `settings-indexes` v6, `flow-contracts/src/settings-admin.ts` |
| `GET`/`PATCH /api/v1/admin/settings` with merge semantics, revision lock, `Idempotency-Key`, audit entry (`resourceType: settings`) | `tm-cms/server/api/v1/admin/settings/**`, `tm-cms/server/services/settingsService.ts` |
| `/configs` edits and saves the document; a Hub failure no longer blanks the page | `cms-base/app/pages/configs.vue`, `.../composables/useSettingsAdmin.ts`, `tm-cms/i18n/locales/{vi,en}.json` |
| Suites: `pnpm test:settings` 8 live checks | `scripts/build/test-settings-service.ts` |

Verified over HTTP on `:4005` (defaults, first save, idempotent replay, `409`, `422` cases, audit rows) and in the browser (card render, save → revision 1, unchanged message, stale-form conflict message). Probe document, audit entries and idempotency keys were removed afterwards.

Open items: Hub roles need `configs.write` for a real admin to save; the public projection is still missing; only `sentuan` was exercised (Q2). The logo/default SEO image are picked from the media library in a dialog (verified in the browser with a probe upload, since removed).

### P2.d (rest) — site menus (landed 2026-11-08)

| Slice | Evidence |
| --- | --- |
| Site-scoped menus in their own `site_menus` collection (immutable slug key, ordered items <=30, per-locale label, `content`/`category`/`url` link), unique `(siteId, key)`, migration `menu-indexes` v7 | `tm-cms/server/models/menu.ts`, `flow-contracts/src/menu-admin.ts` |
| `GET`/`POST /api/v1/admin/menus`, `GET`/`PATCH`/`DELETE /:id` with `configs.read`/`configs.write`, revision lock, idempotency and one `audit_logs` entry (`resourceType: menu`) per mutation | `tm-cms/server/services/menuService.ts`, `tm-cms/server/api/v1/admin/menus/*` |
| `/menus` editor: menu list, name, ordered items with up/down/edit/remove, item dialog with per-type target hints, unsaved marker, delete confirmation; nav entry and audit filter option | `cms-base/app/pages/menus.vue`, `.../composables/useMenuAdmin.ts`, `tm-cms/i18n/locales/{vi,en}.json` |
| Menu targets are resolved against the site on save: unknown page, soft-deleted page and another site's category key are all `422 MENU_TARGET_NOT_FOUND` with `details.missing`, and a refused save writes nothing | `tm-cms/server/services/menuService.ts`, `tm-cms/server/api/v1/admin/menus/*` |
| Suites: `pnpm test:menus` 13 live checks | `scripts/build/test-menu-service.ts` |

The collection is `site_menus` because every migrated database already contains the legacy shop `menus` documents (9 in `sen-tuan`, none with a `siteId`); they all collided on the new unique index, so they stay untouched until the import slice. Verified over HTTP (`201`/`409`/`422`/`403`/`401`, idempotent replay) and in the browser (add item, reorder, save -> `Revision 3`/`4`, create and delete through the dialogs); probe menus, audit rows and keys were removed afterwards. Still open: items cannot nest, there is no drag-and-drop ordering, no bulk actions. Link targets are validated against the site on save as of the slice below. The storefront side landed two slices below.

### P2.d (rest) — storefront site projection (landed 2026-11-08)

| Slice | Evidence |
| --- | --- |
| `PublicSite` contract (company, SEO defaults, locales, resolved menus) with pure builders `buildPublicSite`/`toPublicMenu`/`publicMenuHref`/`publicMenuLabel`, exported as `@tm/flow-contracts/site-public` | `tm-shared/packages/flow-contracts/src/site-public.ts` |
| Read-only `settings`/`site_menus` views with public projections, locale-aware category slug map, and `GET /api/public/site` cached per locale | `tm-web/server/models/sitePublic.ts`, `tm-web/server/utils/publicSite.ts`, `tm-web/server/api/public/site.get.ts` |
| `usePublicSite()` composable: one cached read, brand/contact/SEO/menus with static fallbacks; consumed by the layout, the home page metadata and the product JSON-LD | `web-base/app/composables/usePublicSite.ts`, `web-base/app/layouts/default.vue`, `web-base/app/pages/index.vue`, `web-base/app/pages/[...slug].vue`, `web-base/app/pages/products/[slug].vue` |
| Suites: `pnpm test:web-site` 10 pure checks, `pnpm test:web-site-db` 6 live checks | `scripts/build/test-web-site.ts`, `scripts/build/test-web-site-db.ts` |

The projection exposes only company identity, SEO defaults, locales and menus — `PublicSiteSchema.parse` at the endpoint rejects a leaked admin field (revision, actor, module switches, stored targets). A menu item is resolved on read: `content` key → catch-all path, `category` key → `/danh-muc/<slug>` for the locale (default locale, then key, as fallback), `url` → only a rooted path or absolute `http(s)` link; items without a label or with an unresolvable target are dropped. Verified over HTTP on `:4006` (`?locale=vi|en`, `s-maxage=60`) and in the browser (settings brand name instead of the Hub name, probe `main`/`footer` menus rendered in the header and footer, meta description and footer contact block from the settings document, English labels after switching locale); probe `settings`/`site_menus` were removed afterwards. The browser tab served a stale service-worker shell at first and needed its worker/caches cleared before it reflected the new data. Still open: the logo id is not resolved to a URL (Q13).

### P2.d — menu link reference validation (landed 2026-11-09)

| Slice | Evidence |
| --- | --- |
| A menu save resolves `content`/`category` targets in this site (soft-deleted page counts as missing) and refuses the whole write with `422 MENU_TARGET_NOT_FOUND` + `details.missing`; `url` targets stay literal | `tm-cms/server/services/menuService.ts` (`MenuWriteMeta.refs`, `assertLinksExist`), `tm-cms/server/api/v1/admin/menus/index.post.ts`, `tm-cms/server/api/v1/admin/menus/[id].patch.ts` |
| Editor shows the refusal inline and as a toast, keeps the draft and the loaded revision | `cms-base/app/pages/menus.vue`, `tm-cms/i18n/locales/{vi,en}.json` |
| Editor picker: `GET /api/v1/admin/menus/link-options` plus a target select for `content`/`category` items, with stale keys marked *(no longer exists)* | `tm-cms/server/api/v1/admin/menus/link-options.get.ts`, `flow-contracts/src/menu-admin.ts`, `cms-base/app/pages/menus.vue`, `.../composables/useMenuAdmin.ts` |
| Suites: `pnpm test:menus` 14 live checks (resolving targets save, unknown key, soft-deleted page, another site's category, revision untouched, picker scoping and labels) | `scripts/build/test-menu-service.ts` |

The lookup is opt-in through `MenuWriteMeta.refs`, so service callers without content/category collections keep the previous behaviour while both admin routes always pass them. Verified over HTTP on `:4005` (probe category + draft page: `422` with `Item 1: no category with the key "khong-co-that" exists in this site`, then `200` with the real keys) and in the browser (inline error plus toast, header still `Revision 2`, draft kept the bad target). Probe menu, category, page and audit rows were removed afterwards (`site_menus 0 / categories 0 / audit 0`). The item dialog now offers a picker instead of a typed key (verified below). Deleting a referenced record is refused as well — see the reverse-guard slice below.

### P2.d — promote a menu child without retyping it (landed 2026-11-09)

| Slice | Evidence |
| --- | --- |
| Child rows get *Move to top level* (outdent icon): removed from `children`, inserted directly under its former parent, total row count unchanged so neither cap needs re-checking; save keeps the normal revision guard | `cms-base/app/pages/menus.vue` (`promoteChild`), `tm-cms/i18n/locales/{vi,en}.json` |
| Browser `:4005`: probe `Jewellery → [Rings, Necklaces], About` → `1 Jewellery (1 child) / 1.1 Rings / 2 Necklaces / 3 About` with the unsaved marker; Save → revision 2; API read back `Trang sức → [Nhẫn], Dây chuyền, Giới thiệu`, `itemCount 4`; probes removed (`site_menus 0 / audit 0`) | `:4005/menus`, admin API |

Still open: no one-action demotion of a top-level row into its previous sibling, and no touch drag.

### P2.d — one title template for every page (landed 2026-11-09)

| Slice | Evidence |
| --- | --- |
| `applySeoTitleTemplate(pageTitle, template)`: `%s` placeholder, bare `%s`/empty = no suffix, template without `%s` = suffix, no dangling separator, no repeated brand | `flow-utils/src/seo.ts`, `scripts/build/test-web-site.ts` (11 checks) |
| Applied once at the root so pages keep owning their title | `web-base/app/composables/useSiteSeoTitle.ts`, `tm-web/app/app.vue` |
| Live: seeded template `%s · Sen Tuấn` → `Products · Sen Tuấn`, `Danh mục · Sen Tuấn`, `/` stayed `Sen Tuấn`, `/gioi-thieu` stayed `Giới thiệu Sen Tuấn`; deleting the document reverted every title | `:4006` SSR HTML, probe settings removed (`settings 0 / menus 0 / audit 0`) |

`og:title` stays the page's own title (no company suffix on share cards). The settings field previews the rendered result while typing (`Preview: Trang mẫu` → `Preview: Trang mẫu | Sen Tuấn`), verified in the browser on `:4005/configs`.

### P2.d — a title template per locale (landed 2026-11-09)

| Slice | Evidence |
| --- | --- |
| `seo.titleTemplates` (optional map, enabled locales only) overrides the shared `seo.titleTemplate`; an empty entry falls back to it; patching merges key by key so saving EN does not drop VI | `flow-contracts/src/{settings-admin,site-public}.ts`, `tm-cms/server/models/settings.ts`, `tm-cms/server/services/settingsService.ts` |
| Storefront picks the template for its current locale; the settings page adds one field per locale with a placeholder and preview | `web-base/app/composables/useSiteSeoTitle.ts`, `cms-base/app/pages/configs.vue`, `tm-cms/i18n/locales/{vi,en}.json` |
| Suites: `pnpm test:settings` 9, `pnpm test:web-site` 12 | `scripts/build/test-settings-service.ts`, `scripts/build/test-web-site.ts` |

Live: shared `%s · Sen Tuấn` + `en: '%s | Sen Tuan'` gave `<title>Sản phẩm · Sen Tuấn</title>` and, with the `i18n_redirected=en` cookie, `<title>Products | Sen Tuan</title>`; the CMS previews read `Sample page · Sen Tuấn` / `Sample page | Sen Tuan`, and the English sample title is no longer Vietnamese. Probes removed (`settings 0 / audit 0 / idempotency_keys 0`); deleting the document reverted both titles to bare. Still open: one template per locale, not per page type, and no per-locale default description/OG image.

### P2.d — a save clears the storefront cache (landed 2026-11-09)

| Slice | Evidence |
| --- | --- |
| `revalidateStorefront` pairs `TM_WEB_REVALIDATE_URL` with `TM_REVALIDATE_SECRET`, posts to the storefront's `POST /api/_internal/purge` and returns an outcome instead of throwing (the save is already committed; 5s timeout; skipped when either half is missing, never sent with an empty secret; not re-run on an idempotent replay) | `tm-cms/server/utils/storefrontRevalidate.ts`, `tm-cms/nuxt.config.ts` |
| Settings and menu create/update/delete purge after the write and report it in `x-storefront-revalidate` | `tm-cms/server/api/v1/admin/settings/index.patch.ts`, `menus/index.post.ts`, `menus/[id].patch.ts`, `menus/[id].delete.ts` |
| The settings page reads `x-storefront-revalidate` and says so when only the site refresh failed (`savedNotRevalidated`) instead of reporting a plain success | `cms-base/app/composables/useSettingsAdmin.ts`, `cms-base/app/pages/configs.vue`, `tm-cms/i18n/locales/{vi,en}.json` |
| Suites: `pnpm test:revalidate` 10 checks | `scripts/build/test-storefront-revalidate.ts` |

Live: cache warm at `''` -> `PATCH settings` `200` + `x-storefront-revalidate: revalidated` (33 handlers dropped) -> the site read `Probe Purge Co` on the next request; menu create and delete appeared/disappeared immediately; with the storefront killed the same save stayed `200` with `request-failed` and a server warning. A direct purge with no or a wrong secret is `401`. Browser (`:4005/configs`): a wrong secret produced `Site settings saved. The website cache could not be cleared, so the change will appear in about a minute.` at revision 2, the matching secret produced `Site settings saved.` Probes removed (`settings 0 / site_menus 0 / audit 0 / idempotency_keys 0`). Still open: broad handler deletion rather than tenant/tag scoping, and unsigned.

A content publish needs no purge here, and adding one would have been a no-op: the public content endpoints are plain handlers (no `cachedEventHandler`) and `sitemap.xml` is built per request — the only copy of it that can lag is the CDN's `max-age=300, s-maxage=600` header, which a Nitro handler purge cannot reach either. A published page therefore appears on the next request; only a crawler holding the cached sitemap waits up to 10 minutes. The catalog is different (next slice).

### P2.d — a catalog edit clears the storefront cache (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| Item create/update/publish-archive-restore-delete and both bulk patch routes, plus category create/update/delete, purge after the write and report it in `x-storefront-revalidate`; an idempotent replay does not purge again and a bulk patch that changed nothing does not purge at all | `tm-cms/server/api/v1/admin/catalog/items/{index.post.ts,[id].patch.ts,[id]/events.post.ts,bulk.post.ts,bulk-by-filter.post.ts}`, `catalog/categories/{index.post.ts,[id].patch.ts,[id].delete.ts}` |
| The reason sent to the storefront names the write (`catalog.item.publish`, `catalog.item.bulk`, `catalog.category.delete`, …) | `tm-cms/server/utils/storefrontRevalidate.ts` (unchanged contract) |
| Suites: `pnpm test:revalidate` 10 checks — the two new ones read the route sources and fail if a catalog write stops importing/calling the purge or starts purging on a replay | `scripts/build/test-storefront-revalidate.ts` |

Live (`:4015` CMS -> `:4016` Web, `sen-tuan`, disposable probe `probe-e2e-item`): `GET /api/public/products/probe-e2e-item` was warmed to `404` by the 60s handler cache, `POST /api/v1/admin/catalog/items` answered `201` + `revalidated`, the draft still read `404`, `POST …/events {publish}` answered `200` + `revalidated`, and the very next `GET` returned `200` with `Probe E2E item` and `cache-control: public, max-age=60, s-maxage=300`. Deleting it purged again and the same URL went back to `404` immediately. The same run against a stub confirmed reasons `catalog.item.{create,publish,update,bulk}` and `catalog.category.{create,update,delete}`, a repeated `PATCH` with the same `Idempotency-Key` returning `idempotent-replay: true` with no purge, and a killed storefront leaving the save at `200` with `x-storefront-revalidate: request-failed`. Probes removed (`catalog_items 0 / catalog_categories 0 / audit 0` for both probe keys). Still open: broad handler deletion rather than per-product keys, and no CDN purge (Q12).

### P2.d — two-level menus with drag-and-drop (landed 2026-11-09)

| Slice | Evidence |
| --- | --- |
| Contract + model: `children` on a top-level item (max 10, one level), `MENU_DEPTH_LIMIT` / `MENU_CHILDREN_LIMIT`, children counted in the 30-item cap and in `itemCount` | `flow-contracts/src/menu-admin.ts`, `tm-cms/server/models/menu.ts`, `tm-cms/server/services/menuService.ts` |
| Delete guard + reverse lookup walk children (`menuLinksTo` filters in JS, no nested `$elemMatch`) | `tm-cms/server/services/menuReferences.ts` |
| Editor: nested rows (`2.1`), *Add a child item*, shared `reorder()` for drag and arrows, parent hint in the dialog | `cms-base/app/pages/menus.vue`, `tm-cms/i18n/locales/{vi,en}.json` |
| Public projection + storefront: `children` in `PublicMenuLeaf`, category slugs for child links, header dropdown on hover/focus, footer flattening | `flow-contracts/src/site-public.ts`, `tm-web/server/utils/publicSite.ts`, `web-base/app/composables/usePublicSite.ts`, `web-base/app/layouts/default.vue` |
| Suites: `test:menus` 16, `test:web-site` 10, `test:web-site-db` 6, `test:content` 27, `test:categories` 12 | `scripts/build/test-menu-service.ts` |

Verified over HTTP and in the browser on `:4005`/`:4006` (drag reorder persisted at revision 2, child added at revision 3, dropdown rendered both links with resolved hrefs). Probes removed (`site_menus 0 / audit 0`). A child row now has a *Move to top level* action that lifts it under its former parent without retyping, and a top-level row has the inverse *Move under the item above* (`demoteItem`), which appends it as the last child of its previous sibling and is disabled at `index 0` or when that parent already holds `MENU_MAX_CHILDREN` children. It keeps the label and target (including a two-level child) and only appends, so the reading order is preserved and the total row count is unchanged; the button title is localized (`Move under the item above` / `Chuyển xuống làm mục con của mục phía trên`). Verified in the browser on `:4005/menus?menu=…` with a probe menu of two rows: the indent button on row 2 was enabled while row 1's was disabled, one click moved `Probe two` to `1.1`, and saving reached `Revision 2`; the API read back `[(Probe one, [Probe two])]` and `GET /api/public/site?locale=vi` on `:4006` returned the nested child with its href. Probe menu, audit rows and keys were removed afterwards (`site_menus 0 / audit 0 / idempotency_keys 0`). Still open: no drag on touch, and the dropdown does not repeat the parent link inside itself.

### P2.d — the editor warns before the delete (landed 2026-11-09)

| Slice | Evidence |
| --- | --- |
| `GET /api/v1/admin/content/:id/menu-references` and `GET /api/v1/admin/categories/:id/menu-references` (`content.read`, record resolved first so a foreign id is 404), contract `MenuReference(s)Schema` | `tm-cms/server/services/{content,category}Service.ts`, `tm-cms/server/api/v1/admin/{content,categories}/[id]/menu-references.get.ts`, `flow-contracts/src/menu-admin.ts` |
| Warning block in the page detail dialog and the category edit dialog, hidden when there is nothing to warn about | `cms-base/app/pages/content.vue`, `cms-base/app/pages/categories.vue`, `cms-base/app/composables/{useContentAdmin,useCategoryAdmin}.ts`, `tm-cms/i18n/locales/{vi,en}.json` |
| Suites: `pnpm test:content` 27 checks, `pnpm test:categories` 12 checks (reference list matches the refusal, foreign id 404, empty after the menu is gone) | `scripts/build/test-content-service.ts`, `scripts/build/test-category-service.ts` |

Each warning entry links to `/menus?menu=<id>` and the menu editor selects that menu on load. Verified over HTTP on `:4005` (both routes `200` with the probe menu, unknown id `404`, anonymous `401`) and in the browser (the page detail and the category dialog both named `Probe ref menu`; the link opened `ZZZ linked menu` while `AAA first menu` was first in the list). Probes were removed afterwards (`site_menus 0 / categories 0 / audit 0 / content_revisions 0`). Still open: fixing a menu does not clear the warning until the record is reopened.

### P2.d — a menu reference blocks the delete (landed 2026-11-09)

| Slice | Evidence |
| --- | --- |
| `findMenuReferences` reverse lookup; `deleteCategory` returns `409 CATEGORY_IN_MENU` and `runContentEvent` `409 CONTENT_IN_MENU` with `details.menus`, writing nothing | `tm-cms/server/services/menuReferences.ts`, `tm-cms/server/services/{category,content}Service.ts`, `tm-cms/server/api/v1/admin/categories/[id].delete.ts`, `tm-cms/server/api/v1/admin/content/[id]/events.post.ts`, `tm-cms/server/api/v1/admin/content/bulk.post.ts` |
| Delete dialogs and bulk results name the blocking menus (`admin.categories.errors.inMenu`, `admin.content.errors.inMenu{,Short}`) | `cms-base/app/pages/categories.vue`, `cms-base/app/pages/content.vue`, `tm-cms/i18n/locales/{vi,en}.json` |
| Suites: `pnpm test:content` 28 checks, `pnpm test:categories` 12 checks (refused delete leaves the revision untouched, then succeeds after the menu is removed) | `scripts/build/test-content-service.ts`, `scripts/build/test-category-service.ts` |

The guard only fires for `delete` on a record that is not already deleted, so restore and re-delete keep working, and a bulk delete reports the refusal as one failed row instead of failing the batch. Verified over HTTP on `:4005` (`409` with the menu key/name in `details.menus`, page and category unchanged) and in the browser (the delete dialog named `Probe guard menu`; the bulk delete reported `Processed 0/1 records` with the localized message). Probes were removed afterwards (`site_menus 0 / categories 0 / audit 0 / content_revisions 0`). Note for future i18n edits: intlify needs `{menus}`; the double-brace form fails the whole locale bundle. Still open: no *replace* flow that rewrites several menus at once.

### P2.d — category and media history (landed 2026-11-08)

| Slice | Evidence |
| --- | --- |
| `listRecordAudit` filters by resource type and id (`listContentAudit` delegates), and `getMedia` gives the media route the same 404 semantics as the other domains | `tm-cms/server/services/contentAudit.ts`, `tm-cms/server/services/mediaService.ts` |
| `GET /api/v1/admin/categories/:id/history` (`content.read`) and `GET /api/v1/admin/media/:id/history` (`media.read`), newest first, capped at 50 | `tm-cms/server/api/v1/admin/categories/[id]/history.get.ts`, `tm-cms/server/api/v1/admin/media/[id]/history.get.ts` |
| `RecordHistory` component in both edit dialogs: activity rows, reload, explicit failure text, `admin.history.*` labels | `cms-base/app/components/RecordHistory.vue`, `cms-base/app/pages/categories.vue`, `cms-base/app/pages/media.vue`, `tm-cms/i18n/locales/{vi,en}.json` |
| Suites: `pnpm test:audit` now 9 live checks (trail scoping by type/id/site, cap, unknown id) | `scripts/build/test-audit-service.ts` |

A category or media id alone is ambiguous across collections, so the resource type is part of the query; the record is resolved before the trail is read, which keeps another site's id a 404 instead of an empty list. Verified over HTTP on `:4005` with probe records (category edit -> one `update` row with the actor and `changedFields`; media edit -> one `update` row for `title`; unknown media id `404 MEDIA_NOT_FOUND`, malformed `422`, anonymous `401`). Probe records and audit rows were removed afterwards. In the browser the category dialog showed `Edited / Revision 2 / Quản trị viên / parent, order, locales` and the media dialog the same block with `title`. Still open: the trail is capped at the newest 50 rows with no pagination, and neither domain has revision snapshots.

### P2.d — touch drag for menu rows (landed 2026-11-09)

- Target files: `tm-shared/nuxt-layers/cms-base/app/pages/menus.vue`. No schema, model, service or API change.
- Why: rows reordered through HTML5 drag events, which a finger cannot start, so a phone editor could only use the arrow buttons.
- How: the grip is wrapped in a plain `<span>` that owns a pointer drag (`onPointerDragStart/Move/End/Cancel`), because the icon component swallows event listeners. The row only counts as dragged after 6px of movement, so a tap on the grip stays a tap; the drop target is the row under the pointer, read from `data-menu-row-list` / `data-menu-row-index`, and a drop outside its own list is ignored. Mouse inputs return early and keep the native drag, so nothing starts twice, and both paths end in `reorder`, so the two ways of moving a row cannot drift apart. `touch-none` on the grip stops the page from scrolling mid-drag.
- Evidence: `npx nuxi typecheck` exit 0, `pnpm --dir tm-cms run lint` clean, `pnpm test:menus` 16 checks. In the browser on `:4005/menus?menu=…` with a probe menu: a tap on a grip changed nothing; dragging row 1 onto row 3 gave `Probe B / Probe C / Probe A` plus `Unsaved`; dragging child `1.2` above `1.1` swapped them while the roots stayed put; dropping a child onto a root row left the order unchanged. Save reached `Revision 3`, the API read back `1 Probe A [A2, A1] / 2 Probe B`, and `GET :4006/api/public/site?locale=vi` returned the same nesting. Probe menu deleted afterwards (`delete=200`), audit rows and keys removed (`site_menus 0 / audit 0 / idempotency_keys 0`, `content 2` legacy records untouched).
- Verification limit: the touch path was exercised with synthetic `PointerEvent`s (`pointerType: 'touch'`) in the browser, not on a physical touchscreen; `setPointerCapture` is wrapped in `try/catch` because a synthetic pointer is not an active pointer.

### WEB-02 — content category index and a display-name badge (landed 2026-11-09)

- Target files: `tm-shared/nuxt-layers/web-base/app/composables/usePublicContentCategories.ts` (new), `.../app/pages/danh-muc/index.vue` (new), `.../app/pages/bai-viet/index.vue`, `.../app/composables/usePublicSite.ts`, `tm-web/server/routes/sitemap.xml.ts`, `tm-web/i18n/locales/{vi,en}.json`. No model, contract or endpoint change.
- Why: a record stores the category `key`, so the listing printed that key at the visitor, and the storefront had no page that listed the categories themselves — the only way to reach a category landing page was to arrive from a post.
- How: one shared composable reads `/api/public/content/categories` once per locale, indexes it by key and degrades to an empty map if the read fails, so a page never breaks because taxonomy is down. The listing badge resolves the key to the localized name and links to `/danh-muc/<slug>`; an unknown key keeps printing exactly as stored and stays unlinked instead of becoming a dead link. The new index groups rows by parent key, promotes a child whose parent is not published in this locale rather than dropping it, and shows an empty state with a link back to the listing. The index joins the sitemap only while at least one category exists.
- Evidence: `tm-web` `typecheck` and `lint` exit 0, `pnpm test:web-content` 25 contract + 19 live reader checks. With a probe parent `probe-noi-that`, child `probe-noi-that-sub` and a probe published post in the child: `/danh-muc` rendered `Probe Nội thất` with `Probe Phòng khách` beneath it and canonical `/danh-muc`; `/bai-viet?category=probe-noi-that-sub` showed `Probe Phòng khách` linking to `/danh-muc/probe-phong-khach` plus the all-categories link; `/danh-muc/probe-phong-khach` rendered the child name and the post; header gained `Bài viết` → `Danh mục bài viết`, footer both; English re-read the rows as `Probe Furniture` / `Probe Living room`; `?category=khong-ton-tai` printed the raw key, unlinked, with the empty list; the sitemap listed `/danh-muc` and both slugs.
- Cleanup: probe post deleted through the admin event (`200`), probe categories removed; `contents 8 (legacy) / categories 0 / content_revisions 0 / audit_logs 0 / idempotency_keys 0`, and the 6 legacy `content_categories` rows untouched. `/danh-muc` now shows its empty state and the sitemap has no `danh-muc` URL.
- Write path: the category tree is already writable (P3.e, `/api/v1/admin/categories`, collection `categories`); a second pass created the same parent/child through that API and the storefront showed them within a second, then `DELETE ?revision=1` removed the child and the parent (`200`). The legacy post still stores a legacy `content_categories` id, so its badge keeps printing that value until the import decides the mapping (Q2/Q5).

### P3.f (rest) — tag management (landed 2026-11-10)

- Target files: `tm-shared/packages/flow-contracts/src/tag-admin.ts` (new: `AdminTag`, `AdminTagRenameRequestSchema`, `AdminTagRenameResult`, `ADMIN_TAG_MAX_LENGTH`), `tm-shared/packages/flow-contracts/{package.json,src/index.ts}` (subpath + root export), `tm-cms/server/services/tagService.ts` (new: `listTags`, `renameTag`, `replaceTag`, `TagServiceError`), `tm-cms/server/api/v1/admin/tags/index.get.ts` and `rename.post.ts` (new), `tm-cms/server/utils/contentApi.ts` (re-exports the shared schema, translates `TagServiceError`), `cms-base/app/composables/useTagAdmin.ts` (new), `cms-base/app/pages/tags.vue` (new), `cms-base/app/layouts/default.vue` (`/tags` nav item), `tm-cms/i18n/locales/{vi,en}.json` (`nav.tags`, `admin.tags.*`), `scripts/build/test-tag-service.ts` (new), root `package.json` (`test:tags`).
- Why: a tag exists only as a string on each content record, so a typo silently created a second tag and the records under the old one could not be found again; there was no screen that answered "which tags exist and how many records use them".
- How: the read side is one aggregation over the content collection (`unwind` → `group` → count desc, name asc, capped at 500) scoped to the site. The write side is a loop over the records that carry the tag, each written under its own `revision` guard, so a record an editor saved in between is reported as `skipped` instead of overwritten. The replacement keeps the tag's position in the list, a merge onto an existing tag drops the duplicate, and `to: null` detaches the tag without touching the record. Every rewritten record gets its own `update` audit entry (`changedFields: ["tags"]`) and a revision snapshot, so the existing content history explains why a record changed.
- Route: `/api/v1/admin/tags`, not `/api/v1/admin/content/tags`, because the content detail route is a single dynamic segment and a static child would shadow a record id called `tags`.
- Evidence (service, disposable DB): `pnpm test:tags` → 9 checks: position-preserving replacement and merge de-duplication; counts ordered and site-scoped; rename rewrites two records and bumps `revision` to 2 while the other site keeps its copy; merge onto an existing tag leaves one tag; `to: null` detaches from three records while the records remain; `404 TAG_NOT_FOUND`, `422 TAG_RENAME_SAME`, `422 TAG_REQUIRED`, `422 TAG_TOO_LONG`; whitespace-normalized `from` and a retry that finds nothing left; an `update` audit row and a tag snapshot revision per record; a stale row reported as `{ updated: 0, skipped: 1 }` with the competing save intact.
- Evidence (HTTP, CMS `:4005`, mock auth, `sen-tuan`): two probe pages created through the content API with overlapping tags → `GET /api/v1/admin/tags` returned the two probe tags at count 2 above the real tags; rename → `{ updated: 2, skipped: 0 }` and the list showed the new name at 2; merge onto the other tag → `{ updated: 2 }` and one tag left at 2; detach → `{ updated: 2, to: null }` and the probe tags were gone from the list; a blank `from` → `422`, a foreign `Origin` → `403`, no session → `401`. Probe pages, their revisions and audit rows were deleted afterwards (`content 3 / categories 0 / audit_logs 0 / content_revisions 0 / idempotency_keys 0`).
- Evidence (browser, `:4005/tags`): the page listed the tags with counts and a summary line; the rename dialog pre-filled the current name, typing an existing tag showed the merge warning (`Thẻ "silver" đã tồn tại (1 nội dung)`), saving renamed the tag and refreshed the list with a toast; the detach dialog named the tag and count and reported `Đã gỡ thẻ khỏi 1 nội dung`; the tag then disappeared from the list.
- Limits: a rename is sequential (`O(records with the tag)`) and only reports conflicts rather than retrying them; the count includes deleted records, on purpose, so a tag that survives only on deleted content can still be cleaned up; the list is capped at 500 tags with no pagination; tag changes are audited per record, not as a tag-level resource, so there is no single "who renamed this tag" row.

### P3.e (rest) — drag-and-drop category ordering (landed 2026-11-10)

- Target files: `tm-shared/packages/flow-contracts/src/category-admin.ts` (`AdminCategoryReorderRequestSchema`), `tm-cms/server/services/categoryService.ts` (`reorderCategory`, `writeCategoryPosition`), `tm-cms/server/api/v1/admin/categories/reorder.post.ts` (new), `cms-base/app/composables/useCategoryAdmin.ts` (`reorder`), `cms-base/app/pages/categories.vue` (draggable rows, drop zones, hint), `tm-cms/i18n/locales/{vi,en}.json` (`admin.categories.{dragHint,rootDrop,moved}`), `scripts/build/test-category-reorder.ts` (new), root `package.json` (`test:category-order`).
- Why: the tree had `order` and an edit dialog, so moving one category meant opening the dialog, guessing a number and saving; there was no way to reorder or reparent by dragging, which is the interaction the CMS already offers for menus.
- How: the server owns the numbers. One command takes `{ key, parent, index }`, validates parent/cycle/depth through the same `assertParentAllowed` the dialog uses, and writes only the rows whose value changed. Sibling orders are spaced by ten, so a drop is normally a midpoint between two neighbours (one row written); when the neighbours are adjacent or a bucket runs out of room, the bucket is renumbered with a spacing derived from `CATEGORY_MAX_ORDER`. A no-op drop is detected by comparing the position in the bucket (not the computed midpoint) and writes nothing. Each changed row keeps its `revision` guard and gets an audit entry; the response is the same flat list + tree the list endpoint returns, so the page re-renders from server truth instead of sorting locally.
- Editor: rows are draggable from a grip handle, the top third of a row drops before it, the bottom third after it and the middle inside it; a dashed "move to top level" zone appears while dragging; rows inside the dragged subtree refuse the pointer and the server refuses them too; a hint line explains the gesture.
- Evidence (service, disposable DB): `pnpm test:category-order` → 8 checks: a reparent writes one row and returns the new tree while the siblings keep their revision; a sibling drop honours the given index; a midpoint drop keeps orders unique; a squeezed bucket renumbers once with unique, in-range orders and room between rows; dropping a row back where it was is a no-op (same revision); `422 CATEGORY_CYCLE` for a move into its own descendant and onto itself; `422 CATEGORY_PARENT_NOT_FOUND` / `404 CATEGORY_NOT_FOUND` including another site; one audit row per changed row with the actor and `parent`/`order` in `changedFields`.
- Evidence (HTTP, `:4005`): two probe roots → `POST /api/v1/admin/categories/reorder` with `{ key: "probe-order-b", parent: "probe-order-a", index: 0 }` → `200` with `probe-order-b` at `parent: probe-order-a`, `order: 10`, `revision: 2`; moving it back to the root at index 0 gave `order: 890`; a cycle attempt → `422`.
- Evidence (browser, `:4005/categories`): dispatching native `DragEvent`s from row `probe-order-b` onto the middle of row `probe-order-a` highlighted the target, showed `Đã cập nhật vị trí danh mục` and re-rendered `probe-order-b` as its child (`order: 10`, `revision: 4`); the root drop zone highlighted and moved the same row back to the top level (`order: 910`, `revision: 5`), confirmed through the list API. Probe categories and their audit rows were removed afterwards (`categories 0 / audit_logs 0 / idempotency_keys 0 / content 3`).
- Limits: the categories page was exercised with synthetic mouse drag events only — there is no pointer-based touch path like the one menus gained, so moving a category on a phone is still the order field in the dialog; no multi-select or bulk move; the renumber path writes every row in the bucket (rare, and each write is individually audited).

### CNT-01 (rest) — tag filter on the content list (landed 2026-11-10)

- Target files: `tm-cms/server/services/contentService.ts` (`ContentListParams.tag`, exact match, 60-character cap), `tm-cms/server/utils/contentApi.ts` (`ContentListQuerySchema.tag`: trimmed, 1–60 characters), `tm-shared/nuxt-layers/cms-base/app/composables/useContentAdmin.ts` (`ContentListQuery.tag`), `tm-shared/nuxt-layers/cms-base/app/pages/content.vue` (tag select fed by `useTagAdmin`, `all` sentinel, reload on change), `tm-cms/i18n/locales/{vi,en}.json` (`admin.content.tag.{all,placeholder}`), `scripts/build/test-content-service.ts` (one new check).
- Behaviour: `GET /api/v1/admin/content?tag=…` adds `tags: "<tag>"` to the Mongo filter, so it composes with `status`, `type`, `q` and cursor pagination. The value is trimmed and capped server-side; the UI sends the exact name from the tag list, so there is no `$regex` and no index cost beyond the existing multikey array. `meta.counts` stays whole-site like every other filter, so the editor can see the filtered set against the site total.
- Editor: the list toolbar gains a fourth select fed by `GET /api/v1/admin/tags`, labelled `name (count)`, defaulting to "Tất cả thẻ". The options are fetched once on mount; a failed option fetch leaves the select empty instead of breaking the list, and a rename done on `/tags` appears on the next visit because nothing is cached.
- Reka detail: `SelectItem` rejects an empty-string value (the page renders a 500 with "A <SelectItem /> must have a value prop that is not an empty string"), so the default option uses an `all` sentinel that is translated to "no tag parameter" before the request.
- Evidence (service, disposable DB): `pnpm test:content` → 28 checks (one new): the filter returns exactly the tagged record, two records sharing a tag both come back, a padded value still matches, it composes with `status` (draft → 2 rows, published → 0), an unknown tag returns 0 rows while `counts` still equal the unfiltered counts, and another site's identically tagged record never leaks.
- Evidence (HTTP, `:4005`): `tag=dịch vụ` → 1 (`pages/dich-vu`), `tag=about` → 1 (`pages/gioi-thieu`), `tag=probe` → 1 (`probe-category-post`), `tag=khong-co` → 0, `tag=about&status=published` → 1, a blank tag → `422`, a 61-character tag → `422`, anonymous → `401`; every response kept `meta.counts.all = 3`.
- Evidence (browser, `:4005/content`): the toolbar select listed `Tất cả thẻ / about (1) / dịch vụ (1) / probe (1) / silver (1) / tư vấn (1)`; choosing `about (1)` issued `GET /api/v1/admin/content?status=all&tag=about&limit=20 → 200` and left exactly `pages/gioi-thieu` in the list, with no console errors.
- Limits: one tag at a time (no "any of these tags"), no negation, and the option list refreshes only on mount; the list itself is still page-limited to 50 rows per request like every other filter.

### P4.a / CAT-01 — catalog CRUD on CMS-owned collections (landed 2026-11-10)

- Decision: the CMS writes **new** collections (`catalog_items`, `catalog_categories`) and the storefront reader was re-pointed at them; the legacy `items`/`item_categories` are left untouched for rollback. This is the direction `docs/v2/04` describes and avoids `docs/v2/01`'s warning about turning the legacy reader into a write schema. Recorded as Q23 in [questions](../tasks/questions.md).
- Models: `tm-cms/server/models/catalog.ts` — localized title/slug/short description/description, `basePrice`/`salePrice`, SKU/uom/type/stock/manageStock, category ids, tags, attributes, variants, SEO, `searchString`, `sales`/`views` counters (kept so the `popular` sort still works), status (`draft|published|archived|deleted`), `isActive`/`isDeleted`, revision, timestamps. Unique indexes on (siteId, key) and (siteId, slug.vi); soft delete keeps the key, exactly like content.
- Service: `tm-cms/server/services/catalogService.ts` — list with status/type/tag/search/category (subtree), counts, cursor paging; create/update with revision conflict, immutable key, category resolution, `searchString` rebuild; publish/archive/restore/delete transitions; category create/update with subtree path + ancestors recomputation (cycle guard), delete refused while children or items remain; per-site tag aggregation.
- API: `/api/v1/admin/catalog/items` (+ `[id]`, `[id]/events`), `/api/v1/admin/catalog/categories` (+ `[id]`), `/api/v1/admin/catalog/tags`; same capability (`content.read`/`content.write`), CSRF and idempotency wrappers as content.
- Editor: `cms-base/app/pages/catalog.vue` (replaces the placeholder) with filters, counts, row actions, an item editor modal (both locales, prices, SKU, stock, categories, tags, images, SEO) and a flat category manager (parent select, rename, guarded delete). i18n `admin.catalog.*` in both locales.
- Migration: `pnpm migrate:catalog --site sen-tuan [--apply]` (`scripts/ops/migrate-catalog.ts`), dry-run by default, idempotent by `legacyId`, preserves `sales`/`views`, maps category ids/ancestors, and suffixes a colliding key/slug so no legacy row is lost (one legacy pair shares `man-khung-ngang`).
- Storefront: `tm-web/server/models/catalog.ts` reads `catalog_items`/`catalog_categories`; the subtree filter uses the stored `ancestors` array. Product/category/search/sitemap/cart paths needed no other change because the public mapper's field names are preserved.
- Evidence (service, disposable DB): `pnpm test:catalog` → 18 checks: normalization, parent path/ancestors, search string, duplicate key → `409`, invalid price → `422`, unknown category → `422`, publish visibility, stale revision → `409` (record unchanged), immutable key, counter preservation, composed filters + subtree, cross-site isolation, tag aggregation, delete guards, move rewriting the path, delete/restore transitions.
- Evidence (migration, `sen-tuan`): dry run reported 67 categories / 241 items; `--apply` wrote 67 categories and **241 items (229 published)**, matching the legacy counts exactly, and re-running wrote the same rows (no duplicates, no lost record after the collision fix). Legacy collections still hold their original documents.
- Evidence (HTTP CMS `:4005`): `GET /api/v1/admin/catalog/items` → 241 rows, `counts {all:241, draft:3, published:229, deleted:9}`; categories → 67 with `itemCount`; tags → empty (legacy items carry no tags); anonymous → `401`; foreign-Origin mutation → `403`. A disposable probe item was created, published, fetched from the storefront, then deleted and purged from `catalog_items`/`audit_logs` (DB back to 241 items, audit 0).
- Evidence (storefront `:4006`): `/products/ruot-goi-thuong` → 200 with the legacy title and price 120.000, `/categories/chan-ga-goi-dem` → 200 listing 8 products, `?search=goi` returns the migrated records (searchString rebuilt), `/sitemap.xml` lists **229** product URLs (equal to the published count), `/api/public/cart/validate` re-quotes a migrated item.
- Evidence (browser `:4005/catalog`): page renders 241 records with status/type/tag filters and `Tổng: 241 / Đã xuất bản: 229`; the edit modal opens with key locked and every field populated (title/slug/prices/SKU/uom/stock/3 categories); no console errors.
- Limits: variants and attributes are stored and preserved on save but are **not editable** in the UI yet (no variant editor); media fields are URL strings, not media-library picks (blocked by Q19); the catalog category manager is a flat list with a parent select, without drag ordering; there is no bulk price/stock/import tool (that is CAT-02).

### P4.a (rest) — variants and attributes editor (landed 2026-11-10)

- Target files: `tm-cms/server/models/catalog.ts` (two new invariants), `cms-base/app/pages/catalog.vue` (variant/attribute rows in the item modal, payload and validation), `tm-cms/i18n/locales/{vi,en}.json` (`admin.catalog.fields.{variants,addVariant,attributes,…}`, `admin.catalog.errors.{variantRequired,variantSkuRequired}`), `scripts/build/test-catalog-service.ts` (five new checks).
- Behaviour: a variable product now requires at least one variant and a simple product rejects variants, both server-side (`CATALOG_PAYLOAD_INVALID`) and in the modal before the request. Every variant row edits SKU, name, base/sale price, stock, active flag and is re-numbered by the same normalization used for created records; the item attribute list edits name/value. Opening the modal clones the stored variants/attributes, so cancelling never mutates the row still shown in the list, and saving sends them back instead of the empty arrays the first version submitted.
- Evidence (service, disposable DB): `pnpm test:catalog` → 23 checks (five new): variable without variants → `422`, simple with variants → `422`, variants + attributes round-trip through create and list, two variants sharing a SKU (case-insensitive) → `422`, and an update replaces the variant set while keeping attributes and bumping the revision.
- Evidence (browser, `:4005/catalog`, real `dem-bong-ep-vikosan`): the modal lists both existing variants (`SKU-HTFR44J8-7F-120X190`, `SKU-HTFR44J8-7F-150X190`) and the "Biến thể"/"Thuộc tính" sections; saving without edits returned "Đã lưu sản phẩm", and MongoDB still holds 2 variants with the same SKUs at revision 2 — the previous build would have wiped them.
- Limits: variant attributes (size/colour options per variant) are preserved but still not editable row-by-row; there is no bulk variant generation, and a variant SKU is required (a legacy variant without one is skipped by the migration).

### P4.a / CAT-02 — bulk price and stock (landed 2026-11-10)

- Contract: `tm-shared/packages/flow-contracts/src/catalog-admin.ts` adds `AdminCatalogBulkItemSchema` (`id`, `revision`, optional `basePrice`/`salePrice`/`stock`), `AdminCatalogBulkPatchSchema` (1–100 rows) and `AdminCatalogBulkResultSchema` (`results[]` with `ok`/`revision`/`error`, plus `succeeded`/`failed`), exported from the package.
- Service: `bulkUpdateCatalogItems` in `tm-cms/server/services/catalogService.ts` — one revision check per row, audit entry per changed row, and a no-op row (the value is already set) answers `ok` without bumping the revision. Duplicate ids → `CATALOG_BULK_DUPLICATE`, malformed id → `CATALOG_ID_INVALID`, missing row → `CATALOG_ITEM_NOT_FOUND`, stale revision → `CATALOG_REVISION_CONFLICT` (that row only), sale above base → `CATALOG_SALE_PRICE_INVALID`; one bad row never rolls back the good ones.
- API: `POST /api/v1/admin/catalog/items/bulk` (`tm-cms/server/api/v1/admin/catalog/items/bulk.post.ts`) behind `content.write`, same origin check and `no-store` as the rest of the catalog surface.
- Scope: `POST /api/v1/admin/catalog/items/bulk-by-filter` takes the list filter (`status`/`type`/`tag`/`category`/`q`) instead of explicit rows, resolves the selection server-side and hands it to the same per-row command; soft-deleted records are always skipped, a filter matching nothing answers `404 CATALOG_BULK_EMPTY`, a category key matching nothing answers the same, and more than 500 matches answers `422 CATALOG_BULK_TOO_LARGE` instead of truncating. The shared filter builder (`buildItemFilter`) backs both the admin list and this route so the two cannot drift. The bulk modal gained a scope radio (ticked rows / every record matching the filter), defaults to the filter scope when nothing is ticked, and the toolbar button is now always available with the selected count in its label.
- Ui: `cms-base/app/pages/catalog.vue` gained a checkbox per row, a "select all on this page" toggle, an "Đã chọn N" button and a bulk modal (base price / sale price / stock; a blank field keeps the current value). `useCatalogAdmin.bulkUpdate` posts the selection with each row's revision and the toast reports `Đã cập nhật X/Y`. i18n `admin.catalog.bulk.*`, `messages.bulkResult`, `errors.bulkNothing` in both locales.
- Evidence (service, disposable DB): `pnpm test:catalog` → 31 checks; the seven new ones cover a mixed batch (good row applied, stale row refused), a duplicate id, a no-op row keeping its revision, a foreign/unknown id failing alone, a filter-scoped batch skipping a deleted record and bumping only the live ones, an empty filter (both an unused status and an unknown category key) answering `CATALOG_BULK_EMPTY`, a filter batch keeping the per-row sale-price validation, and a 501-record filter answering `CATALOG_BULK_TOO_LARGE` with no row written.
- Evidence (HTTP `:4005`): two disposable probe items — create `201`, bulk `200` with per-row results (`ok:true revision 2` for the good row, `CATALOG_REVISION_CONFLICT` for the stale one), no-op batch `200` leaving revisions at 2 and 1, `422` for 101 rows, `401` anonymous, `403` foreign Origin.
- Evidence (browser `:4005/catalog`): filtered to `probe-bulk`, "select all" reported `Đã chọn 2`, the modal showed the right title/hint/labels, applying `135000` base price and stock `7` closed the dialog, toasted `Đã cập nhật 2/2 sản phẩm`, refreshed both rows to `Giá 135.000` and cleared the selection; MongoDB then held `basePrice 135000 / stock 7 / revision 2` on both. A second pass on two `probe-scope-*` rows opened the modal with the filter scope preselected (nothing ticked), `stock 5` reached exactly those two rows and the dialog closed with `Đã cập nhật 2/2`; ticking one row made the scope default back to "only the ticked rows" and a `80000` base price changed that row alone (`Đã cập nhật 1/1`). Probes and their audit rows were deleted afterwards (`catalog_items` back to 241, `audit_logs` 1), and the console showed no errors.
- Limits: bulk covers price and stock only (no category/tag/status/variant fields); ticked rows are capped at 100 per request and filter scopes at 500; there is no undo, no progress reporting for a long filter batch, and serial/IMEI/barcode/import remain open in CAT-02.

### P4.a / CAT-02 — barcode (landed 2026-11-10)

- Contract: `AdminCatalogItemSchema` and `AdminCatalogItemDraftSchema` in `tm-shared/packages/flow-contracts/src/catalog-admin.ts` gained `barcode` (a string; empty means none).
- Model: `barcode` is a trimmed 64-character string on `catalog_items`, folded into `searchString`, and guarded by a partial unique index `catalog_item_site_barcode` on `(siteId, barcode)` where `barcode > ''` — so every product without a barcode can coexist, while two products in one site cannot share one. The same barcode is free on another site.
- Service: a duplicate key that names `barcode` is translated to `409 CATALOG_BARCODE_EXISTS` instead of the generic key/slug error; the admin list search matches `barcode` alongside key/title/slug/SKU. Clearing a barcode frees it for another product on the next save.
- Editor: the item modal has a "Mã vạch" field next to SKU (hint: optional, unique within the site), the list row shows the barcode when present, the filter placeholder mentions it, and `CATALOG_BARCODE_EXISTS` maps to its own Vietnamese/English message.
- Migration: `migrate-catalog` now maps the legacy `barcode`, so a future snapshot keeps the identifiers; this snapshot's 241 legacy rows carry none, so nothing was backfilled.
- Evidence (service, disposable DB): `pnpm test:catalog` → 35 checks; four new ones cover trimming/returning/searching a barcode, a duplicate refused on both create and update, the same value allowed on another site plus many records with an empty barcode, and clearing a barcode so another product can claim it.
- Evidence (HTTP `:4005`): create with `"  8930000000099 "` → `201` storing `8930000000099`; second create with the same value → `409 CATALOG_BARCODE_EXISTS`; PATCH another item onto it → `409`; `?q=8930000000101` returns exactly the matching row; clearing the first item → `200` with `barcode: ""`; creating a new item with the freed value → `201`. Probes and their audit rows were deleted afterwards (`catalog_items` 241, `audit_logs` 1, no row keeps a barcode).
- Evidence (browser `:4005/catalog`): the search placeholder reads "…SKU hoặc mã vạch…", rows show `PBC-4 · 8930000000099`, the modal lists the "Mã vạch" field, saving a duplicate kept the modal open with "Mã vạch này đã thuộc về sản phẩm khác.", and saving a unique value closed it and searching that barcode returned the single row.
- Limits: barcode is a plain string — no checksum/format validation, no barcode scanning or label printing, and variants still have no barcode field of their own.

### P3.g — legacy-URL redirect map (landed 2026-11-10)

- Contract/model: `@tm/flow-contracts/redirect-admin` (301/302, draft/update/list schemas) and `tm-cms/server/models/redirect.ts` → `content_redirects` with `content_redirect_site_path_unique` plus a partial active-path index; the legacy `redirects` collection is untouched. Audit resource type `redirect` added to both enums.
- Service/API: `redirectService` normalizes paths (leading slash, no trailing slash, no query/hash/whitespace/absolute URL), refuses self-targets, duplicate paths and any map that would loop (checked over the whole active map on create and update), and resolves a path through at most five hops. `GET/POST /api/v1/admin/redirects` + `PATCH/DELETE /api/v1/admin/redirects/:id`, `content.read`/`content.write`, same-origin, idempotent, audited, `no-store`.
- CMS UI: `/redirects` page with old → target list, search, create/edit modal (301/302, active switch, note), inline enable/disable and guarded delete; nav entry gated by `content.read`; i18n `admin.redirects.*`, `nav.redirects` and the missing `admin.audit.resources.*` labels for menu/catalog/redirect.
- Storefront: `tm-web/server/middleware/redirects.ts` answers the stored 301/302 before routing (skipping API, Nuxt assets, file paths and unbound sites); `publicRedirects` caches lookups per database for 30s and the internal purge route now clears that cache too.
- Evidence: `pnpm test:redirects` → 12 checks; HTTP `:4005`/`:4006` create/duplicate/invalid/loop/stale-revision/301/404 flows; browser create/toggle/delete on `/redirects`. Probes and their audit rows were deleted (`content_redirects` 0, `audit_logs` 1).
- Limits: no automatic redirect when a slug changes, no wildcard/prefix rows, no 410 handling, no map import; a change reaches the storefront within 30s unless the purge secret is configured.

### CNT-01 / CNT-02 — content keywords (landed 2026-11-10)

- Contract/model: `keywords: string[]` on each content locale in `@tm/flow-contracts/content-admin` and `@tm/flow-contracts/content-public`; `content.ts` stores it per locale (20 max, 60 chars each, trimmed and de-duplicated, blanks dropped) and `revision.ts` keeps it in the snapshot so a restore cannot drop it.
- Commands/UI: the existing content create/update accepts the field (snapshot + diff included), `/content` shows a "Từ khóa" input per locale, and saving no longer clears `seo.image`.
- Storefront: the public projection carries the list and `[...slug].vue` emits `<meta name="keywords">` only when it is non-empty.
- Evidence: `pnpm test:content` → 25 model + 30 live service checks (normalisation, dedupe, 20/60 limits as `422`, public read, restore of keywords); HTTP `:4005`/`:4006` create → publish → public API and rendered tag, `PATCH` replacing the list, a page without keywords rendering no tag; browser edit-and-save on `/content` produced revision 5 with the new keywords and kept the SEO image. Probe content, audit rows and revisions were deleted (`content` 3, `audit_logs` 1).
- Limits: free text only — no global `keywords` collection, no rename/merge, no keyword filter in the admin list or public search, and no legacy keyword sync. Tags stay the taxonomy.

### CNT-02 — content attributes editor (landed 2026-11-10)

- The record modal (`cms-base/app/pages/content.vue`) now edits `attributes` as key/value rows with add/remove, instead of submitting `{}` and wiping whatever the API stored on every save.
- Keys are checked client-side against the model's pattern (`attributeKeyRequired`/`attributeKeyInvalid`/`attributeDuplicate`) before the request; blank rows are dropped; untouched numbers and booleans keep their stored type while a new value is a string.
- Evidence: `pnpm test:content` → 25 model + 30 live checks (attributes round-trip, unsafe key `422`); browser on a disposable `pages/probe-attributes` record with `{layout:'wide', count:5, featured:true}` loaded all three rows, refused a `9bad` key with the inline message, and saved `theme: gold` as revision 2 with the original types intact. Probe rows deleted (`content` 3, `audit_logs` 1).
- Limits: flat key/value only, new values are strings, no attribute filter or public projection, no per-type attribute schema.

### CNT-01 — keyword filter on the content list (landed 2026-11-10)

- `listContent` accepts `keyword` (trimmed, max 60) and matches it exactly against `locales.keywords`, so a value on any locale selects the record; the free-text `q` search now covers keywords next to key/title/slug.
- API query schema + `ContentListQuery` expose `keyword` (whitespace-only → `422`); the CMS toolbar has a debounced keyword input beside the tag filter; i18n `admin.content.keywordFilter`.
- Evidence: `pnpm test:content` → 31 live checks (exact hit, case mismatch empty, `en` locale matched, padded value, site isolation, `q` by keyword); HTTP `:4005` probes for exact/padded/uppercase/shared/`q`/blank; browser filtering narrowed to one row and clearing restored the list. Probe rows deleted (`content` 3, `audit_logs` 1).
- Limits: exact match only, one keyword at a time, no facet with counts, storefront search unchanged.

### P10.a — legacy content import (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| `pnpm migrate:content --site <id> [--tenant default] [--apply]` reads legacy `contents`/`content_categories` raw, plans in memory, and only writes with `--apply` (a dry run creates nothing, not even indexes) | `scripts/ops/migrate-content.ts`, `package.json` |
| `page`/`post`, key `pages/\<vi slug\>` / `posts/\<vi slug\>`, per-locale slug/title/excerpt/body HTML/keywords/SEO, category ids resolved to v2 keys, tag titles kept, `publishedAt`/`deletedAt`/timestamps carried | `normalizeContentInput` validates every planned record before writing |
| Extras with no v2 column become `legacy.format`, `legacy.template`, `legacy.thumbnail`, `legacy.parent`, `legacy.sort`, `legacy.showOnHome`, `legacy.priority`, `legacy.views` attributes (filterable through CNT-02); legacy gallery lists (4) and media embeds (6) are reported as not carried | — |
| Idempotent by `(siteId, key)` with `$setOnInsert` for `revision`/`schemaVersion`/`createdAt`; slug conflicts are suffixed and reported; no audit or revision rows are written | second `--apply` kept 123 rows at `revision 1` |

Real snapshot: the user's local `nuxt4-cms` (123 contents, 6 content categories, tenant `default`, all published). Dry run: 7 pages / 116 posts, 246 locales, `standard 101 / quote 6 / link 6 / gallery 4 / audio 3 / video 3`, 116 tagged, 116 categorized, 0 invalid, 0 conflicts, 42 legacy collections unchanged. Apply into a disposable copy (`tm_import_probe`): 6 categories + 123 contents; storefront `:4016` served `/api/public/content/gioi-thieu`, `pages/gioi-thieu`, `?locale=en` → `About Us`, the post list, 6 categories, `/gioi-thieu` 200 and 160 sitemap URLs. CMS `:4015` (site `sentuan-legacy`): `counts { all: 123, published: 123 }`, `?attributeKey=legacy.format&attributeValue=gallery` → the 4 gallery posts, `?q=dot-pha-ai` → 10, 6 categories, browser list 123 rows and a detail drawer with both locales, HTML body, tags and category. Legacy copy, imported site and probe database were deleted afterwards; `sen-tuan` still has its own 3 content records and 8 legacy contents. Still open: media/gallery import, redirects from legacy `fullPath`, keyword/tag vocabulary, menus.

### CNT-02 — attribute filter on the content list (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| `listContent` accepts `attributeKey`/`attributeValue`: name alone means "has the attribute", name + value means "equals as text" (so `5` and `true` find the number and the boolean); `$getField` keeps keys that contain dots addressable | `tm-cms/server/services/contentService.ts`, `tm-cms/server/models/content.ts` |
| The query contract reuses the model's key pattern, caps the value at 500, and refuses a value without a key (`422 CONTENT_QUERY_INVALID`) | `tm-cms/server/utils/contentApi.ts` |
| Two debounced toolbar inputs; the value box stays disabled until a key is typed | `tm-shared/nuxt-layers/cms-base/app/pages/content.vue`, `.../composables/useContentAdmin.ts`, `tm-cms/i18n/locales/{vi,en}.json` |
| Suites: `pnpm test:content` 25 model + 32 live checks | `scripts/build/test-content-service.ts` |

Live (`:4005`, `sen-tuan`, probe `pages/probe-attr-gold` = `{ material: 'gold', weight: 5, featured: true }`): `?attributeKey=material&attributeValue=gold` and `?attributeKey=weight&attributeValue=5` each returned only the probe, `?attributeKey=weight` found it by name alone, a wrong value returned none, and `?attributeValue=gold` / `?attributeKey=1bad` were both `422`. Browser (`:4005/content`): typing `material` left only the probe row, `silver` hid it, `gold` brought it back, counters unchanged. Probe and its audit row deleted (`content` 3, `audit_logs` 1). Still open: one attribute at a time, exact values only, and `$expr` cannot use an index.

### WEB-04 — keywords reach storefront search (landed 2026-11-10)

- `buildPublishedListFilter` matches `q` against `locales.keywords` too, inside an `$elemMatch` limited to the requested locale + fallback so an `en`-only keyword cannot surface a `vi` listing; no route or contract change (`/api/public/content?q=`, `/tim-kiem`).
- Evidence: `pnpm test:web-content` → 20 live reader checks (keyword-only hit, upper case, `en`-only keyword hidden from `vi`, draft keyword hidden); HTTP `:4006` probes for accented/upper/title/`.*`/unknown; browser `/tim-kiem?q=nhãn-hiệu-probe` rendered the card. Probe rows deleted (`content` 3, `audit_logs` 1).
- Limits: no diacritic folding or synonyms; search page highlights only title/excerpt matches.

### WEB-02 — a slug change leaves its own 301 (landed 2026-11-11)

- `tm-cms/server/services/contentSlugRedirects.ts` compares stored and submitted `locales` and writes one `301` row per changed locale (`/<old slug>` → `/<new slug>`, note `auto: slug changed`) with `$setOnInsert` on `(siteId, from)`; called from `updateContent` and `restoreContentRevision` via the new `ContentWriteMeta.redirects`, wired in the content PATCH and revision-restore routes.
- Nothing is written for a draft, an unchanged slug, or an old slug that names a real storefront route (`products`, `categories`, `danh-muc`, `bai-viet`, `tag`, `tim-kiem`, `gio-hang`); an existing row on the old path is kept, because a hand-typed target wins and `resolveRedirect` follows chains.
- Only the short URL is written: a record's key path (`/pages/<key slug>`) is immutable and keeps answering, which the live check confirmed.
- Evidence: `pnpm test:content` → 33 checks (generated row, hand-typed row kept, draft silence, per-locale rows, other-site isolation, reserved name skipped); HTTP `:4005` published probe rename → one redirect row, storefront `:4006` `/probe-slug-moi` → `301 /probe-slug-ba` with `/probe-slug-ba` `200` and `/pages/probe-slug-cu` still `200`; browser `:4005/redirects` rendered the row with its 301 badge and auto note. Probe record, revisions, audit rows and redirect deleted (`content` 3, `content_redirects` 0, `audit_logs` 1).
- Limits: each further rename adds a row instead of re-pointing the old one (the chain still resolves); deleting or unpublishing a record leaves its rows; no automatic rows for legacy imports or catalog legacy paths, and no 410.

### WEB-01 — latest content on the home page (landed 2026-11-11)

- `web-base/app/pages/index.vue` renders the three newest published posts between the newest products and the category strip, using the shared `WebContentList` grid and one `useAsyncData` call to `/api/public/content?type=post&locale=<locale>&limit=3` (keyed and watched by locale). No new server code, contract or route.
- The section renders only when posts came back, so an empty store shows no placeholder and a reader failure hides it instead of printing an error block on a marketing page; no counters or invented trending/sale labels.
- i18n `home.posts.{title,subtitle,viewAll}` in both locales.
- Evidence (`:4006`, `sen-tuan`): real content rendered `Giới thiệu Sen Tuấn` with its tags and date; four published probes produced exactly the three newest cards (4, 3, 2 — the oldest absent) with `hasMore true` from the API, and a draft probe appeared in neither the API nor the HTML. Probe rows and their revisions/audit entries deleted (`content` 3, `audit_logs` 1). `pnpm typecheck` and `pnpm lint` pass.
- Limits: fixed newest-first order and fixed count of 3, no per-site section configuration, no featured/trending/sale flag on a record, not in the sitemap or JSON-LD.

### WEB-08.b — breadcrumbs reach crawlers (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| `buildBreadcrumbJsonLd(baseUrl, entries)`: unlabelled and repeated steps dropped, positions 1..n, fewer than two steps → `null`, absolute step URLs not prefixed twice | `tm-shared/packages/flow-utils/src/seo.ts` |
| Six pages emit it beside their own block (`key: 'ld-breadcrumb'`): product detail, catalog category landing, content page, tag landing, content category landing and index | `tm-shared/nuxt-layers/web-base/app/pages/products/[slug].vue`, `categories/[slug].vue`, `[...slug].vue`, `tag/[tag].vue`, `danh-muc/[slug].vue`, `danh-muc/index.vue` |
| Suites: `pnpm test:web-site` 15 checks (3 new) | `scripts/build/test-web-site.ts` |
| Verified live `:4006` (`sen-tuan`): the Product/CollectionPage/Article pages carry `BreadcrumbList` with the right names and absolute URLs; the content category landing was checked with a disposable category in both locales, then deleted (`categories` 0, `audit_logs` 1). `pnpm typecheck` and `pnpm lint` pass | — |
| Limits: pages without a visible breadcrumb emit nothing; a step is text + URL only | — |

### WEB-08.c — listings reach crawlers (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| `buildItemListJsonLd(baseUrl, entries, { name })`: rows need a label and a link, repeated URLs kept once, positions 1..n, `numberOfItems`, 50-row cap, empty → `null` | `tm-shared/packages/flow-utils/src/seo.ts` |
| Seven pages emit it beside their existing block (`key: 'ld-items'`): catalog listing, catalog category landing, category index, post listing, tag landing, content category index and landing | `tm-shared/nuxt-layers/web-base/app/pages/products/index.vue`, `categories/[slug].vue`, `categories/index.vue`, `bai-viet/index.vue`, `tag/[tag].vue`, `danh-muc/index.vue`, `danh-muc/[slug].vue` |
| Filtered or paged views publish nothing, so a crawler cannot cache a filtered list as the catalog | same files |
| Suites: `pnpm test:web-site` 18 checks (3 new) | `scripts/build/test-web-site.ts` |
| Verified live `:4006` (`sen-tuan`): `/products` 12 rows, `/categories` 50 (capped from 67), `/bai-viet` 1, `/tag/about` 1, a catalog category 8; `/products?page=2`, `/products?q=bo` and an empty tag published none. `pnpm typecheck` and `pnpm lint` pass | — |
| Limits: name + URL per row only; a category index over 50 is truncated, not paginated; content rows link the stored `/pages/<slug>` path like the cards do | — |

### WEB-08.d — one public URL per content record (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| The listing row's `path` and a new sitemap row come from the localized slug, not the immutable key path | `tm-web/server/models/contentPublic.ts` |
| `sitemap.xml` publishes slug URLs (locale-free: default locale first, any locale as fallback) | `tm-web/server/utils/publicContent.ts`, `tm-web/server/routes/sitemap.xml.ts` |
| A detail page canonicalises on the resolved record's slug, so `/pages/<key>` still answers `200` but points canonical, OG, JSON-LD, breadcrumb and `ItemList` at `/<slug>` | `tm-shared/nuxt-layers/web-base/app/pages/[...slug].vue` |
| Verified live `:4006` (`sen-tuan`): `/gioi-thieu` and `/pages/gioi-thieu` both `200` with canonical `/gioi-thieu`; `/bai-viet` card `href="/gioi-thieu"` and `ItemList` url `http://localhost:4006/gioi-thieu`; sitemap lists `/gioi-thieu` and no `/pages/` URL. `pnpm test:web-site` 18, `pnpm test:web-content` 20, `pnpm typecheck`, `pnpm lint` pass | — |
| Limits: the key path stays served but unadvertised; a record without a slug in the requested locale is listed under its default-locale slug, so there is still no per-locale sitemap | — |

### WEB-08.e — the site describes itself (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| `buildWebSiteJsonLd(baseUrl, { name, language })`: `WebSite` with name, home URL and content language; no block without a name | `tm-shared/packages/flow-utils/src/seo.ts` |
| No `SearchAction`: `/tim-kiem` is `noindex, follow` on purpose, so the markup does not advertise it | `tm-shared/packages/flow-utils/src/seo.ts`, `tm-shared/nuxt-layers/web-base/app/pages/tim-kiem.vue` |
| Home page emits the block beside `Organization` (`key: 'ld-website'`), language follows the UI locale | `tm-shared/nuxt-layers/web-base/app/pages/index.vue` |
| Suites: `pnpm test:web-site` 21 checks (3 new) | `scripts/build/test-web-site.ts` |
| Verified live `:4006` (`sen-tuan`): `/` → `Organization + WebSite` with name, home URL, `vi-VN`, no `potentialAction`; the `en` cookie flips `inLanguage` to `en-US`; `/tim-kiem` stays `noindex, follow`. `pnpm typecheck` and `pnpm lint` pass | — |
| Limits: one `WebSite` block per language, not per locale-preferred URL; no `sameAs` or contact point | — |

### WEB-08.f — share cards are absolute and per record (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| The relative `og:image` default is removed from the three customer head configs and from the generator | `tm-shared/customer-layers/web/{sentuan,bag-post,default}-web/nuxt.config.ts`, `scripts/generate-customer.ts` |
| One absolute site-wide default, resolved against the request origin, that record pages override | `tm-web/app/app.vue` |
| Product detail resolves its share image absolute, with alt/twitter tags and absolute JSON-LD images; catalog categories resolve their image; content pages keep theirs | `tm-shared/nuxt-layers/web-base/app/pages/products/[slug].vue`, `categories/[slug].vue`, `[...slug].vue` |
| Verified live `:4006` (`sen-tuan`): `/products`, `/bai-viet`, `/gio-hang`, `/` → absolute site card with brand alt; a product → its own image with `Bộ HN-BO` alt; a catalog category → its Cloudinary image with `Bộ thường` alt; a content page → site card with the page title as alt; all carry `twitter:image`. `pnpm typecheck` and `pnpm lint` pass | — |
| Limits: no image dimensions, no generated per-record cards, content category landing shares the site card | — |

### WEB-08.g — the sitemap lists the listing pages too (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| `/bai-viet`, `/products`, `/categories` are sitemap entries now, each only while its listing has records, with `lastmod` from the newest record shown | `tm-web/server/routes/sitemap.xml.ts` |
| Catalog category rows keep the record's own timestamp instead of `null` | `tm-web/server/utils/catalogService.ts`, `toCatalogCategorySitemapEntry` in `tm-web/server/utils/catalogMapper.ts` |
| Verified live `:4006`: 303 `<loc>` (was 300) and 300 `<lastmod>`; `/bai-viet` `2026-11-07T04:33:14.378Z`, `/products` `2026-11-10T05:07:17.392Z` (equal to the newest item's `updatedAt`), `/categories` `2026-11-10T03:39:47.313Z`; `/gio-hang`, `/tim-kiem` and `/pages/*` absent. `pnpm typecheck` and `pnpm lint` pass | — |
| Limit: home, `/danh-muc` and tag rows carry no `lastmod` (their payload has no timestamp) | — |

### WEB-02 — a removed path can answer 410 (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| `410` is a legal map row that stores no target; a gone row with a target is refused | `tm-shared/packages/flow-contracts/src/redirect-admin.ts`, `tm-cms/server/models/redirect.ts`, `tm-cms/server/services/redirectService.ts` |
| A gone path never joins the loop graph, and a chain that reaches one stops there | `redirectService.ts` (`loadChain`, `assertNoConflict`, `resolveRedirect`) |
| The storefront flags the request and renders the site's own error page with gone copy in both locales | `tm-web/server/middleware/redirects.ts`, `tm-web/server/utils/publicRedirects.ts`, `tm-web/app/middleware/public-gone.global.ts`, `error.vue`, `tm-web/i18n/locales/*.json` |
| The CMS editor offers 410 and hides the target field | `tm-shared/nuxt-layers/cms-base/app/pages/redirects.vue` |
| Verified live: a 410 row answers `410` with the app error page (vi/en), `422` with a target, 301 unchanged (`Location: /gioi-thieu`), unknown path still `404`, probes removed and both paths `404` again after deleting the rows; 15 redirect-service checks, `pnpm typecheck`, `pnpm lint` pass | — |
| Limits: exact path only (no prefix/wildcard), CMS label is an English literal, editor not viewed in a browser | — |

### WEB-08.h — every sitemap row carries its own freshness (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| The builder accepts the home freshness instead of always seeding an undated home row | `tm-shared/packages/flow-utils/src/seo.ts` (`buildSitemapEntries`) |
| Home is dated by the newest content/catalog record; tag pages by one aggregation over published content | `tm-web/server/routes/sitemap.xml.ts`, `tm-web/server/utils/publicCategories.ts` (`listContentTagSitemapEntries`) |
| Verified live `:4006`: 303 `<loc>` and 303 `<lastmod>` (all rows dated); `/` `2026-11-10T05:07:17.392Z`; `/tag/about` and `/tag/silver` `2026-11-07T04:33:14.378Z`; a draft post's tags stay out. 24 web-site checks, `pnpm typecheck`, `pnpm lint` pass | — |
| Limit: a `/danh-muc` index row stays undated (content categories carry no timestamp) | — |

### WEB-03 — an unknown product or category answers 404 (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| The catalog read recognises a 404 whichever field `$fetch` put the status in, instead of calling it "unavailable" | `tm-shared/nuxt-layers/web-base/app/composables/useCatalog.ts` (`catalogErrorStatus`, `catalogErrorCode`) |
| The server waits for the read to settle before answering, so the guard can actually run | `useCatalogItem`/`useCatalogCategory` (`ready`), `products/[slug].vue`, `categories/[slug].vue` |
| A missing product/category/content says so on the error page, in both locales | `error.vue`, `tm-web/i18n/locales/*.json` (`contentNotFound`, `productNotFound`, `categoryNotFound`, `contentUnavailable`) |
| Verified live `:4006`: unknown product and category slugs → `404` with their own copy (vi + en); `bo-hn-bo`, the real category landing, `/products`, `/categories`, `/gioi-thieu`, `/bai-viet`, `/tag/about`, `/gio-hang`, `/tim-kiem`, `/` → `200`. `pnpm typecheck`, `pnpm lint` pass | — |
| Limit: the client-side navigation to a deleted slug was not driven in a browser | — |

### WEB-08.i — an empty tag page is noindex (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| A tag landing with nothing published is `noindex, follow`; with a post it is indexable again; the site-wide switch still forces `noindex, nofollow` | `tm-shared/nuxt-layers/web-base/app/pages/tag/[tag].vue` |
| Verified live `:4006`: `/tag/about` `index, follow`; `/tag/huong-dan` (draft-only) `noindex, follow`; `/tag/khong-ton-tai` (invented) `noindex, follow` with the empty state intact. `pnpm typecheck`, `pnpm lint` pass | — |
| Limit: an empty or draft-only tag still answers `200` by design (the posts may return) | — |

### WEB-08.j — an empty content category landing is noindex (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| An existing category with no published post is `noindex, follow`; a known `indexable: false` site still forces `noindex, nofollow` | `tm-shared/nuxt-layers/web-base/app/pages/danh-muc/[slug].vue` |
| Verified live with a temporary category, removed afterwards: `200` + `noindex, follow` (vi/en), absolute canonical and `og:url`, empty copy rendered; unknown slug `404`; `/danh-muc` `200` indexable | — |
| Limits: the populated branch was not driven live; only the robots change is staged, the page's other SEO additions wait with the in-progress editor field in the worktree | — |

### Gates re-run across the whole tree (landed 2026-11-12)

| Slice | Evidence |
| --- | --- |
| Eighteen domain scripts run back to back against the local `sen-tuan` database: layers, hub contracts, content, categories, catalog, media, audit, settings, menus, bulk, tags, redirects, category order, retention, DB binding, web content, web site, web cart | `.devlogs/gates.log`, all exit 0 |
| `pnpm typecheck`, `pnpm lint` and `pnpm validate:registry` pass | `.devlogs/gate-*.log` |
| `pnpm verify:scaffold` was red (142/145): the web branch still demanded a static `property: 'og:image'` in each customer head config, which was removed on purpose because a relative share image is unfetchable. The check now asserts the opposite — no relative `og:image` in the head config, the `og-cover.png` asset present, and the storefront pages publishing `ogImage` | `scripts/verify-scaffold.ts`, 157/157 |
| The gate failure predates this slice (it has been red since `af722fb`); it was found by running the suite, not by a code change | `git log -- scripts/verify-scaffold.ts` |
| Limits: the suite exercises the local databases and no browser; `test:hub`/`test:iam` still do not certify the real Hub contract | — |

### WEB-08.v — the catalog branch of the empty-site test (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| The run copies one real item and one real category from `sen-tuan`, retags them, and checks `/products`, `/categories/<slug>`, the category index data and four sitemap rows, then deletes both | `scripts/build/test-empty-listing.ts` (31 checks) |
| Localized `slug.vi` matters: a string slug reaches the sitemap but not the page lookup; the probe now writes both locales and clears `pid`/`ancestors` | same file |
| `categories` API caches for 5 min, so its page flip is asserted through the API on an unused query key; `/products` (60s) is watched on the page | same file |
| The run clears Nitro's on-disk cache and any stray probe rows before it starts, and waits for empty states instead of assuming them | same file |
| Limits: direct inserts prove storefront read/index rules, not the CMS write path | — |

### WEB-08.u — the populated branch is covered too (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| `pnpm test:empty-listing` writes one published post, verifies `/bai-viet` and its tag turn indexable and the sitemap gains the listing and record rows, then deletes it and verifies both revert | `scripts/build/test-empty-listing.ts` (25 checks) |
| Cleanup is idempotent in `finally`; after a run the borrowed database has 0 content, 0 redirects, 0 audit and 0 idempotency rows | `bag-post` counts |
| The sitemap sweep no longer returns from `main`, so later checks still run when a sitemap has rows | same file |
| Limits: the record is inserted directly, so this covers the storefront read/index rules, not the CMS publish flow | — |

### WEB-08.t — 410 coverage, and why `/danh-muc` looked empty (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| `pnpm test:empty-listing` writes one 410 redirect row, checks the gone page (`410` + `noindex` + no canonical) and the sitemap, then removes the row in `finally` | `scripts/build/test-empty-listing.ts` (20 checks), `bag-post.content_redirects` 0 after |
| The six `content_categories` rows in `sen-tuan` are legacy documents in a collection nothing reads; the storefront reads `categories`, which has 0 rows — that is why `/danh-muc` is empty | database inspection, `tm-web/server/models/contentCategoryPublic.ts` |
| The empty branch of `/danh-muc/<slug>` was verified live with a temporary category: `200` + `noindex` + self canonical, `/danh-muc` indexable only while it listed one, `404` after deletion | probe run, cleaned up |
| Limits: the probe writes to `sen-tuan` briefly; a crash would leave `probe-danh-muc-rong` behind for manual removal; legacy `content_categories` cleanup belongs to the Hub import slice | — |

### WEB-08.s — the last inline rule, and 404 coverage (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| `/danh-muc/<slug>` now uses `usePageRobots({ empty })`; only that hunk was committed, the editor's other changes in the file stay uncommitted | `tm-shared/nuxt-layers/web-base/app/pages/danh-muc/[slug].vue` |
| `pnpm test:empty-listing` asserts unknown product and category detail URLs are `404` + `noindex` + no canonical | `scripts/build/test-empty-listing.ts` (18 checks) |
| Verified live: three unknown detail URLs `404` + `noindex`; `/danh-muc`, `/products`, `/` unchanged; sitemap 303; typecheck, lint pass | — |
| Limits: `/danh-muc/<slug>`'s empty branch not driven live (no served content category) | — |

### WEB-08.r — two URLs that changed answer, on purpose (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| `/products?sort=newest` is a duplicate of `/products` (default sort), so it is `noindex, follow`; the bare catalog stays indexable | live `:4006` |
| `/bai-viet?page=1` and `?page=2` are ignored parameters on a cursor-paged listing, so they are query views and `noindex, follow` | live `:4006` |
| Both keep their canonical and none is in the sitemap; nothing previously crawlable became unreachable | live `:4006` |
| If the post listing gains numbered pages it needs `keepQuery: ['page']` and the paged canonical rule | — |
| All 24 `scripts/build/test-*.ts` pass after the refactor | `for f in scripts/build/test-*.ts` |

### WEB-08.q — one robots rule, in one place (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| `usePageRobots({ keepQuery, empty, alias, never })` holds the site switch, the query-view rule, the alias rule and the empty rule | `tm-shared/nuxt-layers/web-base/app/composables/usePageRobots.ts` |
| Eleven pages now pass facts instead of repeating the rule; the paged catalog and category pages keep their `page` exception | pages under `tm-shared/nuxt-layers/web-base/app/pages/` |
| `pnpm test:empty-listing` gained the tag landing and its query view (16 checks) | `scripts/build/test-empty-listing.ts` |
| After the refactor, 22 live URLs answer exactly as before; sitemap 303; typecheck, lint pass | live `:4006` |
| Limits: `danh-muc/[slug].vue` keeps its inline rule until the editor's in-flight work on that file lands | — |

### WEB-08.p — tag pages and their query views (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| Query views of a tag are `noindex, follow` with the canonical unchanged; the plain tag URL and its `og:url` were already right | `tm-shared/nuxt-layers/web-base/app/pages/tag/[tag].vue` |
| The tag listing pages by cursor, so `?page=2` renders page one and no paged canonical is involved (same as `/bai-viet`) | live `:4006` |
| An unknown tag stays `200` + `noindex` by decision, and is absent from the sitemap | live `:4006` |
| Verified: 6 URLs (plain, `?page=1`, `?page=2`, `?utm_source`, draft-only tag, unknown tag); sitemap unchanged at 303 with no `?page=` rows; typecheck, lint pass | — |
| Limits: numbered tag pagination does not exist yet; if added it needs the paged-canonical rule | — |

### WEB-08.o — catalog detail pages follow the same rules (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| Product query views are `noindex, follow`; the plain product URL and its canonical were already right | `tm-shared/nuxt-layers/web-base/app/pages/products/[slug].vue` |
| A plain paged category list is its own canonical and stays indexable; page one keeps the bare URL; other parameters and an empty first page are `noindex` | `tm-shared/nuxt-layers/web-base/app/pages/categories/[slug].vue` |
| Verified: 28 live checks over plain/query/paged/unknown URLs on both pages; sitemap unchanged at 303 with no `?page=` rows; typecheck, lint pass | — |
| Limits: no empty catalog category exists in real data, so that branch is inspected, not driven | — |

### WEB-08.n — one record, one URL; error pages out of the index (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| `/<slug>` audited: `200`, `index`, self canonical, sitemap row with `lastmod`, no `/pages/` rows — no change needed | live `:4006` |
| The `/pages/<key>` alias and query views of a record are `noindex, follow` while keeping the canonical on `/<slug>` | `tm-shared/nuxt-layers/web-base/app/pages/[...slug].vue` |
| The error page asks to be indexed by nobody: `noindex, follow` on 404, 410 and 5xx, no canonical | `tm-shared/nuxt-layers/web-base/app/error.vue` |
| Verified: 26 live checks including a probe `410` row removed afterwards; sitemap unchanged at 303; DB back to pre-probe counts; typecheck, lint pass | — |
| Limits: 5xx branch not driven live; error page keeps the site-default title | — |

### WEB-08.m — home and search under the same criteria (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| `/tim-kiem` audited: `noindex, follow`, self canonical with the query stripped, absent from the sitemap, no `SearchAction` — no change needed | live `:4006` |
| Only the bare `/` is indexable; a query string (`?utm_source=`, `?page=2`) is `noindex, follow` with the canonical on `/` | `tm-shared/nuxt-layers/web-base/app/pages/index.vue` |
| Home stays indexable with nothing to list; `/tim-kiem` stays noindex; the empty sitemap carries neither listing row | `scripts/build/test-empty-listing.ts` (14 checks) |
| Verified live: `/` index, `?utm_source`/`?page=2` noindex, `/tim-kiem` + `?q=` noindex, sitemap 303 rows all 200 + indexable; typecheck, lint pass | — |

### WEB-08.l — the empty-listing branch is a script, not an afternoon (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| `pnpm test:empty-listing` borrows a registry customer with an empty database, starts the web app against it, checks robots/canonical/sitemap and stops it | `scripts/build/test-empty-listing.ts`, `package.json` |
| It refuses a populated database or a customer without a binding instead of asserting the wrong thing | `--site=sentuan` and `--site=default` both exit 1 before starting a server |
| Live run against `bagpost` / `bag-post`: 12 checks pass, port 4006 released, database untouched | `.devlogs/web-empty-bagpost.log` |
| Limits: policy only, not empty-state copy; the empty customer must already exist in the registry | — |

### WEB-08.k — listing views answer search engines honestly (landed 2026-11-11)

| Slice | Evidence |
| --- | --- |
| A filtered or searched listing view is `noindex, follow` instead of asking to be indexed while canonicalising away | `tm-shared/nuxt-layers/web-base/app/pages/bai-viet/index.vue`, `products/index.vue` |
| A paged catalog view is its own canonical and stays indexable; with a filter it is not | `products/index.vue` (`urlFilters`, `canonical`) |
| An empty listing is `noindex, follow` until it has a record; the site-wide switch still wins | the three index pages |
| Verified live `:4006`, 11 checks: plainer listings `index, follow`; `?tag`, `?q`, `?sort`, `?page&sort` `noindex, follow`; `?page=2` self-canonical; `/gio-hang` unchanged `noindex` without canonical. `pnpm typecheck`, `pnpm lint` pass | — |
| Sitemap audited after the change: 303 URLs, all 200 + indexable + self-canonical, so no row had to be removed | `.tmp` audit, deleted |
| Empty branch exercised live on the `bagpost` / `bag-post` database (0 content, 0 catalog): `/bai-viet`, `/products`, `/categories` and the newly fixed `/danh-muc` index all `noindex, follow`, sitemap down to `/`; nothing written; `sentuan` restored | — |
| `/danh-muc` index leaves the index while it has no category | `tm-shared/nuxt-layers/web-base/app/pages/danh-muc/index.vue` |
| Limits: `/bai-viet` has no page URLs (cursor pagination) | — |

## Next slices

### Ready now (no decision or credential needed)

Nothing in the current docs is both unblocked and meaningful right now (the two keyword search records above closed the last gap that did not need a decision or credential): each remaining gap is either decided out of scope, waiting for a credential, or a whole domain (orders, stock, finance, HR, CRM) that the v2 plan puts after the storefront parity work rather than in this queue.

### Deliberately not in scope (decided, not blocked)

Recorded in [ADR 0002](../docs/decisions/0002-owner-decisions.md) so they are not re-opened as gaps:

- **WEB-06 checkout** — no payment provider and no order storage (Q17). The cart and its server-side re-quote remain the end of the flow; the three invariants (server reprice, duplicate rejection, out-of-stock refusal) stay listed for the slice that opens it.
- **WEB-07 forms** — no delivery target (Q18), so there is no stub that would swallow submissions. The settings' contact address is the only address in the system.
- **Media in the public projection, logo URL, OG images** — no public media origin (Q19/Q13); the `PublicSite` schema has no media field on purpose.
- **Locale-prefixed URLs and `hreflang`** — storefront keeps `no_prefix` (Q20).
- **Durable events, queue, cron** — nothing schedules publishes or pruning (Q12/Q21); `pnpm prune:retention` is manual and dry-run by default.
- **Hub import and the three remaining customers** — no export authorisation and no database names (Q5/Q22/Q2), so only `sentuan` is exercised.

### Waiting for an external fact (no workaround)

- **Production `TM_MONGO_URI`** — production data work and P10. Local and disposable databases are what CI exercises today.
- **Cloudinary credentials** (or another public origin) — the projection above.
- **Vercel token + customer domains** — deployment; nothing here is built for a host-specific runtime beyond the current Nitro targets.
- **Legacy data snapshot** — migration dry-run; no fixture is invented to stand in for it.

## Superseded v1 decisions

- "Use TM Hub as the general business backend" — reversed by ADR 0001: Hub owns IAM only. Existing Hub-backed content/config/media/mail/notification pages are transitional and must migrate to MongoDB services (P3/P8).
- "AI Workspace via Hub AI endpoints" — dropped from scope; AI is optional and would live in tm-websites, not Hub business APIs.
- Open questions from the v1 queue (git init, Hub-public content API, catalog data source) are resolved or superseded by the v2 docs and ADR; do not reopen them from this file.

## V1-era record (evidence only — not the current plan)

Kept because the earlier Hub-backed modules and the Web PWA were verified live before the v2 reset; the v2 baseline marks all of it as transitional and requires fresh parity evidence per slice.

- Hub resource modules delivered and live-verified on 2026-11-06 against `tm-hub` (`sentuan`): dashboard aggregates, `/users`, `/roles`, `/routes` (Hub returns 0), `/configs` (0 keys), `/media` (`error.cloudinaryNotConfigured` callout), `/mail` (queue offline without Redis), `/notifications` (empty), `/connections` (7 providers), `/content` (1 published record of the paired `app_sentuan_web`).
- Web PWA (Task 16) — `injectManifest` worker `tm-web/service-worker/sw.ts`, offline page `tm-web/public/offline.html`, `globPatterns` scoped to assets, navigation network-first with `/offline.html` fallback. Verified on a production build at `127.0.0.1:4016`: worker activated and controlling, 71 precache URLs plus a `tm-offline` cache, offline navigation rendered the offline page, SSR returned after the server restarted. CMS still has a manifest only, no service worker.
- Historically passing gates for those changes: `validate:registry`, `verify:scaffold`, `test:layers`, `test:hub`, `test:web-content`, typecheck, lint, `validate:build:cms|web`, CMS build matrix (`default`, `sentuan`, `bagpost`, `thanhtung`, `hoangvi`), Web builds for `sentuan`/`bagpost`/`default`.
