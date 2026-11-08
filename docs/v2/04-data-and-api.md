# 04 — MongoDB, business services and API contracts

Status: target design. Current Web catalog is only a partial reader; no full shared business write layer is claimed.

## Storage and connection rules

- One logical database per customer; CMS and Web share its business records. Server deployment configuration selects the database, never request input.
- Prefer separate least-privilege credentials for CMS writes and Web reads. Public writes use narrowly authorized command paths with only the required privileges, not unrestricted public CRUD.
- Cache connections by trusted binding and register models on the corresponding connection. Do not switch/disconnect a global connection to serve different customers concurrently.
- The current [Web connection helper](../../tm-web/server/utils/mongo.ts) assumes one bound target. It is not a multi-tenant runtime connection manager.
- Define pool limits and timeouts for the deployment concurrency. Transactions require an appropriate MongoDB topology; test on a replica set before claiming transactional order/stock behavior.
- Keep database URIs and provider credentials out of browser config and logs. Business settings in MongoDB may reference server secrets; do not return secret values through settings APIs.

## Domain ownership map

Collection names below describe intended logical records. Existing physical names and schema changes must be recorded per migration; this table is not a command to create or rename all collections immediately.

| Domain | Records and invariants |
| --- | --- |
| Site/configuration | Company profile, sites, menus, module settings, SEO defaults, theme/content settings, provider references; public projection excludes secrets |
| Content | Pages/posts, categories, formats, tags/keywords, attributes, localized slug/body/SEO, revisions, publication schedule and deletion state |
| Catalog | Items, categories, options, attributes, variants/SKU, units, prices, serial/IMEI rules and public availability; private cost fields never leak |
| CRM/partners | Customers, suppliers, addresses, segments, loyalty and Hub subject links; scoped portal ownership |
| Commerce | Orders, quotations, carts, returns, shipments and immutable order-line/address/price snapshots |
| Purchasing | Purchase orders, receipts, rejections, supplier prices and payable references |
| Inventory | Warehouses, stock ledger, reservations, transfers, adjustments, stocktakes and serial movements |
| Finance | Payments, ledger entries, allocations, receivables/payables and reporting inputs; explicit currency/rounding and reversal rules |
| HR | Staff profiles, attendance, shifts, salary configuration and payroll; private compensation access |
| Communications/media | Media metadata/folders, forms/leads, mail templates/outbox, notification inbox/push subscriptions, delivery outcomes |
| Operations | Business audit, migration versions, import jobs, idempotency records and durable publication/invalidation events |

Hub IAM audit stays in Hub; business changes and actor references are audited in this database. Provider delivery may use external infrastructure, but the business ownership remains local.

### Implemented physical schema

Only what a migration has actually created is listed here; the table above remains the target map.

