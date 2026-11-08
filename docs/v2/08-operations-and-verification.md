# 08 — Operations and verification

## Toolchain and local execution

Use pnpm only. Root [package.json](../../package.json) declares `pnpm@12.15.0` and Node `^24.15.0 || >=26.0.0`; the lockfile governs resolution. Do not change versions or install a global tool merely to make a gate pass. Host packages define dev ports CMS 4005 and Web 4006.

From the monorepo root in Git Bash:

```sh
pnpm install --frozen-lockfile
TM_CUSTOMER_ID=sentuan TM_AUTH_MODE=hub pnpm dev:cms
TM_CUSTOMER_ID=sentuan pnpm dev:web
```

Use separate terminals for dev servers. Local Hub must be configured explicitly; starting a server that inherits production credentials can affect shared systems. Prefer a local Hub stub and disposable MongoDB fixtures for tests. Do not execute target-controlled code during a security audit unless the audit's required sandbox controls are available.

## Current configuration inventory

These are source-observed inputs, not a new `.env` template and not proof that setting them implements the target architecture. See [CMS config](../../tm-cms/nuxt.config.ts), [Web config](../../tm-web/nuxt.config.ts) and [registry](../../tm-shared/customer-layers/registry/customers.ts).

| Input | Current consumer / caution |
| --- | --- |
| `TM_CUSTOMER_ID` | Build selection; explicitly set for every build. Hosts fall back to default locally; Vercel missing identity fails closed. |
| `TM_APP_KIND` | Optional mismatch guard, `cms` or `web` |
| `TM_HUB_URL` | Hub base URL; use an isolated test service locally and HTTPS in production |
| `TM_AUTH_MODE` | CMS defaults to `hub`; mock must never be accepted as production auth |
| `TM_CMS_APP_ID`, `TM_WEB_APP_ID` | Optional overrides of registry app IDs; require deployment-binding validation |
| `TM_TENANT_ID` | Current override; not authorization and must not bypass registry/app consistency |
| `TM_HUB_SECRET` | Current CMS server-only legacy integration input; do not assume it is the Hub JWT signing key or a verified service identity |
| `TM_CONTENT_APP_ID` | Current paired Hub content ownership override; transitional, remove only when business consumers/data migrate |
| `TM_MONGO_URI`, `TM_MONGO_DB` | Current Web-only server DB connection/binding; CMS business binding is target work |
| `TM_SITE_ID`, `TM_SITE_URL`, `TM_SITE_INDEXABLE` | Web site identity/domain/indexability; ensure preview noindex and correct production canonical URL |
| `TM_CURRENCY` | Current Web public currency default; domain money rules still need implementation |
| `TM_IMAGE_DOMAINS` | Current image host list; maintain a deliberate allowlist |
| `REVALIDATE_SECRET` | Current Web shared-secret purge; not signed replay-safe invalidation |
| `TM_PWA_DISABLED` | Any non-empty value disables current PWA, including the string `false`; unset to allow production PWA |

Current custom `TM_*` values are read in configuration/build paths. Do not assume changing an environment variable after deploying a built artifact updates it: verify Nitro runtime override behavior and generated output for each hosting mode. Never put secrets into `runtimeConfig.public` or customer assets.

Provider secret names and provisioning steps must be documented with each implemented adapter. Do not invent unsupported env flags or copy embedded legacy defaults.

## Existing verification commands

Run these from the root, preserving exit codes and full relevant output:

```sh
pnpm validate:registry
pnpm verify:scaffold
pnpm test:layers
pnpm test:hub
pnpm test:iam
pnpm test:db
pnpm test:content
pnpm test:categories
pnpm test:media
pnpm test:bulk
pnpm test:web-content
pnpm --dir tm-shared run typecheck
pnpm typecheck
pnpm lint
TM_CUSTOMER_ID=sentuan pnpm validate:build:cms
TM_CUSTOMER_ID=sentuan pnpm validate:build:web
TM_CUSTOMER_ID=sentuan pnpm build:cms
TM_CUSTOMER_ID=sentuan pnpm build:web
```

Root build commands invoke host `build:vercel`, which validates and builds; they do not publish a deployment. A later build/prepare can regenerate `.nuxt/eslint.config.mjs`: rerun lint after the final generation step before claiming a fresh lint PASS. Inspect typecheck output as well as exit status. Never truncate gates through `tail` or mask failures through a pipeline.

`pnpm hub:check` is a connectivity probe and contacts the configured Hub; run only against an authorized endpoint. `pnpm cache:clear` deletes generated outputs; it is not a normal first troubleshooting step and must not race running builds/dev servers.