| Migration | Physical records | Notes |
| --- | --- | --- |
| `content-audit-idempotency-indexes` v2 | `audit_logs`, `idempotency_keys` | Business audit entries (site, resource, action, resulting revision, from/to status, changed fields, actor, request id) and retry keys (site+key unique, request hash, stored response, TTL `expiresAt`). Both collections are created by this migration, so an operator sees them appear on the next connection. `audit_logs` and revision snapshots have no automatic bound: `pnpm prune:retention --site <id> --apply` is the operator command that trims them (dry run by default). |
| `content-revision-indexes` v3 | `content_revisions` | Immutable snapshot per content revision (site, content id, revision, status, action, changed fields, the editable fields, actor, request id). Unique `(siteId, contentId, revision)` so a retried command can never fork the history; a snapshot never stores status/`publishedAt`/`deletedAt`, so restoring an old version restores wording only. |
| `media-indexes` v5 | `media` | Binary files are **not** stored in Mongo: a row keeps the site, folder, storage key, MIME type, byte size, checksum, kind, title/alt, revision, uploader and delete stamp. Unique `(siteId, storageKey)`; `(siteId, folder, createdAt)` and `(siteId, kind)` cover the library filters. Bytes live behind the storage adapter (`TM_MEDIA_DIR`, default `.data/media`) under `<site>/<yyyy>/<uuid>.<ext>`. |
| `category-indexes` v4 | `categories` | Editorial category tree for this site: immutable `key`, optional `parent` key, `order` (0–9999), a monotonic `revision` and one localized `{ locale, name, slug }` per language. Unique `(siteId, key)` and `(siteId, locale, slug)`; the tree depth is validated in the service (max 5 levels) because MongoDB cannot express it as an index. |
| `settings-indexes` v6 | `settings` | One document per site holding business configuration only: company identity (display/legal name, tax id, contact), SEO defaults, enabled locales with their default, and the module switches (`content`, `catalog`, `orders`, `inventory`). Unique `(siteId)` makes a concurrent first save resolve to one document; the monotonic `revision` is the editor lock and `updatedBy` stores the session actor. Endpoints and credentials stay in Hub's connection registry — nothing secret belongs in this collection. |
| `menu-indexes` v7 | `site_menus` | Site navigation: immutable `key` (`main`, `footer`), display `name`, monotonic `revision` and an ordered `items` list (max 30) where each item is a per-locale `label` plus one `link` (`content` key, `category` key, or a literal path/URL). Unique `(siteId, key)`. The collection is **`site_menus` on purpose**: every migrated database already has the legacy shop `menus` documents (no `siteId`), so they are left untouched until the import slice rather than colliding on the new unique index. |
| `content-indexes` v1 | `content`, `tm_migrations` | `content` stores a normalized slug per locale, a draft/scheduled/published/archived/deleted status, a publish window and a monotonic `revision`; unique `(siteId, key)` and `(siteId, locale, slug)`. Each locale also declares a body `format` (`markdown` | `html` | `text`) so the storefront never guesses how to render it. Applied migrations are recorded in `tm_migrations` with id, version, checksum and timestamp. |

### Implemented admin content API (v1)

First real business namespace. All routes require a Hub-verified session and the module capability; the site id comes from deployment configuration, never from the request. Responses are `no-store`; mutations additionally require a same-origin request.

| Route | Input | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/v1/admin/content` | `status` (`all`+5), `type`, `q` (≤80 chars, escaped regex over key/title/slug), `cursor`, `limit` (≤50) | `{ success, data: AdminContent[], meta: { nextCursor, hasMore, counts } }` | Newest first, `_id` desc with the id as the tie-breaker; `counts` is a site-wide status bucket set |
| `POST /api/v1/admin/content` | draft payload (`type`, `key`, `locales[]`, `categories`, `tags`, `media` ids, `attributes`, `publishAt`, `unpublishAt`) | `201` + created record, always `draft` / `revision: 1` | Client-supplied `status`/`revision`/`publishedAt`/`deletedAt` are dropped; duplicate key or slug → `409` |
| `GET /api/v1/admin/content/:id` | — | record | Another site's id → `404` |
| `PATCH /api/v1/admin/content/:id` | same draft payload + `revision` | updated record, `revision + 1` | Stale revision → `409 CONTENT_REVISION_CONFLICT`; changed `key` → `422 CONTENT_KEY_IMMUTABLE` |
| `POST /api/v1/admin/content/:id/events` | `event` (`publish`/`schedule`/`unpublish`/`archive`/`restore`/`delete`), `revision`, `publishAt` for `schedule` | updated record | Invalid transition `422 CONTENT_TRANSITION_INVALID`; publish ahead of `publishAt` `422 CONTENT_PUBLISH_AT_FUTURE`; schedule in the past `422 CONTENT_PUBLISH_AT_PAST` |
| `POST /api/v1/admin/content/bulk` | `action` (`publish`/`archive`/`delete`), `items[]` (`id`, `revision`), 1–50 items | `200` + `{ action, results[], succeeded, failed }` | Every row runs the single-record command with its own optimistic lock, audit entry and revision snapshot, so one stale row never rolls back or hides the others. Row errors sit inside `results[]` (`CONTENT_REVISION_CONFLICT`, `CONTENT_TRANSITION_INVALID`, `CONTENT_NOT_FOUND`, `CONTENT_BULK_DUPLICATE`) instead of failing the request; `schedule` is not offered because each record needs its own `publishAt`; an unknown action, 0 items or more than 50 → `422 CONTENT_BULK_INVALID` |
| `GET /api/v1/admin/content/:id/history` | `limit` (≤50) | `{ success, data: AdminContentAudit[] }` | Newest first; another site's id → `404`. Each entry carries the action, resulting `revision`, `fromStatus`/`toStatus`, `changedFields`, actor and `requestId` |
| `GET /api/v1/admin/content/:id/revisions` | `limit` (≤50, default 30) | `{ success, data: AdminContentRevision[] }` | Revision summaries newest first; another site's id → `404` |
| `GET /api/v1/admin/audit` | `resourceType` (`content`/`category`/`media`), `action` (9 values), `resourceId`, `actorId`, `q` (≤80 chars, escaped regex over key/id and actor name/email), `from`/`to` (ISO 8601 with offset), `cursor`, `limit` (1–100, default 30) | `{ success, data: AdminAuditEntry[], nextCursor, hasMore, total }` | Site-scoped business trail written by the command paths, newest first (`_id` desc). `total` counts the filter, ignoring the page window, so the UI can label "N entries match". Capability `apps.logs.read`; bad enum, date, cursor or limit → `422 AUDIT_QUERY_INVALID` |
| `GET /api/v1/admin/content/:id/revisions/:revision` | — | `{ success, data: AdminContentRevisionDetail }` | Snapshot plus a field-by-field `diff` against the current record; unknown revision → `404 CONTENT_REVISION_NOT_FOUND` |
| `POST /api/v1/admin/content/:id/revisions/:revision/restore` | `revision` (the editor's current revision) | updated record, `revision + 1` | Writes a new revision from the old snapshot and an audit entry with action `revert`; publication status is untouched. Current revision → `422 CONTENT_REVISION_CURRENT`; identical content → `422 CONTENT_REVISION_UNCHANGED`; stale revision → `409 CONTENT_REVISION_CONFLICT` |

Every mutation above accepts two optional headers:

- `Idempotency-Key` (8–128 chars of `A-Za-z0-9_-`). A retry with the same key and the same payload replays the stored response with `Idempotent-Replay: true`; the same key with a different payload is `409 IDEMPOTENCY_KEY_REUSED`; a malformed key is `422 IDEMPOTENCY_KEY_INVALID` before any write. Keys are stored per site in `idempotency_keys` for 24h (TTL index).
- `X-Request-Id` (≤64 chars). Correlation only: it is copied into the audit entry and never used for authorization or uniqueness. A malformed value is dropped rather than failing the request.

Bulk edits are a loop over the single-record commands, never a transaction: each row keeps its own `revision` check, audit entry, revision snapshot and `publishedAt`/`deletedAt` semantics, and a failing row leaves its neighbours applied. Because the request carries explicit revisions and the state machine rejects a repeated transition, a retry is safe without an `Idempotency-Key`. The CMS selection bar and the dialog are the only client; the cap of 50 keeps one request bounded.

Capabilities: `content.read` for reads, `content.write` for every mutation (missing capability → `403 FORBIDDEN` with the missing list). Error envelope: `{ success: false, error: { code, message, details? } }` with stable codes the CMS maps to localized messages.

### Implemented admin category API (v1)

One category tree per site, shared by pages, posts and the storefront filters. Keys are the stable identity (`parent` references a key, never an id), so renaming a display name never rewrites content rows. Categories have no revision snapshots — the audit trail in `audit_logs` (`resourceType: category`) is the history.

| Route | Input | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/v1/admin/categories` | — | `{ success, data: AdminCategory[], tree: AdminCategoryNode[] }` | Flat rows sorted by `order`, `key`, plus the same rows nested as a tree with `depth` and `children`. A record whose parent went missing is surfaced as a root instead of disappearing |
| `POST /api/v1/admin/categories` | `key`, `parent`, `order`, `locales[]` (`locale`, `name`, `slug`) | `201` + created category, `revision: 1` | The key is normalized (trim, lower case, `-` separators); a missing slug falls back to the name. Duplicate key/slug → `409`, unknown parent → `422 CATEGORY_PARENT_NOT_FOUND`, depth > 5 → `422 CATEGORY_DEPTH_EXCEEDED` |
| `PATCH /api/v1/admin/categories/:id` | same payload + `revision` | updated category, `revision + 1` | `key` is immutable (`422 CATEGORY_KEY_IMMUTABLE`); moving a category under itself or a descendant → `422 CATEGORY_CYCLE`; stale revision → `409 CATEGORY_REVISION_CONFLICT` |
| `DELETE /api/v1/admin/categories/:id` | `revision` | `{ id, key }` | Refused while the category still has children (`422 CATEGORY_HAS_CHILDREN`) or any content uses the key (`422 CATEGORY_IN_USE`) |