`pnpm test:db` needs a local MongoDB; with none reachable it prints `NOT RUN` instead of failing, so treat its absence as BLOCKED evidence, never as a pass. `pnpm test:content` has the same requirement and creates then drops a disposable `tm_test_content` database. `GET /api/health` on the CMS reports `status`, `hub` and `database` without exposing URIs, tenant ids or credentials, and is the readiness probe for the DB binding.

## Database preparation and migrations

- Business collections are created by migrations, not by a startup seed. The first migration (`content-indexes`, version 1) creates the `content` indexes; applied ids, versions, checksums and timestamps live in `tm_migrations`.
- Migrations apply in version order and record only after their body succeeds, so a migration body must be idempotent. A different body under an applied id is a `MIGRATION_CONFLICT` and must ship as a new version, never as an edit.
- Index creation uses `createIndexes()` (additive). `syncIndexes()` is not used against a customer database because it deletes indexes the process does not know about.
- Preparation is once per pooled connection and is not cached on failure. An operator who drops an index outside the app gets it recreated on the next connection.
- Inspect `tm_migrations` and the `content` indexes before and after a deploy; a successful app rollback does not undo an applied migration.

Existing contract/scaffold tests do not replace new business unit/integration tests. Add and document exact commands as those suites are implemented; do not claim a nonexistent `pnpm test:all` or E2E script.

### CMS content slice smoke (v1)

Run against a CMS dev server with a Hub session and a bound MongoDB. Replace host/credentials with the authorized environment; never paste real tokens into shell history on a shared machine.

```sh
curl -s -c cookies.txt -X POST http://localhost:4005/api/auth/login \
  -H 'content-type: application/json' -d '{"email":"...","password":"..."}'
curl -s -b cookies.txt 'http://localhost:4005/api/v1/admin/content?limit=5'
curl -s -b cookies.txt -X POST http://localhost:4005/api/v1/admin/content \
  -H 'content-type: application/json' -d '{"type":"page","key":"pages/about","locales":[{"locale":"vi","title":"Giới thiệu","slug":"gioi-thieu"}]}'
```

Expected: `GET` returns `{ success, data, meta.counts }`; `POST` returns `201` with `status: draft`, `revision: 1`; repeating the same `key` returns `409 CONTENT_KEY_EXISTS`; a `PATCH` without the current `revision` returns `409 CONTENT_REVISION_CONFLICT`; a mutation with a foreign `Origin` returns `403 CSRF_ORIGIN_MISMATCH`; a request without the session returns `401`. The record is visible in MongoDB only inside the database the registry assigns to that customer.

### Revision diff and restore smoke (P3.c)

```sh
# Snapshots exist from the revision the feature shipped onwards.
curl -s -b cookies.txt 'http://localhost:4005/api/v1/admin/content/<id>/revisions?limit=30'
curl -s -b cookies.txt 'http://localhost:4005/api/v1/admin/content/<id>/revisions/1'

# Restore v1 as a new revision; `<current>` is the record's revision right now.
curl -s -b cookies.txt -X POST http://localhost:4005/api/v1/admin/content/<id>/revisions/1/restore -H 'content-type: application/json' -H 'Idempotency-Key: smoke-restore-0001' -d '{"revision": <current>}'
```

Expected: the list is newest revision first; the detail carries `snapshot` plus a `diff` array of `{ field, before, after }` for the fields that differ from the current record. A successful restore returns the record at `revision + 1` whose editable fields match the old snapshot, and the activity trail gains one `revert` entry with the changed fields. The status/`publishedAt` of the record do not change. `restore` of the current revision → `422 CONTENT_REVISION_CURRENT`, of an identical snapshot → `422 CONTENT_REVISION_UNCHANGED`, with a stale `revision` → `409 CONTENT_REVISION_CONFLICT`, unknown revision → `404 CONTENT_REVISION_NOT_FOUND`.

### Public content listing smoke (P3.d)

```sh
curl -s 'http://localhost:4006/api/public/content?type=post&tag=about&limit=2&locale=en'
curl -s 'http://localhost:4006/api/public/content?type=post&limit=2&sort=newest&cursor=<nextCursor>'
curl -s -o /dev/null -w '%{http_code}
' 'http://localhost:4006/api/public/content?type=bogus'
```