Capabilities are the content ones: `content.read` to list, `content.write` for every mutation. Each mutation records an audit entry with the actor and the changed fields.

### Implemented admin media API (v1)

Binary files never enter MongoDB. A `media` row holds the metadata and an unguessable storage key; the bytes live behind one storage adapter (`TM_MEDIA_DIR`, default `<cwd>/.data/media`, git-ignored) and are served from that key. Keys are `<site>/<yyyy>/<uuid>.<ext>`, where the extension comes from the detected MIME type, never from the uploaded file name, so a rename cannot change how a file is served. Objects are never rewritten in place, which is why the public URL can be cached forever.

Uploads are limited to `image/png`, `image/jpeg`, `image/webp`, `image/avif`, `image/gif` and `application/pdf` (no SVG, no HTML) and 5 MB per file; `originalName` is kept as display metadata only, with path segments and control characters stripped.

| Route | Input | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/v1/admin/media` | `q` (≤80 chars, escaped regex over title/original name), `kind` (`image`/`document`), `folder`, `cursor`, `limit` (≤50) | `{ success, data: AdminMedia[], meta: { nextCursor, hasMore, counts, folders } }` | Newest first; `counts` is `{ all, image, document }` for the site and `folders` lists the folders in use |
| `POST /api/v1/admin/media` | multipart `file` (required), `folder`, `title`, `alt` | `201` + created row | The folder is normalized (`Landing / Hero` → `landing/hero`); a disallowed type or oversized file → `422 MEDIA_TYPE_NOT_ALLOWED` / `422 MEDIA_TOO_LARGE`, a missing file → `422 MEDIA_FILE_REQUIRED` |
| `PATCH /api/v1/admin/media/:id` | `title`, `alt`, `folder`, `revision` | updated row, `revision + 1` | Metadata only — storage key and bytes are immutable; stale revision → `409 MEDIA_REVISION_CONFLICT` |
| `DELETE /api/v1/admin/media/:id` | `revision` | `{ id, key }` | Refused while a content record still references the id (`422 MEDIA_IN_USE`); removes the row and the object, keeps the audit trail |
| `POST /api/v1/admin/media/bulk` | `action` (`move`/`delete`), `folder` (required for `move`), `items[]` (`id`, `revision`), 1–50 items | `200` + `{ action, folder, results[], succeeded, failed }` | Each row runs the single-file command, so the revision lock, folder normalization, in-use guard and audit entry are unchanged; a failing row never rolls back the others. Row errors live in `results[]` (`MEDIA_REVISION_CONFLICT`, `MEDIA_IN_USE`, `MEDIA_NOT_FOUND`, `MEDIA_UPDATE_UNCHANGED`, `MEDIA_BULK_DUPLICATE`); an unknown action, 0 items, more than 50 items or an invalid folder → `422 MEDIA_BULK_INVALID` / `422 MEDIA_FOLDER_INVALID`. `delete` requires `media.delete`, `move` requires `media.upload` |
| `GET /media/<site>/<yyyy>/<uuid>.<ext>` | — | the bytes | Public and site-scoped (a key from another site is `404`); `Content-Type` from the stored MIME type, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Cache-Control: public, max-age=31536000, immutable` and `Cross-Origin-Resource-Policy: cross-origin` so the storefront may embed it |

Capabilities: `media.read` to list, `media.upload` for uploads and metadata edits, `media.delete` to remove. Every mutation records one `audit_logs` entry with `resourceType: media`. A content record carries a `media` array (≤20 ids) that is part of the edit draft, the revision snapshot, the restore path and `changedFields`, so attachments are versioned with the record.

### Implemented admin settings API (v1)

| Route | Input | Output | Rules |
| --- | --- | --- | --- |
| `GET /api/v1/admin/settings` | — | `{ success, data: AdminSiteSettings }` | Returns the saved document, or the defaults with `revision: 0` and `updatedAt: null` for a site that was never saved. Capability `configs.read`; `no-store`. |
| `PATCH /api/v1/admin/settings` | `revision`, optional `company`/`seo`/`locales`/`modules` sections | `{ success, data: AdminSiteSettings }` | Sections merge into the stored document; untouched sections are never cleared. Capability `configs.write`, same-origin mutation check, `Idempotency-Key` support. Stale revision → `409 SETTINGS_REVISION_CONFLICT`, an empty diff → `422 SETTINGS_UPDATE_UNCHANGED`, a default locale that is not enabled → `422 SETTINGS_LOCALES_INVALID`, a malformed email/locale/field → `422 SETTINGS_PAYLOAD_INVALID`. One `audit_logs` entry (`resourceType: settings`, `resourceKey: site-settings`) per accepted save, listing the changed sections. |

The document never carries a secret: Hub keeps endpoints and credentials, so `GET` can return it whole to an authenticated admin.

### Implemented admin menus API (v1)

| Route | Input | Output | Rules |
| --- | --- | --- | --- |
| `GET /api/v1/admin/menus` | - | `{ success, data: AdminMenuSummary[] }` | Site scope, sorted by key. A summary is `id, key, name, revision, itemCount, updatedAt`; the editor fetches one menu in full when it opens it. Capability `configs.read`; `no-store`. |
| `GET /api/v1/admin/menus/:id` | - | `{ success, data: AdminMenu }` | Full document with items. A menu id from another site is `404`; a malformed id is `422 MENU_ID_INVALID`. |
| `POST /api/v1/admin/menus` | `key`, `name`, optional `items` | `{ success, data: AdminMenu }`, `201` | The key is folded to a slug (`Menu chinh` -> `menu-chinh`) and cannot change afterwards. Duplicate key -> `409 MENU_KEY_EXISTS`, unusable key -> `422 MENU_KEY_INVALID`, empty name -> `422 MENU_NAME_REQUIRED`. Capability `configs.write`, same-origin check, `Idempotency-Key`. |
| `PATCH /api/v1/admin/menus/:id` | `revision`, optional `name`/`items` | `{ success, data: AdminMenu }` | Items replace the whole ordered list. Every item needs at least one label (`MENU_LABEL_REQUIRED`), a known `link.type` (`MENU_LINK_TYPE_INVALID`) and a target that matches that type (`MENU_TARGET_INVALID`): a content key may carry a folder segment, a category target must already be a key, a URL must start with `/` (not `//`) or be absolute. More than 30 items -> `422 MENU_ITEMS_LIMIT`. Stale revision -> `409 MENU_REVISION_CONFLICT`, no diff -> `422 MENU_UPDATE_UNCHANGED`, changing `key` -> `422 MENU_KEY_IMMUTABLE`. One `audit_logs` entry (`resourceType: menu`) listing the changed fields. |
| `DELETE /api/v1/admin/menus/:id` | `?revision=` | `{ success, data: { id, key } }` | Deletes against the revision the editor saw; a stale one is `409`. One `audit_logs` entry, action `delete`. |

### Implemented public content read (Web)

The storefront reads the same customer `content` collection **directly**, with its own public policy: no Hub call, no CMS admin API, no session. The Web owns its projection and guard (`tm-web/server/models/contentPublic.ts`), the reader (`tm-web/server/utils/publicContent.ts`) and the shared DTO (`@tm/flow-contracts/content-public`, subpath export only).