Expected: only `published` records inside their window, no `body` in the projection, `meta.nextCursor`/`hasMore` consistent across pages, `?locale=en` falls back to `vi` content instead of returning an empty list, and an invalid facet or cursor is `422`. The storefront page `/bai-viet` renders the same rows with their tag chips and a load-more button; `?tag=…` narrows the list and shows a clear-filter control.

### Category tree smoke (P3.e)

```sh
curl -s -b cookies.txt http://localhost:4005/api/v1/admin/categories
curl -s -b cookies.txt -X POST http://localhost:4005/api/v1/admin/categories \
  -H 'content-type: application/json' \
  -d '{"key":"trang-suc","parent":null,"order":0,"locales":[{"locale":"vi","name":"Trang sức","slug":"trang-suc"},{"locale":"en","name":"Jewelry","slug":"jewelry"}]}'
curl -s -b cookies.txt -X PATCH http://localhost:4005/api/v1/admin/categories/<id> \
  -H 'content-type: application/json' -d '{"key":"trang-suc","parent":null,"order":3,"revision":1,"locales":[{"locale":"vi","name":"Trang sức","slug":"trang-suc"}]}'
curl -s -b cookies.txt -X DELETE 'http://localhost:4005/api/v1/admin/categories/<id>?revision=2'
```

Expected: the list returns `data` (flat, ordered) and `tree` (nested with `depth`/`children`); the create returns `201` with `revision: 1`; a duplicate key or locale slug is `409`, an unknown parent `422 CATEGORY_PARENT_NOT_FOUND`, a move under a descendant `422 CATEGORY_CYCLE`, a sixth level `422 CATEGORY_DEPTH_EXCEEDED`; a `PATCH` with a stale `revision` is `409 CATEGORY_REVISION_CONFLICT`; deleting a category with children is `422 CATEGORY_HAS_CHILDREN` and one still referenced by a content record is `422 CATEGORY_IN_USE`. In the CMS, `/categories` shows the tree indented, the delete dialog keeps the refusal reason visible, and the content editor's category picker lists the same tree and saves the chosen keys. Remove smoke categories (their `audit_logs` rows included) instead of leaving them in a customer database.

### Media library smoke (P3.e)

```sh
curl -s -b cookies.txt http://localhost:4005/api/v1/admin/media
curl -s -b cookies.txt -X POST http://localhost:4005/api/v1/admin/media \
  -H 'origin: http://localhost:4005' -F 'file=@probe.png;type=image/png' -F 'folder=Landing / Hero'
curl -sD - -o probe-copy.png http://localhost:4005/media/sentuan/2026/<uuid>.png
curl -s -b cookies.txt -X PATCH http://localhost:4005/api/v1/admin/media/<id> \
  -H 'content-type: application/json' -H 'origin: http://localhost:4005' \
  -d '{"title":"Hero","alt":"Ảnh hero","revision":1}'
curl -s -b cookies.txt -X DELETE 'http://localhost:4005/api/v1/admin/media/<id>?revision=2'
```

Expected: the upload returns `201` with the folder normalized (`Landing / Hero` → `landing/hero`), `kind: image` and a `url` on the CMS origin; fetching that URL returns the same bytes with `content-type: image/png`, `x-content-type-options: nosniff`, `cache-control: … immutable` and `cross-origin-resource-policy: cross-origin` (a key belonging to another site is `404`); a non-allowlisted type (e.g. `image/svg+xml`) → `422 MEDIA_TYPE_NOT_ALLOWED` and more than 5 MB → `422 MEDIA_TOO_LARGE`. The list `meta` carries `counts` and `folders`. Attaching a file to a content record and deleting it → `422 MEDIA_IN_USE`; after detaching, the delete removes the row and the object. In the CMS, `/media` shows the thumbnail grid, an upload through the file input appears without a reload, and the content editor's picker lists the same files. Remove smoke files (their `audit_logs` rows and any content revisions created) and the bytes under `TM_MEDIA_DIR` instead of leaving them in a customer database.

### Bulk content actions smoke (P3.f)

```sh
# Two drafts, then both published in one request.
curl -s -b cookies.txt -X POST http://localhost:4005/api/v1/admin/content \
  -H 'content-type: application/json' -H 'origin: http://localhost:4005' \
  -d '{"type":"page","key":"test/bulk-a","locales":[{"locale":"vi","title":"Bulk a","slug":"bulk-a"}]}'
curl -s -b cookies.txt -X POST http://localhost:4005/api/v1/admin/content/bulk \
  -H 'content-type: application/json' -H 'origin: http://localhost:4005' \
  -d '{"action":"publish","items":[{"id":"<id-a>","revision":1},{"id":"<id-b>","revision":1}]}'
# Re-send with stale revisions: each row fails alone and the request is still 200.
curl -s -b cookies.txt -X POST http://localhost:4005/api/v1/admin/content/bulk \
  -H 'content-type: application/json' -H 'origin: http://localhost:4005' \
  -d '{"action":"delete","items":[{"id":"<id-a>","revision":1},{"id":"<id-b>","revision":99}]}'
```

Expected: `200` + `{ action, results[], succeeded, failed }`, where every `results[]` row carries `ok`, `status`, `revision` and an `error` (`CONTENT_REVISION_CONFLICT`, `CONTENT_TRANSITION_INVALID`, `CONTENT_NOT_FOUND`, `CONTENT_BULK_DUPLICATE`). One bad row must never change another row's outcome and the request itself stays `200`; `schedule`, zero items or more than 50 → `422 CONTENT_BULK_INVALID`. Every applied row writes exactly one `audit_logs` entry and one `content_revisions` snapshot, so retrying a batch cannot fork the history. In the CMS `/content` list the select-all bar reports the selection, the dialog states the action before running, and failing rows are listed with their localized reason afterwards. Remove probe records together with their audit and revision rows instead of leaving them in a customer database.

### Content discovery smoke (WEB-02)

```sh
# Search is literal and bounded; a category slug resolves to its stored key.
curl -s 'http://localhost:4006/api/public/content?q=gioi'
curl -s 'http://localhost:4006/api/public/content?q=.*'          # 0 rows, not a wildcard
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:4006/api/public/content?q=$(printf 'a%.0s' {1..81})"  # 422
curl -s http://localhost:4006/api/public/content/categories
curl -s http://localhost:4006/api/public/content/categories/trang-suc
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4006/danh-muc/trang-suc
curl -s http://localhost:4006/sitemap.xml | grep -o '<loc>[^<]*</loc>'
```

Expected: `q` matches the localized title/slug/excerpt case-insensitively and treats `.*`/`[` as literal text; a term longer than 80 → `422`, an empty one is ignored. `categories` lists `{ key, slug, name, parent, locale }` only, `/categories/:slug` resolves the slug to the stored key (`404` for an unknown slug, `vi` fallback for a category without the requested locale), and `/danh-muc/<slug>` renders the landing page (empty state, never `404`, when the category has no published content). `/tag/<tag>` lists published records by tag, and both surfaces appear in `/sitemap.xml`. Remove probe categories/posts afterwards; the storefront reads the CMS collections directly, so a probe row is visible without any publish step.

### Public search page smoke (WEB-04)

```sh
curl -s 'http://localhost:4006/tim-kiem?q=Gi%E1%BB%9Bi' | grep -o '<mark>[^<]*</mark>'   # one highlighted match
curl -s 'http://localhost:4006/tim-kiem?q=khongcoketqua' | grep -o 'No result matches[^<]*'   # empty state
curl -s 'http://localhost:4006/api/public/products?search=hn-bo&limit=8' | head -c 300
curl -s 'http://localhost:4006/tim-kiem?q=hn-bo' | grep -o 'products/bo-hn-bo[0-9]*' | sort -u
```

Expected: `/tim-kiem` without a term shows the hint and issues no search request; a term renders up to 8 content rows with `<mark>` around literal matches and up to 8 product cards, each group linking to its own "view all" URL (`/bai-viet?q=…`, `/products?search=…`). The page is `noindex, follow`, the input caps at 80 characters, an unmatched term shows the empty state, and when the catalog is not connected the page still renders content results plus a note instead of failing. Product search depends on the catalog's `searchString` field; after seeding a probe product, delete it and confirm the search no longer returns it — the dev catalog cache can hold a result for up to 60 seconds.

### Content audit and retry smoke (P2.c)

```sh
# Retried create: the second identical request must replay, not create again.
curl -s -D - -b cookies.txt -X POST http://localhost:4005/api/v1/admin/content \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: smoke-create-0001' -H 'X-Request-Id: smoke-1' \
  -d '{"type":"fragment","key":"test/smoke","locales":[{"locale":"vi","title":"Smoke","slug":"smoke"}]}'
curl -s -D - -b cookies.txt -X POST http://localhost:4005/api/v1/admin/content \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: smoke-create-0001' -H 'X-Request-Id: smoke-1' \
  -d '{"type":"fragment","key":"test/smoke","locales":[{"locale":"vi","title":"Smoke","slug":"smoke"}]}'

# Activity trail for that record (newest first).
curl -s -b cookies.txt 'http://localhost:4005/api/v1/admin/content/<id>/history?limit=10'
```