| Route | Input | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/public/content/**` | path = content key (`pages/gioi-thieu`) or the requested locale's slug (`gioi-thieu`); `?locale=vi|en` | `{ success, data: PublicContent }` | Unknown locale normalizes to `vi`; a record missing the requested locale falls back to `vi` instead of 404. Only `published` records inside their publish window are readable — draft, scheduled-future, archived and deleted are `404`. Responds `Cache-Control: public, max-age=30, s-maxage=300, stale-while-revalidate=600` and `Content-Language`; the payload is the allowlist `key, locale, slug, title, excerpt, body, format, seo, publishedAt` with no status/revision/schedule internals. |
| `GET /api/public/content` | `type` (`page|post|fragment`), `tag`, `category`, `q` (≤80 chars), `sort` (`newest|oldest`), `cursor` (`_id` of the last row), `limit` (≤50, default 12), `?locale=vi|en` | `{ success, data: PublicContentListItem[], meta: { nextCursor, hasMore, limit } }` | Same publish policy as one record, same locale fallback, **no body** in the projection. `q` is a literal, case-insensitive match over the localized title/slug/excerpt and the key (regex metacharacters are escaped, so `.*` searches for that text); an empty `?q=` means no search, a longer one → `422`. Invalid facet/cursor → `422`. Order is `_id` desc/asc so the cursor is exact. |
| `GET /api/public/content/categories` | `?locale=vi|en` | `{ success, data: PublicContentCategory[] }` | Categories the storefront may link to, in the requested locale with the `vi` fallback; each row carries only `key`, `slug`, `name`, `parent`, `locale`. No ordering/revision/audit fields leave the database. |
| `GET /api/public/content/categories/:slug` | path = the locale's category slug (`trang-suc`, `jewelry`); `?locale=vi|en` | `{ success, data: PublicContentCategory }` | Resolves the landing-page URL to the immutable `key` stored on content records; unknown slug → `404`, so a landing page never renders for a category that does not exist. A category with no published content still resolves and shows the listing's empty state. |
| `GET /sitemap.xml` | — | one `<loc>` per published record | Storefront URLs carry no locale prefix, so the sitemap is locale-free and lists each record once; `lastmod` comes from `updatedAt`. |
| `GET /robots.txt` | — | `text/plain` body | `TM_SITE_INDEXABLE=false` (preview) → `User-agent: *` + `Disallow: /`; otherwise the API and `/tim-kiem` are disallowed and `Sitemap: <base>/sitemap.xml` is advertised on the canonical origin. The body is built by the shared `buildRobotsTxt` so the two branches are unit-tested. |
| `GET /api/public/site` | `?locale=vi|en` | `{ success, data: PublicSite }` | Company identity, SEO defaults, enabled locales and the resolved header/footer menus, read from the customer database's `settings`/`site_menus` — never from Hub and never from a session. Cached per locale (`public-site:<locale>`); revisions, actors keys and module switches stay private via `PublicSiteSchema`. |
| `GET /api/v1/admin/categories/:id/history` | `?limit=1..50` | `{ success, data: AdminContentAudit[] }` | Categories keep no revision snapshots, so their `audit_logs` rows (`resourceType: category`, scoped by the record id) are the whole history. `content.read`; another site's id or an unknown one is `404`. |
| `GET /api/v1/admin/media/:id/history` | `?limit=1..50` | `{ success, data: AdminContentAudit[] }` | Same shape for one file: upload, metadata edits and the delete entry (`resourceType: media`). `media.read`; a malformed id is `422` and another site's or an unknown id is `404 MEDIA_NOT_FOUND`. |
| `GET /api/public/site-config` | — | `{ success, data: SiteConfig }` | **Still transitional: reads Hub public config** (`fetchHubPublicConfig`) and derives company name/currency from app config. Kept only for the catalog currency and social links until the catalog slice reads the customer database; identity and navigation come from `/api/public/site`, which is what the layout now renders. |

`/api/public/site` is the local-MongoDB storefront identity route and the one the layout renders through `usePublicSite()`: brand name and contact details come from the settings document, the header/footer navigation from `site_menus`, and both fall back to the static `useSiteConfig()` values when a site has not saved them. Page metadata follows the same order: the settings display name and default description are the first choice for the home and product structured data, and the translated copy is the fallback. A menu item never stores a resolved URL — the read path turns a `content` key into the catch-all path, a `category` key into `/danh-muc/<slug>` for the requested locale (falling back to the storefront default locale, then the key), and passes a `url` target through only when the CMS already accepted it as a rooted path or absolute `http(s)` link. `/api/public/site-config` remains the Hub-backed legacy reader for currency and social links and is retired with the catalog slice, so the two are not parallel identity sources.


Landing pages built on these routes:

- `/tag/<tag>` lists every published record carrying that free-form tag, whatever its type, and renders the empty state when only drafts carry it.
- `/danh-muc/<slug>` resolves the category slug to its key, then lists the records in that category; the display name is locale-aware while the filtered key never changes, so renaming a category cannot orphan content.
- `/bai-viet` keeps its `tag`/`category` filters and now carries a bounded search box writing `?q=`; the query is trimmed and capped client-side and rejected server-side when longer than 80.
- `/sitemap.xml` lists the tag and category landing pages next to the content URLs.
- `/tim-kiem` is the storefront search page. It adds no new read endpoint: the same bounded `q` goes to `/api/public/content?q=` and `/api/public/products?search=`, and the page renders the two result groups separately so each collection keeps its own publish policy. Search pages are `noindex, follow` and are not listed in the sitemap.

Body rendering follows the locale's declared `format`: `html` is sanitized, `markdown` is rendered by the safe Markdown renderer, `text` is printed with preserved line breaks. The CMS editor exposes the same three choices, so a body is never rendered under a guessed format.

Route naming note: this slice stays on the current Web namespace (`/api/public/*`) instead of the proposed `/api/v1/public/*`, because the existing storefront routes and their tests already live there. Move it with the rest of the namespace sweep, once a slice needs the v1 prefix for a real consumer — do not publish both paths.

### Implemented public cart (Web)

The cart is client-owned: the browser stores only item ids, optional variant SKUs, quantities and the price the visitor was shown. Every render of `/gio-hang` re-quotes those lines, so prices, availability and totals always come from the published catalog instead of from storage a visitor can edit.

| Route | Input | Success | Notes |
| --- | --- | --- | --- |
| `POST /api/public/cart/validate` | `{ lines: [{ itemId, variantSku?, quantity, expectedPrice? }] }`, 1–20 lines, quantity 1–99 | `{ success, data: PublicCart }` | Read-only computation over the same publish filter as the catalog: no session, no CSRF token, `Cache-Control: no-store`. Unknown, unpublished or deleted ids come back as an `item_unavailable` line with no price; a product with variants and no SKU, or an unknown SKU, is `variant_unavailable`; an out-of-stock line keeps the price but contributes `0` to `subtotal`/`itemCount`; `expectedPrice` mismatch is reported as `price_changed` while the response still quotes the current price. Malformed input, quantity above 99 or more than 20 lines → `422 CART_INVALID`. |

The builder (`buildPublicCart` in `@tm/flow-contracts/public-cart`) is pure, so the tests cover every branch without a server or a database. Client state lives in `useCart` (`localStorage`, one key per site origin); it hydrates on mount, syncs each stored `expectedPrice` to the quoted one after a successful revalidation so a price notice appears once rather than on every reload, and keeps unavailable lines visible with a per-line message until the visitor removes them. `/gio-hang` is `noindex, follow`, because a cart is per visitor and has no canonical URL.

## Shared versus host-specific code

Shared server package: validated schemas/model factories, command invariants, transaction boundaries, money/stock calculations and domain events. Shared app/server package: Zod DTOs, enums, safe validation and pure helpers.

CMS endpoints: require verified context and module capability, validate input, authorize the resource, call commands/admin queries, map admin DTOs.

Web endpoints: use published/site-scoped queries and public DTOs; portal operations require authenticated subject ownership; public commands validate minimal input and use anti-abuse controls. Do not reuse an admin query that happens to omit a few fields.

## API namespaces and compatibility

The current Web uses `/api/public/*`, CMS uses `/api/auth/*` and `/api/hub/*`. New business namespaces are **proposed**: `/api/v1/admin/*`, `/api/v1/public/*`, `/api/v1/customer/*`, `/api/v1/supplier/*`. They are not existing endpoints just because legacy used similar names.

For each slice, choose one target route contract and update all consumers/tests together. Do not create duplicate permanent routes or silently break existing callers. Preserve public website URLs independently of API naming; add compatibility only for a verified consumer and a documented removal plan.

| Concern | Contract requirement |
| --- | --- |
| Input | Zod validation at API boundaries; allowlisted filters/sorts; bounded page sizes/uploads; reject query operators and unauthorized fields |
| Lists | Cursor pagination with stable sort and unique tie-breaker; return `data` and `nextCursor`; test no missing/duplicate items |
| Success/errors | Shared typed response contract with correct HTTP status and stable error code; no raw provider errors/secrets |
| Concurrency | Admin content writes carry the record `revision`; a stale editor gets `409` and must reload instead of overwriting |
| Authorization | Capability plus tenant/site/resource ownership; permission naming must match the verified Hub contract |
| Mutations | Explicit state transition, actor, concurrency policy, idempotency where retry has side effects |
| Public output | Positive field allowlist; exclude costs, supplier prices, private stock details, internal notes, personal data and draft content |
| Caching | Public successful reads only; never cache auth, private data, checkout, mutations or sensitive errors |
| Audit | Actor, resource, action, timestamp, correlation ID and safe before/after change; no credentials or full sensitive request body |

Write endpoint documentation beside each implemented slice: route, schema, roles/capabilities, ownership, success/error examples, cache behavior, idempotency and tests. Do not invent an OpenAPI file until there are implemented contracts to describe.

## Transactional business rules

- Checkout re-reads item/variant validity, authoritative prices, stock, taxes/discounts and shipping rules. Client totals and prices are never authoritative.
- Use integer minor units or a reviewed decimal strategy per currency; do not mix floating-point rounding rules across hosts. Record timezone/date semantics for stock, payroll and reports.
- Stock reservation/release and order state changes must be atomic or use an explicitly tested compensating workflow. Reject duplicate serial movements and overselling under concurrent requests.
- Posted payments/payroll/stock history are corrected by reversals or adjustments, not silent destructive edits. Each domain defines its valid state machine before endpoints are added.
- External payments, shipping labels, email and push need idempotent delivery and retry policies. A mocked gateway or a visible card form is not a real payment integration.
- Publication commits enqueue a durable invalidation event when required. Do not perform silent fire-and-forget cache purge as the only consistency mechanism.

## Legacy migration sequence

1. Inventory exact source collections, schemas, indexes, enum values, relation IDs, locales, timezones, media references and URL patterns for the selected customer. Use local fixtures or authorized snapshots, never casually inspect production records.
2. Define source-to-target mapping and preserve stable IDs where safe. Map legacy local user IDs to Hub subjects through a reviewed identity table; unresolved identities remain inaccessible.
3. Reconcile existing Hub-backed business records too: content/config/media metadata may already live there. Export/import only with explicit authorization. Do not discard these records because the legacy MongoDB snapshot lacks them.
4. Write a repeatable dry-run migration with counts, validation errors, duplicate/slug collisions and referential checks. Preserve a migration version/checkpoint and idempotency.
5. Test the migration on a disposable database. Compare order/stock/payment totals, references, publication status and URL resolution, not only document counts.
6. Back up and demonstrate restore. Define write freeze or controlled delta capture, cutover order and rollback criteria before production mutation.
7. Switch one customer, verify CMS/Web/portal/provider behavior, then expand. Do not run reset/seed scripts as migration shortcuts.

No migration or production write is authorized by this documentation task. Customer MongoDB provisioning, external provider credentials and authoritative IAM remain separately tracked prerequisites.