Expected: the first create returns `201` without `Idempotent-Replay`; the repeat returns the same body with `201` and `Idempotent-Replay: true`, and `content` still holds one record for that key. Reusing the same key with a different body returns `409 IDEMPOTENCY_KEY_REUSED`; a key shorter than 8 characters or with characters outside `A-Za-z0-9_-` returns `422 IDEMPOTENCY_KEY_INVALID`. The history response lists one entry per mutation with the session user as actor, the resulting `revision`, `fromStatus`/`toStatus`, `changedFields` and the echoed `requestId`. Remove smoke records (and their `audit_logs`/`idempotency_keys` rows) rather than leaving test data in a customer database.

### Web public content smoke (v1)

Run against a Web dev server bound to the same customer database. No session is needed: the storefront reads published content directly.

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4006/pages/gioi-thieu   # published record by key
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4006/gioi-thieu          # same record by locale slug
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4006/pages/dich-vu       # draft -> 404
curl -s -D - -o /dev/null 'http://localhost:4006/pages/gioi-thieu?locale=en'       # locale fallback -> 200, Content-Language: vi
curl -s http://localhost:4006/sitemap.xml | grep -c '<loc>'
```

Expected: `200` for published records (by key or slug), `404` for draft/scheduled-future/archived/deleted, `200` with a `vi` fallback for a record that has no English locale, and one `<loc>` per published record in the sitemap. Editing a record in the CMS changes the storefront response after the `max-age=30` window; there is no purge hook yet, so do not treat an immediate stale body as a bug.

### Crawl policy smoke (WEB-08)

| `curl -s http://localhost:4006/robots.txt` | `200 text/plain`; indexable body disallows `/api/` and `/tim-kiem` and advertises `/sitemap.xml` |

With `TM_SITE_INDEXABLE=false` the same route must answer exactly `User-agent: *\nDisallow: /\n`; restart the dev server with that env to check the preview branch, since the value is read from runtime config. `pnpm test:web-content` covers both branches without a server.

## Customer build matrix

Read the registry before each run. At this baseline: CMS supports default, sentuan, bagpost, thanhtung, hoangvi; Web supports default, sentuan, bagpost. Disabled app/customer combinations should fail, not silently build another customer.

Run each customer build in isolated output/workspace directories or serially; concurrent builds of the same host overwrite `.nuxt`/`.output`. Validate branding, titles, manifests/icons, public runtime identity and absence of another customer's assets. Test CMS-only customers and a minimal custom website. A missing MongoDB binding is not a successful catalog connection.

## Required test layers

| Layer | Required evidence |
| --- | --- |
| Static/contracts | Typecheck, lint, alias boundaries, DTO schemas, registry/layer priority |
| Unit | Domain state transitions, money, stock, permissions, projections, cursor parsing |
| Integration | Disposable Mongo replica set where transactions are used; two tenants/sites; idempotency, rollback, Hub stub failure/concurrency |
| Browser | Actual dev/preview UI golden path and errors, both locales, keyboard, narrow/desktop, real HTTP statuses and SSR payload |
| Auth | Token-free UI/storage, CSRF, wrong-app/tenant, role removal, refresh/revoke behavior, owner-only portal operations |
| Cache/PWA | Publish/unpublish propagation, cache dimensions, replay rejection, offline/update recovery, no private caches |
| Migration | Dry-run, referential and financial reconciliation, backup/restore and rollback |
| Providers/deployment | Explicit authorized test environment, actual adapter contract, safe retries, Vercel preview smoke and observability |

Provider outages or missing safe test infrastructure are BLOCKED/NOT RUN, not PASS. Tests must not use real customer identities, real payments, bulk email or production resets.

## Deployment and recovery

Keep per-customer CMS/Web deployments and environment bindings independent. Configure builds to resolve workspace packages from the monorepo. Validate selected customer before Nuxt build, inspect generated public artifacts for sensitive values, and test preview noindex.

Do not silently create/modify Vercel projects, environment values, DNS, CI pipelines or production databases. Deployment is owner-authorized work. For each launch record artifact/source identity, migrations, health checks, cache/PWA version, rollback artifact and database restore procedure. Application rollback alone does not undo a data migration.

Business logs need correlation IDs and safe resource/action metadata; never record credentials, bearer/challenge tokens, entire customer payloads or provider secrets. Add health/readiness and job-failure monitoring with each runtime subsystem rather than declaring observability complete from console output.
