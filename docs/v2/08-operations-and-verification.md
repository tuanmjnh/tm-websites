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
| `TM_WEB_REVALIDATE_URL`, `TM_REVALIDATE_SECRET` | CMS side of the same pair: after a settings or menu save the CMS posts to `<storefront>/api/_internal/purge`. Both must be set — with either missing nothing is sent and the save still succeeds |
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
pnpm test:audit
pnpm test:retention
pnpm test:settings
pnpm test:menus
pnpm test:web-content
pnpm test:web-cart
pnpm test:web-site
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

### Full gate re-run (2026-11-12)

Ran on the working tree at `32fbea6` against local MongoDB (`sen-tuan`): `test:layers`, `test:hub`, `test:content`, `test:categories`, `test:catalog`, `test:media`, `test:audit`, `test:settings`, `test:menus`, `test:bulk`, `test:tags`, `test:redirects`, `test:category-order`, `test:retention`, `test:db`, `test:web-content`, `test:web-site`, `test:web-cart` — all exit 0. Then `typecheck`, `lint`, `validate:registry` exit 0.

`verify:scaffold` was the one red gate, at 142/145: for every web customer it required `property: 'og:image'` inside the customer `nuxt.config.ts` head. That tag was deliberately deleted in `af722fb`, because a relative share image cannot be fetched by social crawlers and every page shared one generic card; the storefront now publishes an absolute `ogImage` per page (`index.vue`, `products/[slug].vue`, `[...slug].vue`, `categories/[slug].vue`, `danh-muc/[slug].vue`). The gate now checks the replacement instead of the removed tag: no relative `og:image` pinned in a customer head config, the customer's `public/branding/og-cover.png` present and non-empty, and the three listing/detail pages still publishing a share image. 157/157 pass.

The lesson to keep: when a gate's assertion is about *how* a requirement was met rather than *that* it is met, update the assertion in the same commit as the change. This one slipped through because the suite is not run on every slice.

### All gates at once (2026-11-12)

`pnpm verify:all` runs every gate the repository has, in order, from one command: 21 domain scripts (`test:layers`, `test:hub`, `test:content`, `test:categories`, `test:catalog`, `test:media`, `test:audit`, `test:settings`, `test:menus`, `test:bulk`, `test:tags`, `test:redirects`, `test:category-order`, `test:retention`, `test:db`, `test:web-content`, `test:web-site`, `test:web-cart`, `test:iam`, `test:revalidate`, `test:web-site-db`) then `typecheck`, `lint`, `validate:registry` and `verify:scaffold` — 25 steps. Three gates still cannot run from a clean checkout (`test:empty-listing`, `validate:build:cms`, `validate:build:web`) and are declared in the runner's `OPT_IN_GATES` with their precondition instead of being left out.

Each step's complete output and exit code are appended to `.devlogs/gates.log` (override with `--log=<path>`), and the file ends with how many gates passed and which failed. The run continues past a failing gate so one invocation reports everything that is broken, then exits 1. The header records the database environment variables in use, which matters because the domain scripts talk to a real MongoDB.

Measured on 2026-11-12 with `TM_MONGO_DB=sentuan`: 25/25 gates in 84–88s (the first run, before the three extra gates above joined, was 22/22 in 79.4s).

`verify:all` is the same command CI runs (see the CI section below), so the workflow cannot drift from the scripts. The runner itself adds no scheduling and no parallelism, and neither the local run nor CI covers the browser checks or the real Hub contract.

### CI (2026-11-12)

`.github/workflows/quality.yml` starts a `mongo:7` service and runs the single `pnpm verify:all` step, then uploads `.devlogs/gates.log` as an artifact on every run. It used to list gates individually, which is how `verify:scaffold` stayed red in CI-adjacent local work while the workflow itself kept passing only the gates somebody remembered to add. The job runs against a disposable database (`TM_MONGO_DB=tm-ci-gates`) so no developer data is needed, and the storefront's `TM_SITE_ID` stays `sentuan`.

The suite was verified locally against an empty database of that name: 22/22 gates in 77.7s with the runner of that day (25 steps now), then the database was dropped. The workflow change itself is validated as YAML only — the first real run on GitHub is what certifies it.

## WEB-10: the offline shell on a production build (2026-11-12)

`pnpm build:web` was broken before this slice: `validate-build.ts` still demanded a static `property: 'og:image'` in the customer head config, which `af722fb` had deliberately removed in favour of an absolute per-page share image. It now checks what the decision actually requires — the customer line must *not* pin `og:image`, must ship `public/branding/og-cover.png`, and the three storefront pages must publish `ogImage` — so the build validator agrees with `verify:scaffold`.

Built with `TM_CUSTOMER_ID=sentuan TM_MONGO_DB=sen-tuan TM_SITE_ID=sentuan` (52.7s), then served on a separate port with the SSR server, not `nuxt dev`:

```
PORT=4016 NODE_ENV=production TM_MONGO_URI=mongodb://127.0.0.1:27017   TM_MONGO_DB=sen-tuan TM_SITE_ID=sentuan TM_SITE_URL=http://localhost:4016   node tm-web/.output/server/index.mjs
```

Served headers: `/sw.js` → `200`, `Content-Type: text/javascript`, `Cache-Control: public, max-age=0, must-revalidate` (a new deployment is picked up on the next visit); `/offline.html` → `200 text/html`.

Browser observations (real Chromium, production server on `:4016`):

| Scenario | Result |
| --- | --- |
| Registration | `navigator.serviceWorker.ready` resolved, scope `http://localhost:4016/`, active state `activated` |
| Control | `navigator.serviceWorker.controller.scriptURL` = `/sw.js` on the first load and after every navigation |
| Cache contents | 2 caches: `workbox-precache-v2-…` with 86 entries (JS/CSS/woff2/png/svg/webmanifest and `/_nuxt/builds/*.json`) and `tm-offline` with exactly `/offline.html` |
| No API cache | `/api/public/site` fetched 200 (252 bytes) while online; `caches.match('/api/public/site')` → false, and no `/api/*` entry in any cache |
| No document cache | `/` and `/products` fetched online; `caches.match('/')` and `caches.match('/products')` → false (the worker only writes documents to the network) |
| Offline navigation | With the server process killed (`curl` → connection refused), `/products` and `/products/sen-tuan-probe-offline` both rendered the offline shell: title `Đang ngoại tuyến`, retry control present, URL preserved, page still controlled |
| Offline API | `fetch('/api/public/site', { cache: 'reload' })` and `/api/public/catalog?limit=1` rejected with `TypeError: Failed to fetch` — the worker answers no API request, offline or online |
| Recovery | After restarting the server, `/` rendered the real home page (`h1` "Chào mừng đến với Sen Tuấn Jewelry & Gemstones") while still controlled, i.e. the shell is only the failure path |

Afterwards the worker was unregistered and both caches deleted in that browser profile, the preview server stopped, and `:4016` left free — a localhost worker outliving a preview build would shadow the next one.

Not covered: the update path (installing a second build over the first and seeing the new one take over), install-to-home-screen UI, and any check that a build cannot ship another customer's assets beyond what the manifest/registry validators already assert.

## Gate coverage is itself a gate (2026-11-12)

`verify:scaffold` §5 reads `scripts/build/run-gates.ts` as source (importing it would start a run) and takes gate names only from the three array literals that define them: `DOMAIN_GATES`, `STATIC_GATES` and `OPT_IN_GATES`. Line comments are stripped first, so a name quoted in a comment inside the array is documentation, not coverage, and every name must be a bare script name — a leaked reason string means the slice reached into the wrong list. The section also fails when `GATES` stops being `[...DOMAIN_GATES, ...STATIC_GATES]`, when a gate is listed twice, or when the runner names a script `package.json` does not define.

Two real bugs in the first version were caught while testing it, not by reading it:

| Case | Result |
| --- | --- |
| `const STATIC_GATES = [...]` is a one-line array, so a terminator search anchored on a newline ran past it and swallowed the whole `OPT_IN_GATES` block, turning `needs` reasons into gate names | fixed by using the first `]` after the opening bracket; the "bare script name" check now fails if that ever regresses |
| A gate commented out inside the array (`// 'test:iam'`) still counted, so §5 passed while the gate was not in `GATES` | fixed by stripping `//` comments before reading tokens |

Negative runs after the fixes: commenting `test:iam` out of `DOMAIN_GATES` gives `189/190` and exit 1; adding a `test:zzz-probe` script to `package.json` alone gives exit 1; both reverted runs are `190/190`, exit 0.

## WEB-10 update path: a second build over the first (2026-11-12)

The offline-shell record above left the update path unexercised. It was tested on the same port with two real builds:

1. Build A: `pnpm build:web` of the committed source, served on `:4016`. A fresh page recorded 86 precache entries, `controller.scriptURL` = `/sw.js`, no probe text, and `sw.js` sha1 `efda9e53ae54` (23,303 bytes).
2. Visible change: `<p data-pwa-probe>PWA-UPDATE-PROBE-B</p>` added to `web-base/app/pages/index.vue`, build B in 1m00s, producing `sw.js` sha1 `7d7c62278c8c` (same size, different content) and a chunk that exists only in B: `_nuxt/6J_pivEL.js`.
3. Build B replaced build A behind the same port. The page was reloaded once — no unregister, no cache clearing, no devtools toggle.

Result after that single reload: the page rendered the B marker, the registration was `activated` with no `waiting` or `installing` worker, the page stayed controlled by `/sw.js`, and the precache matched build B exactly — 86 entries parsed from B's own `/sw.js` manifest (JSON `[{revision,url}]`, URLs stored without a leading slash, hence the pathname normalisation when comparing), with **0 revision mismatches, 0 missing and 0 extra** entries, including the B-only `_nuxt/6J_pivEL.js`. So the worker replaced its precache by itself.

Most chunk hashes are stable across these two builds, so "the old hashed file is gone" is not evidence here; the discriminating facts are the B-only chunk inside the cache and the entry-by-entry manifest comparison.

Offline still worked after the swap: with the server killed, a reload rendered the offline shell, still controlled, and `tm-offline` still held exactly `/offline.html` — the update did not disturb the separately cached fallback.

Cleanup: `index.vue` reverted, a clean build rebuilt so `.output` matches the source again, the worker unregistered, both caches deleted, the server stopped and `:4016` left free.

### Second consecutive update, changing a chunk the first build kept (2026-11-12)

The gap above was the case the first test could not reach: update B added a chunk, so it never had to replace one the previous build was already caching. This run used a fingerprint instead of prose:

* **Fingerprint** = sha256 (first 16 hex chars) of the sorted `path@revision` pairs of the worker's precache cache, compared against the same fingerprint computed from `/sw.js` served by the server. Equal fingerprints mean the cache is exactly that build's manifest; `metadata differ` in any single entry changes it.
* Baseline build: the clean rebuild of the committed source, `sw.js` sha1 `063dfaa3a418`, 86 entries, fingerprint `2930cb93deec1af3`, layout chunk `_nuxt/BVibjFae.js`.
* Visible change in a chunk **both** builds contain: `<p data-pwa-update-probe>PWA-UPDATE-C-LAYOUT</p>` in `web-base/app/layouts/default.vue`, built in 49.2s. That chunk was renamed `BVibjFae.js` → `CRAD2BXR.js`; the new manifest fingerprint was `1a93060bd32f5144` and 16 manifest lines differed (two URLs added, two removed, the build id changed) — an update that must delete a previously precached file.

One reload of the same page, still with no unregister and no cache clearing, produced: cache fingerprint `1a93060bd32f5144` (equal to the new manifest), old `BVibjFae.js` absent, `CRAD2BXR.js` present, page rendering the layout marker, page still controlled, `tm-offline` still exactly `/offline.html`. Killing the server afterwards still rendered the offline shell.

Cleanup: layout reverted, clean rebuild (so `.output` matches the source again), worker unregistered, caches deleted, server stopped, `:4016` free.

One harness artifact is worth recording so nobody debugs a phantom: on a *freshly* reopened tab I first saw an empty precache and a cache literally named `undefined`. The `undefined` cache was mine — `caches.open(names.find(...))` with no match creates one — and the empty precache was the worker's `skipWaiting` + `clients.claim` auto-reload destroying the evaluation context mid-install. Closing the tab, reopening and waiting gave 86 entries whose fingerprint equalled the manifest. Neither was a product bug.

### Update across a browser session, second build behind the same port (2026-11-12)

Last remaining update case: the browser is gone between the two builds, so the only thing carrying state is the registration on disk.

1. Build A: clean rebuild of the committed source, served on `:4016`. Opened a tab: 86 precache entries, worker controlling, cache fingerprint `15ab645c10d02648` equal to A's manifest, no marker.
2. Every tab of that profile was closed and the server stopped — no unregister, no cache clearing at any point in this run.
3. Build B: `<p data-pwa-reopen-probe>PWA-UPDATE-REOPEN-B</p>` in `web-base/app/pages/index.vue`, built in 47.6s, manifest fingerprint `a28d5206e52fb541`, 16 manifest lines changed (`BuHMAric.js` and `DKwBXJmb.js` dropped, `DAo_CYY_.js` and `DU0JkgpL.js` added).
4. B served on the same `:4016`, a new tab opened.

Result: the page reloaded itself once — `performance.getEntriesByType('navigation')[0].type` came back `"reload"`, which is the autoUpdate switch firing on a page an **older** worker already controlled; a first install on an uncontrolled page would have reported `"navigate"`. After that reload the marker rendered, the cache fingerprint was `a28d5206e52fb541` (B's manifest), the A-only chunk `BuHMAric.js` was gone, the B chunk `DAo_CYY_.js` was present, `tm-offline` still held exactly `/offline.html`, and the page stayed controlled.

Offline after the reopened-session update still works: server killed, reload, offline shell.

Cleanup: probe reverted, clean rebuild (`.output` matches the source again), worker unregistered, caches deleted, server stopped, `:4016` free.

What this does and does not cover: "closed the browser" means every tab of the profile was closed and the server stopped; the Chromium process itself may still be running in the background, so this is a session restart rather than a cold OS-level process restart. Install-to-home-screen UI remains untested.

## Storefront build isolation (2026-11-12)

The last WEB-10 criterion without evidence was "no cross-customer assets". `pnpm test:pwa-isolation` checks a finished build directly, so the answer comes from the bytes that would ship rather than from the registry's intent. It is an opt-in gate (`OPT_IN_GATES` in the runner) because it needs `pnpm build:web` and `TM_CUSTOMER_ID` first:

```
TM_CUSTOMER_ID=sentuan pnpm build:web
TM_CUSTOMER_ID=sentuan pnpm test:pwa-isolation
```

Five groups of checks:

1. Build output present: non-empty `public/sw.js`, `public/offline.html`, `public/manifest.webmanifest`.
2. The precache is honest — every manifest URL resolves to a file that build emits; no `/api/*` path; no `.html` document (an SSR page can carry per-visitor state); every entry has a static-asset extension.
3. The offline fallback stays outside the precache: the worker keeps `tm-offline`, references `/offline.html`, and `offline.html` is absent from the precache manifest.
4. The served manifest and branding are this customer's: `manifest.webmanifest` deep-equals the customer layer's file, every icon it names exists in the build, and each `requiredAssets` file is byte-identical (sha256) to the layer's copy.
5. Isolation — for every other enabled web customer, neither its app/tenant identifiers nor the hash of any of its branding binaries appears anywhere in `public/` (59 text files scanned on the sentuan build).

Results on the real sentuan build: 24/24 checks passed. Negative probes, all reverted afterwards:

| Probe | Result |
| --- | --- |
| Copied `bag-post-web/public/branding/favicon.svg` into `public/branding/` under a new name | ❌ `no bagpost branding binary in the build`, 22/23, exit 1 |
| Wrote `app_bag_post_web` into a text file under `public/` | ❌ `no bagpost app/tenant identifier in the build`, 22/23, exit 1 |
| Replaced the build's `branding/logo.svg` with bag-post's file | ❌ `ships its own branding/logo.svg` **and** ❌ the branding-binary check, 20/22, exit 1 |

One probe was wrong before it was right, which is worth keeping: the first identifier probe wrote `app_bagpost_web`, an ID that does not exist in the registry (`app_bag_post_web` does), so the check passed — correctly, since it only knows real registry identifiers. A negative test that passes is usually the test's fault; check the string against the registry before blaming the assertion.

What it cannot see: a deliberate exfiltration of data rather than assets (no request-time behaviour), install-to-home-screen UI, and the CMS worker, which does not exist yet. CI does not run this gate, because CI does not build the storefront; it stays a local post-build step.

## Customer build matrix (2026-11-12)

Until this slice only `sentuan` had ever been built end to end in these records; `thanhtung` and `hoangvi` are CMS-only installations and `default`/`bagpost` had never produced a storefront build. `pnpm test:build-matrix` builds every enabled app in the registry and checks each finished build with the validators it has.

For each target: `validate-build.ts` (app kind), then `nuxt build`, then — for a storefront — `test:pwa-isolation.ts` over that build's own output; a CMS build must contain `public/manifest.webmanifest`. Each customer writes to its own output and log, so one failing layer cannot hide behind a later customer:

```
.devlogs/build-matrix/<customer>/<app>/.output
.devlogs/build-matrix/<customer>/<app>/build.log
```

`--customer=<id>` restricts a run to one customer. The script moves each `tm-web/.output` / `tm-cms/.output` into the matrix (rename, falling back to copy when Windows holds a handle) and restores `tm-web/.output` from the sentuan build at the end, so the rest of the tooling still finds a storefront build.

Full run, 2026-11-12:

| Customer | web | cms |
| --- | --- | --- |
| default | 55.7s, isolation 24/24 | 34.1s, manifest ok |
| sentuan | 49.2s, isolation 24/24 | 33.3s, manifest ok |
| bagpost | 49.0s, isolation 24/24 | 33.9s, manifest ok |
| thanhtung | — (CMS-only) | 34.0s, manifest ok |
| hoangvi | — (CMS-only) | 33.7s, manifest ok |

**8/8 targets, 324s** (validate 4s, builds 317s, isolation 2s over three storefronts, manifest checks 5). The bagpost run also answered the isolation question for real data: its precache contained no sentuan branding binary, which the probe-only test could not show.

Negative probe: writing invalid JSON into `sentuan-web/public/manifest.webmanifest` made `sentuan/web` fail at `validate-build` while `sentuan/cms` still built (summary `validate:build: 1 ok, 1 failed`), and the script exited 1. The manifest was restored immediately and a follow-up run was green.

What it does not cover: deployments or provider configuration (each customer is built locally with local runtime config), a real browser pass per customer, and the CDN/provider cache. CI does not run it — 5.5 minutes of builds belongs in a release check, not on every push.

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
curl -s -b cookies.txt --get --data-urlencode 'tag=dịch vụ' http://localhost:4005/api/v1/admin/content
curl -s -b cookies.txt -X POST http://localhost:4005/api/v1/admin/content \
  -H 'content-type: application/json' -d '{"type":"page","key":"pages/about","locales":[{"locale":"vi","title":"Giới thiệu","slug":"gioi-thieu"}]}'
```

Expected: `GET` returns `{ success, data, meta.counts }`; `POST` returns `201` with `status: draft`, `revision: 1`; repeating the same `key` returns `409 CONTENT_KEY_EXISTS`; a `PATCH` without the current `revision` returns `409 CONTENT_REVISION_CONFLICT`; a mutation with a foreign `Origin` returns `403 CSRF_ORIGIN_MISMATCH`; a request without the session returns `401`. A `tag=` filter returns only the records carrying that exact tag (composed with the other filters, `meta.counts` still whole-site); a blank or over-60-character tag is `422`. The record is visible in MongoDB only inside the database the registry assigns to that customer.

### Catalog smoke (P4.a)

Dry run first; the command never deletes the legacy collections, and a re-run updates the rows it migrated.

```sh
TM_MONGO_URI=mongodb://127.0.0.1:27017 TM_MONGO_DB=sen-tuan pnpm migrate:catalog --site sentuan
TM_MONGO_URI=mongodb://127.0.0.1:27017 TM_MONGO_DB=sen-tuan pnpm migrate:catalog --site sentuan --apply
curl -s -b cookies.txt 'http://localhost:4005/api/v1/admin/catalog/items?status=published&limit=5'
curl -s -b cookies.txt 'http://localhost:4005/api/v1/admin/catalog/categories'
curl -s http://localhost:4006/sitemap.xml | grep -c '/products/'
```

Expected: the dry run prints the legacy category/item counts and writes nothing; `--apply` writes the same number of `catalog_items`/`catalog_categories` rows (241/67 for `sen-tuan`, 229 published) with `legacyId` set; the API returns those rows with `meta.counts`; the sitemap product URL count equals the published count; a second `--apply` does not create duplicates. Publishing a draft through `POST /api/v1/admin/catalog/items/<id>/events` makes its `/products/<slug>` page return 200, and deleting it removes it from the sitemap and the public listing.

### Content import smoke (P10)

Run the same way as the catalog import: dry run first, and the legacy collections are
read-only. `--tenant` selects the legacy tenant to copy (default `default`), and
`--site` is the v2 site the records belong to.

```sh
TM_MONGO_URI=mongodb://127.0.0.1:27017 TM_MONGO_DB=nuxt4-cms pnpm migrate:content --site sentuan
TM_MONGO_URI=mongodb://127.0.0.1:27017 TM_MONGO_DB=nuxt4-cms pnpm migrate:content --site sentuan --apply
curl -s -b cookies.txt 'http://localhost:4005/api/v1/admin/content?limit=5'
curl -s -b cookies.txt 'http://localhost:4005/api/v1/admin/content?attributeKey=legacy.format&attributeValue=gallery'
curl -s 'http://localhost:4006/api/public/content/gioi-thieu'
curl -s http://localhost:4006/sitemap.xml | grep -c '<loc>'
```

Expected: the dry run prints the legacy category/content/locale counts, the legacy
formats, the status buckets, which lists it cannot carry, and writes nothing (no
collections, no indexes, no `tm_migrations` rows). `--apply` writes one `categories`
doc per legacy content category and one `content` doc per legacy record, with keys
like `pages/gioi-thieu` and `posts/<slug>`, `format: html`, both locales, the legacy
SEO title/description/image and keywords, the mapped category keys and tag names.
The admin list reports the same published count, the attribute filter finds the
records whose legacy template was kept, a second `--apply` changes no count and no
revision, and the storefront serves the imported page and lists the imported posts.
Restoring this database into an older CMS is not supported: `content` is the v2
collection, and `contents` stays untouched for rollback.

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

### Tag management smoke (P3.f rest)

```sh
curl -s -b cookies.txt http://localhost:4005/api/v1/admin/tags
# Rename one tag everywhere it appears, then detach it entirely.
curl -s -b cookies.txt -X POST http://localhost:4005/api/v1/admin/tags/rename \
  -H 'content-type: application/json' -H 'origin: http://localhost:4005' \
  -d '{"from":"typo","to":"fixed"}'
curl -s -b cookies.txt -X POST http://localhost:4005/api/v1/admin/tags/rename \
  -H 'content-type: application/json' -H 'origin: http://localhost:4005' \
  -d '{"from":"fixed","to":null}'
```

Expected: the list answers `[{ "name": "...", "count": n }]`, most used first, scoped to the site, and counts include deleted records so a tag that only survives on deleted content can still be cleaned up. A rename returns `{ from, to, updated, skipped }`; every rewritten record has its `revision` bumped, an `update` audit row with `changedFields: ["tags"]` and a revision snapshot, so the content history explains the change. Renaming onto a tag that already exists merges them and leaves one tag; `to: null` removes the tag from every record without deleting the records; an unknown tag is `404 TAG_NOT_FOUND`, a blank name `422 TAG_REQUIRED`, the same name `422 TAG_RENAME_SAME`, a name over 60 characters `422 TAG_TOO_LONG`, and a stale record (saved by someone else between the read and the write) is counted in `skipped` instead of being overwritten — run the command again to include it. In the CMS, `/tags` lists the same counts, the rename dialog warns before a merge, and the detach dialog names the tag and its record count. Probe content, its revisions and its audit rows must be removed afterwards; the service suite uses a disposable database (`pnpm test:tags`).

### Category drag-and-drop smoke (P3.e rest)

```sh
curl -s -b cookies.txt http://localhost:4005/api/v1/admin/categories
# Put probe-order-b under probe-order-a as the first child.
curl -s -b cookies.txt -X POST http://localhost:4005/api/v1/admin/categories/reorder \
  -H 'content-type: application/json' -H 'origin: http://localhost:4005' \
  -d '{"key":"probe-order-b","parent":"probe-order-a","index":0}'
# Move it back to the top level at the first position.
curl -s -b cookies.txt -X POST http://localhost:4005/api/v1/admin/categories/reorder \
  -H 'content-type: application/json' -H 'origin: http://localhost:4005' \
  -d '{"key":"probe-order-b","parent":null,"index":0}'
```

Expected: `200` with `data` (flat, ordered) plus `tree`, the same shape the list endpoint returns, so the editor re-renders from server truth. Sibling `order` values are spaced by ten and a drop takes the midpoint, so a normal move writes one row (siblings keep their `revision`); when neighbours are adjacent the bucket is renumbered once and every written row gets an `update` audit row. A drop back into the current position writes nothing. A move into the category's own subtree or onto itself is `422 CATEGORY_CYCLE`, a missing parent `422 CATEGORY_PARENT_NOT_FOUND`, a stale `revision` `409 CATEGORY_REVISION_CONFLICT`, and another site's key `404 CATEGORY_NOT_FOUND`. In the CMS, `/categories` rows are draggable from the grip: the top third of a row drops before it, the bottom third after it and the middle inside it, a dashed zone moves a row to the top level, and the tree re-renders after the toast. Remove smoke categories and their `audit_logs` rows afterwards; the service suite uses a disposable database (`pnpm test:category-order`).

### Content discovery smoke (WEB-02)

```sh
# Search is literal and bounded; a category slug resolves to its stored key.
curl -s 'http://localhost:4006/api/public/content?q=gioi'
curl -s 'http://localhost:4006/api/public/content?q=.*'          # 0 rows, not a wildcard
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:4006/api/public/content?q=$(printf 'a%.0s' {1..81})"  # 422
curl -s http://localhost:4006/api/public/content/categories
curl -s http://localhost:4006/api/public/content/categories/trang-suc
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4006/danh-muc  # index page
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4006/danh-muc/trang-suc
curl -s http://localhost:4006/sitemap.xml | grep -o '<loc>[^<]*</loc>'
```

Expected: `q` matches the localized title/slug/excerpt case-insensitively and treats `.*`/`[` as literal text; a term longer than 80 → `422`, an empty one is ignored. `categories` lists `{ key, slug, name, parent, locale }` only, `/categories/:slug` resolves the slug to the stored key (`404` for an unknown slug, `vi` fallback for a category without the requested locale), and `/danh-muc/<slug>` renders the landing page (empty state, never `404`, when the category has no published content). `/tag/<tag>` lists published records by tag, `/danh-muc` groups every category under its parent (a child whose parent is missing in this locale is still listed) and only appears in `/sitemap.xml` while it has rows, and `/bai-viet?category=<key>` prints the category name linked to its landing page — an unknown key stays unlinked and prints as stored, never as a dead link. Both surfaces appear in `/sitemap.xml`. Remove probe categories/posts afterwards; the storefront reads the CMS collections directly, so a probe row is visible without any publish step.

### Sitemap smoke (WEB-08)

```bash
curl -s -o /dev/null -w '%{http_code}
' http://localhost:4006/sitemap.xml                    # 200
curl -s http://localhost:4006/sitemap.xml | grep -c '<url>'                                     # every published row
curl -s http://localhost:4006/sitemap.xml | grep -o '/products/[^<]*' | sort -u | wc -l         # published products
curl -s http://localhost:4006/sitemap.xml | grep -o '/categories/[^<]*' | sort -u | wc -l      # live catalog categories
curl -s -o /dev/null -w '%{http_code}
' "http://localhost:4006/products/$(first-slug)"        # 200
```

Expected: one `<url>` per published content record, product, tag and category, each product URL carrying the `<lastmod>` of its `updatedAt`. A draft/scheduled/deleted product appears zero times, a deleted category appears zero times, two records that share a slug appear once, and a site without a catalog binding still returns `200` with the content rows only.

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

### Cart smoke (WEB-05)

| Check | Expected |
| --- | --- |
| `curl -s -X POST :4006/api/public/cart/validate -H 'content-type: application/json' -d '{"lines":[{"itemId":"<published id>","quantity":2,"expectedPrice":<shown price>}]}'` | `200` with `unitPrice`, `lineTotal`, `subtotal` and `itemCount` recomputed by the server, plus `Cache-Control: no-store` |
| Same request with an unpublished/deleted id | `200` with an `item_unavailable` line, `unitPrice 0`, and that line excluded from `subtotal` |
| Variant product with no `variantSku`, or an unknown SKU | `variant_unavailable`, `available: false` |
| Quantity `100`, or 21 lines | `422 CART_INVALID` |
| Browser: add a product, reload `/gio-hang` | Badge and rows survive the reload; totals match the catalog price |
| Browser: change the catalog price, reload `/gio-hang` | The new price is quoted with a one-time price notice; a second reload is quiet |

Cart storage is per origin (`tm-cart:v1:<site>`), so clearing site data empties the cart. Probe records used for a manual check must be deleted afterwards.

### Media bulk smoke (P3.f rest)

| Check | Expected |
| --- | --- |
| With two uploaded files, tick both and pick *Move to folder* | `POST /api/v1/admin/media/bulk` with `action: move`, the normalized folder echoed back, both rows `ok`, list refreshed at the new folder |
| Same dialog with one file attached to content, then *Delete selected* | `200` with `succeeded/failed`, the attached row reports `MEDIA_IN_USE`, the other file disappears from the list |
| Repeat a row id, or send a stale `revision` | `MEDIA_BULK_DUPLICATE` / `MEDIA_REVISION_CONFLICT` on that row only |
| `items: []`, unknown `action`, 51 items, over-long folder | `422 MEDIA_BULK_INVALID` / `422 MEDIA_FOLDER_INVALID` |
| Capability check | A user without `media.delete` cannot delete, one without `media.upload` cannot move |

Bulk runs with the local Hub on `:4000` (or `TM_AUTH_MODE=mock` for local-only UI work). Probe uploads must be deleted, and their bytes removed from the media root, after a manual check.

### Audit log smoke (P2.c rest)

| Check | Expected |
| --- | --- |
| Create then publish a content record, open `/audit` | Two rows, newest first: `Create` (`— → draft`) and `Publish` (`draft → published`) with revision, actor, changed-field chips |
| Pick an action in the filter, then type a key or actor into the search box | The list narrows to the matching rows, `N entries match the filters` follows the filter, and clearing the search restores both rows |
| Force a page smaller than the result set (`limit=1` twice via the API) | `hasMore` on the first page, the cursor returns the next older row, no row appears twice, `total` stays the filter count |
| `resourceType=foo`, `limit=101`, `from=not-a-date`, `cursor=zzz` | `422 AUDIT_QUERY_INVALID`; anonymous request `401` |
| Session without `apps.logs.read` | The page shows the permission message and issues no request |

Probe content, its audit entries and revisions must be deleted afterwards; the sequence above is also covered by `pnpm test:audit` (7 checks), which needs no CMS server.

### Storefront cache purge: scopes and tenants (WEB-09, 2026-11-13)

`POST /api/_internal/purge` (secret in `x-revalidate-secret`, reason in the JSON body) no longer drops the whole Nitro handler cache. It removes the entries whose key carries the deployment's database and the scope the reason names:

| Key part | Example | Meaning |
| --- | --- | --- |
| database | `sen_tuan`, `bag_post` | `TM_MONGO_DB` slugged; two customers can share one Nitro cache |
| scope | `site`, `catalog` | `site` = `/api/public/site` + `/api/public/site-config`; `catalog` = product/category reads |
| rest | `products__api_public_products_limit_1` | namespace + path + query, all slugged |

Separators are `__` on purpose: Nitro stores a handler entry as `nitro:handlers:...` and sanitises the key with `String(key).replace(/\W/g, "")`, so punctuation does not survive and `_` does. Entries written before this change (`catalogbagpostproducts...`, `publicsitevi`) are no longer matched by a scoped purge; they expire on their own TTL (300 s stale window) and `{ "scope": "all" }` removes them immediately.

| Reason | Scopes dropped |
| --- | --- |
| `catalog.item.*` | `catalog` |
| `catalog.category.*` | `site` + `catalog` (a renamed category appears in menus and URLs) |
| `menu.*`, `settings.*`, `redirect.*` | `site` |
| anything else / missing | `site` + `catalog` (never under-invalidate silently) |

The redirect map outside Nitro's cache is now cleared per database and only with a `site`/`all` purge, instead of process-wide on every call.

Live check (two dev servers, `:4018` sentuan and `:4019` bag-post sharing one cache store, both stopped afterwards):

| Step | Result |
| --- | --- |
| Warm products, product detail, site, site-config on sentuan; products on bag-post | 5 handler entries |
| `{"reason":"catalog.item.update"}` | removed 2 (both sentuan catalog keys), 2 remaining (sentuan site key + bag-post key) |
| `{"reason":"settings.update"}` | removed 2 (both sentuan site keys), 0 remaining for sentuan |
| `{"reason":"settings.update"}` again | 0 removed |
| Warm again, then `{"reason":"catalog.category.update"}` | removed 2 (one per scope), 1 remaining — the bag-post key |
| `{"scope":"all"}` | removed 1 — that same bag-post key, proving it had survived the scoped purges |
| No secret / wrong secret | `401` |
| `{"scope":"everything"}` | `422 INVALID_CACHE_SCOPE` |
| `{"reason":"import.finished"}` | `["site","catalog"]` |

CMS → storefront, end to end (CMS `:4005` with `TM_AUTH_MODE=mock`, `TM_WEB_REVALIDATE_URL=http://localhost:4018`, `TM_REVALIDATE_SECRET` matching the storefront's `REVALIDATE_SECRET`; storefront `:4018`, `sen-tuan`; both stopped afterwards):

1. Warm the storefront: `GET /api/public/products?limit=1`, `/api/public/products/bo-hn-bo`, `/api/public/site`, `/api/public/site-config` → four handler entries.
2. `POST /api/v1/admin/catalog/items` (mock session cookie, `Origin: http://localhost:4005`, body `{"key":"probe-purge-flow","title":{"vi":"Probe purge flow","en":"Probe purge flow"},"slug":{...},"basePrice":1000}`) → `201`, response header `x-storefront-revalidate: revalidated`.
3. Purge the storefront with the same reason the save used (`catalog.item.create`) → `removedCount: 0`: the CMS had already dropped those keys, so the header was not wishful thinking.
4. Purge with `settings.update` → `removedCount: 2` (`public__sen_tuan__site__public_site_vi`, `public__sen_tuan__site__site_config`): the catalog save left the site projection alone.
5. Cleanup: the catalog delete is a soft delete (`POST /api/v1/admin/catalog/items/<id>/events` with `{"event":"delete","revision":1}`, which also returns `revalidated`), so the probe was removed outright with MongoDB: `catalog_items` 1 → 0, `audit_logs` 2 → 0 for `resourceKey: probe-purge-flow`, and no idempotency or revision rows existed. A re-check of the same counts returned `{"items":0,"audits":0,"idem":0,"revisions":0}`.

The other direction — a settings save must clear only the site projection (same two servers, same mock session):

1. `GET /api/v1/admin/settings` → `revision: 0`, `company.name: ''`: this tenant had no settings document yet, so the save is a first write (an upsert), and cleanup can restore the exact empty state.
2. Warm the storefront: `products?limit=1`, `/api/public/site`, `/api/public/site-config`.
3. `PATCH /api/v1/admin/settings` with `{"revision":0,"company":{"name":"Sen Tuấn (verify)"}}` → `200`, `x-storefront-revalidate: revalidated`, saved `revision: 1`.
4. Purge with `settings.update` → `removedCount: 0` (the CMS had already dropped the two site keys).
5. Purge with `catalog.item.update` → `removedCount: 1` (`public__sen_tuan__catalog__products__api_public_products_limit_1`): the catalog key was still there, so the settings save cleared its own scope and left the catalog alone. This is the check that a "both scopes purged" bug cannot fake — the purge endpoint itself reports whether the key still existed.
6. `GET /api/public/site` then served the new name, i.e. the purged key really was re-rendered from the save.
7. Cleanup: `settings` 1 → 0, `audit_logs` (`settings` / `site-settings`) 1 → 0, `idempotency_keys` 0 → 0 for that action; the admin endpoint returned `revision: 0` / `''` again, and one last `settings.update` purge removed the two keys re-cached by the read in step 6, after which the storefront served `''` again.

Gate: `pnpm test:purge-scope` — 8 checks, no Mongo and no server (map-backed storage), part of `verify:all` (STATIC_GATES).

Not done: the purge request is still authenticated by a shared secret only, not a signed or replay-limited event (WEB-09's event half), and a CDN in front of the storefront would still need its own purge call (Q12).

### Audit write path: category and media (P2.c rest, 2026-11-13)

The category and media services already recorded `audit_logs` rows, but nothing proved it and the entries carried no human intent. Both are now covered.

| Check (disposable database, `pnpm test:audit-write`) | Expected |
| --- | --- |
| Create a category | One `category`/`create` row: resource id and key, revision 1, `changedFields` includes `key`, the session actor, the request id and the reason |
| Update its locales | One `category`/`update` row at revision 2 with `changedFields: ['locales']` — only the fields that differ |
| Delete a category with a child | `CATEGORY_HAS_CHILDREN` and **no** audit row: a refused command leaves no trace |
| Delete a leaf category | `category`/`delete` row at `record.revision + 1`, same convention as content |
| Upload, edit and delete a media file | `media`/`create`, `media`/`update` (`['title']`) and `media`/`delete` rows, each with the actor and reason |
| A mutation with no note | `reason: null` and `requestId: null`; the actor is still recorded, and the previous reason is never reused |
| List the audit log | `resourceType=category` returns 5 rows newest first, `resourceType=media` returns 3, a key search returns the three media rows, and another site returns `[]` |
| `normalizeAuditReason` | Trims, collapses whitespace, turns control characters into spaces (a note cannot forge extra lines in the log view), caps at 500 characters, and maps blank or non-string input to `null` |

How the note arrives: `x-audit-reason` on the mutation request, read by `writeMetaOf`, so every module that already builds write meta (content, category, media, settings, menu, catalog) gets it without each body schema learning a new field. `AUDIT_REASON_MAX` (500) lives in `models/audit.ts`, next to `changedFields` and `actor`.

The Audit Log page renders the note above the actor line, quoted. **No CMS screen asks for a reason yet**: the header is supported end to end and shown when present, but every current save sends none, so the field is `null` in practice until an editor UI collects it. Recorded here so it is not mistaken for a working input.

Gate: `pnpm test:audit-write` — 11 checks, part of `verify:all` (DOMAIN_GATES). The read side stays in `pnpm test:audit` (9 checks).

### Retention: revisions and audit (P2.c)

`pnpm prune:retention` trims the two collections that grow without a bound. It is an operator command, not a scheduled job, and it only touches one site's own database.

```bash
TM_MONGO_URI=mongodb://127.0.0.1:27017 TM_MONGO_DB=sen-tuan \
  pnpm prune:retention --site sentuan [--keep-revisions 50] [--audit-days 365] [--apply]
```

| Check | Expected |
| --- | --- |
| No `--apply` | Reports removable rows per collection and deletes nothing |
| `--apply` with a content record over the cap | Only snapshots older than `max(revision) - keepRevisions` go; the newest `keepRevisions` stay |
| `--apply` with `--audit-days` | `audit_logs` older than the cutoff go; newer entries and other sites are untouched |
| Second run in a row | Reports `0` and deletes nothing |
| `--keep-revisions 0`, `--audit-days 0`, non-integer values | Exit `1` with `RETENTION_OPTIONS_INVALID`; nothing is deleted |
| Missing `TM_MONGO_DB` or `--site` | Exit `1` with a message naming the missing input |

Policy (Q16, closed 2026-11-09): the newest **50 revision snapshots per content record** and **365 days of `audit_logs`** are kept; `--keep-revisions` may range 1–500 and `--audit-days` 1–3650, and those bounds are guard rails rather than defaults. Any other value needs the owner, not an operator preference. The command stays dry-run unless `--apply` is passed.

Schedule — manual by decision, because Q12/Q21 ruled out a cron, queue or worker:

- **Monthly, per live site.** Dry run first, read the counts, then `--apply`. A monthly run should report a small steady number; a jump means either a bulk edit or a missed month, so check which before applying.
- **After a bulk import, restore or migration, before the backup** is taken, so the snapshot is not dominated by superseded revisions.
- **Before a site is archived or its database exported.**

Record the `dryRun` report and the deleted counts in the site's operations log. Nothing in the app enforces the schedule, so a missed month is only visible as a larger next report.

Coverage: `pnpm test:retention` (5 checks, disposable database) — the cap, the audit cutoff, site isolation, dry run and the idempotent re-run.

### Site menus smoke (P2.d)

| Step | Expected |
| --- | --- |
| Open `/menus` as a session with `configs.read` | The menu list (key + item count) or the empty state; *New menu* only appears with `configs.write` |
| Create a menu with key `Menu chinh` | The key is stored as `menu-chinh`; the new menu opens with 0 items and `Revision 1`; a second menu with the same key -> `409` shown in the dialog |
| Add an item with a vi/en label, pick a link type, type a target | The item appears in the list with its type badge; a URL target without a leading `/` is refused with the reason, and the dialog stays open |
| Reorder with the arrows and press *Save Changes* | `Revision` increments on the page and in `GET /api/v1/admin/menus/:id`; the stored order matches the list; reloading shows no unsaved marker |
| Save from a form another admin already changed | The conflict message is shown and the page reloads the current revision |
| *Delete menu*, confirm | The menu disappears from the list; the audit page shows the `delete` row with the session actor; linked pages are untouched |
| Database check | Menus live in `site_menus`; a migrated database's legacy `menus` documents are **not** touched or indexed |

### Record history smoke (P2.d)

| Check | Expected |
| --- | --- |
| `GET /api/v1/admin/categories/:id/history` after an edit | `200` with the `update` row (actor, revision, `changedFields`), newest first |
| Same route with another site's id, an unknown id or a malformed id | `404 CATEGORY_NOT_FOUND` / `404` / `422 CATEGORY_ID_INVALID` — never an empty `200` |
| `GET /api/v1/admin/media/:id/history` after a metadata edit | `200` with the `update` row and its `changedFields`; a record with no activity returns `200` with `[]` |
| Same route with an unknown or malformed id | `404 MEDIA_NOT_FOUND` / `422 MEDIA_ID_INVALID` |
| Either route without a session | `401` |
| Open a category or media record's edit dialog | An *Activity* block lists that record's rows (`action`, `Revision`, actor, changed fields, time); *Reload* refetches it and the list is empty only when the record truly has no activity |
| A read that fails (session without the read capability) | The block shows the failure text rather than an empty list |
| Save a menu item whose `content`/`category` target does not exist (or is soft-deleted, or belongs to another site) | `422 MENU_TARGET_NOT_FOUND` with `details.missing`; the editor shows the *target does not exist* message and keeps the draft, and the revision does not move |
| Save the same menu with a page/category that does exist, plus a `/path` item | `200`, revision +1, one `audit_logs` row with `changedFields: ["items"]` |
| Edit a menu with children | Rows render nested as `1`, `1.1`; each row has *Add a child item*, arrows and a drag handle, and a drag or an arrow saves the same order. A grandchild or an 11th child is refused with a message naming the row |
| Type an SEO title template in Settings | The line under the field previews `sample page | suffix` as you type, clearing it back to `%s` drops the suffix from the preview, and each locale field below previews its own override (or the shared template when empty) |
| Set a per-locale template (`SEO title (EN)`) and open the storefront with the `i18n_redirected=en` cookie | The page title uses the English template while the default-locale page keeps the shared one; clearing the field returns that locale to the shared template |
| Change the SEO title template in Settings, then open any storefront page | The browser tab shows `page · suffix` from the template; the home page shows the brand without a repeated suffix, and setting the template back to `%s` removes it on the next request, because the save purges the public-site cache |
| Promote a menu child | The child row's *Move to top level* button lifts it to the row right under its parent with its label and target intact; saving keeps the total item count |
| Demote a top-level row | The indent button on any row but the first turns it into the last child of the row above (`1.1`), the first row's button is disabled, and saving keeps the total item count |
| Reorder by touch | Dragging the grip with `pointerType: 'touch'` (or pen) swaps the rows without a keyboard, a tap on the grip changes nothing, and dropping outside the row's own list keeps the order |
| Open the storefront header with a menu that has children | The parent shows a chevron and its children open on hover and on keyboard focus; footer children are listed under their parent |
| Open the detail of a page (or the edit dialog of a category) a menu links to | A *Menus linking to …* block lists the menu names and keys with the hint that the record cannot be deleted yet, and each name opens that menu at `/menus?menu=<id>`; a record with no references shows no block, and a failed read hides it instead of blocking the dialog |
| Delete a category or page a menu links to | `409 CATEGORY_IN_MENU` / `409 CONTENT_IN_MENU` with `details.menus`; the CMS names the menu in the delete dialog, keeps the record and its revision, and a bulk delete reports the refused row without touching the rest |
| Add an item and set *Link type* to Content or Category | *Target* becomes a select of this site's live pages/categories (label · key); switching type clears the target, and an item whose record was deleted still shows the key marked *(no longer exists)* |

Coverage: the `pnpm test:audit` checks listed in [05](05-feature-parity.md). Probe records and their audit rows must be removed afterwards.

### Public site projection smoke (P2.d)

| Check | Expected |
| --- | --- |
| `GET /api/public/site?locale=vi` on a site with saved settings and menus | `200` with company identity, SEO defaults, locales and both menus, `cache-control: s-maxage=60, stale-while-revalidate=300` |
| Same request with `?locale=en` | Menu labels in English; a category without an `en` slug still resolves (storefront default locale, then the key) |
| Same request on a site with no settings or menus | `200` with empty company fields, `%s` title template and no menus — never a `500` |
| Any response body | No `revision`, `updatedBy`, `modules` or stored link target appears in it |
| Storefront header/footer with saved menus | Brand is the settings display name, the header follows the `main` menu and the footer *Explore* list the `footer` menu |
| Storefront with menus missing or an API failure | The static navigation and Hub company name are shown instead; the page still renders |

### Storefront cache purge smoke (P2.d)

| Check | Expected |
| --- | --- |
| Save settings, or create/update/delete a menu, with `TM_WEB_REVALIDATE_URL` and `TM_REVALIDATE_SECRET` set | `200` and `x-storefront-revalidate: revalidated`; `GET /api/public/site` shows the new value on the next request instead of after the 60s window |
| The same save with either variable missing | `200` with `x-storefront-revalidate: not-configured`; no request leaves the CMS |
| The same save while the storefront is stopped or holds another secret | Still `200` with `http-error` / `request-failed`, the data is saved, and the CMS log shows one `[storefront-revalidate]` warning |
| The same save in the browser (`/configs`) | When the purge failed the page says the settings were saved but the site cache could not be cleared and will refresh in about a minute; when the purge worked it shows the plain saved message |
| `POST <storefront>/api/_internal/purge` with no secret or a wrong one | `401 INVALID_REVALIDATE_SECRET`; with `REVALIDATE_SECRET` unset the route answers `503 REVALIDATE_DISABLED` |
| Retry the same `Idempotency-Key` | `200` with `idempotent-replay: true` and no second purge |

Coverage: `pnpm test:revalidate` (8 checks). Start the storefront with `REVALIDATE_SECRET=<secret>` and the CMS with `TM_WEB_REVALIDATE_URL=http://localhost:4006 TM_REVALIDATE_SECRET=<same secret>`.

Coverage: `pnpm test:web-site` (10 pure checks) and `pnpm test:web-site-db` (6 live checks, disposable database). Probe settings/menus must be removed afterwards.

### Site settings smoke (P2.d)

| Check | Expected |
| --- | --- |
| Open `/configs` on a site that was never saved | *Site settings* shows empty company fields, default locale `VI`, only `VI` enabled, only *Content* on, and `Settings revision 0` |
| Change the display name, enable `EN`, switch *Catalog* on, save | `200`, "Site settings saved.", `Settings revision 1`, and `GET /api/v1/admin/settings` returns the saved document with `updatedBy` = the session user |
| Save again without editing | "There is nothing to save." (`422 SETTINGS_UPDATE_UNCHANGED`) |
| Bump the revision through the API, then save the stale form | "Someone else saved these settings…" (`409 SETTINGS_REVISION_CONFLICT`), nothing overwritten |
| Try to uncheck the current default locale | The checkbox is disabled; changing the default in the select keeps both enabled |
| Press *Choose image* next to Logo | A dialog lists the library's images with search; picking one fills the field and closes the dialog, then saving stores `company.logoMediaId` (the clear button empties it) |
| A session without `configs.write` | Fields and Save are disabled, the read-only note is shown, `PATCH` → `403`; a session without `configs.read` → `403` on `GET` and the page shows the permission message |
| Hub unreachable / Hub session rejected | The Hub card shows its own error while the settings card still loads and saves |

Probe documents, audit entries and idempotency keys must be removed afterwards. The service-level sequence is `pnpm test:settings` (8 checks).

## Storefront accessibility baseline (WEB-12.a, 2026-11-13)

Driven against the real dev server (`pnpm dev:web`, `TM_MONGO_DB=sen-tuan`, `TM_SITE_ID=sentuan`, `:4006`) in the packaged Chromium, on the seeded sentuan data. Each page was read from the live DOM rather than from source: landmarks, heading sequence, `html[lang]`, `img[alt]`, accessible names of every link/button, and every input's label.

| Page | Before | After |
| --- | --- | --- |
| `/` | no `lang`, no skip link, one link whose only child was a decorative placeholder div (no accessible name) | `lang` follows the locale, skip link is the first tab stop, the duplicate image link is out of the AT tree |
| `/products` | no input label (placeholder only), `h1 → h3` heading skip, pagination `nav` unlabeled | input labeled, cards are `h2`, pagination labeled |
| `/products/bo-hn-bo` | no `lang` | clean |
| `/categories/<slug>` | `lang` missing, breadcrumb label hardcoded English | clean, breadcrumb follows the locale |
| `/bai-viet` | `lang` missing | clean |
| `/gio-hang` | `lang` missing | clean, quantity/remove controls named |
| 404 | `lang` empty, no layout | `lang` set (the error page replaces the layout, so it sets `htmlAttrs` itself); still no site header/footer by design |

What was fixed in `tm-shared/nuxt-layers/web-base`:

- `layouts/default.vue`: `useHead(() => ({ htmlAttrs: { lang: locale.value } }))` (the storefront keeps unprefixed URLs, so this attribute is the only locale signal), a skip link to `#main`, `id="main" tabindex="-1"` on the main landmark, and labels on both header navs.
- `error.vue`: its own `htmlAttrs.lang`, because the error page replaces the layout that normally sets it.
- `components/WebContentList.vue`: the card image link duplicates the title link, so it is now `aria-hidden="true" tabindex="-1"` instead of an unnamed second link.
- `components/CatalogProductCard.vue`: card title `h3 → h2` (it sat directly under the page `h1`).
- `pages/products/index.vue`: `aria-label` on the filter input; `:aria-label` on `UPagination` in this page and `categories/[slug].vue`.
- Six breadcrumb `nav`s: `aria-label="Breadcrumb"` → `t('a11y.breadcrumb')` (the one in `pages/danh-muc/[slug].vue` is in the owner's pending category work and therefore ships with that change, not this one); new `a11y` block (`skipToContent`, `mainNav`, `mobileNav`, `breadcrumb`, `pagination`) in both `tm-web/i18n/locales/*.json`.

Verified after the fixes: `lang` is `vi` on load and `en` after the in-header locale switch (all labels, the skip link and the pagination label follow it — no hardcoded English left on a Vietnamese page); heading sequence has no skips on every page above; no unnamed control and no unlabeled input anywhere in the audited set; every image has an `alt`; the skip link is the first focusable element and becomes visible at 16×16 px on focus; the brand link shows the UA focus outline.

Not verified in this slice: real `Tab` key traversal could not be driven — the packaged Chromium only moves focus on a real key event when its window has OS focus, and `Tab` left `document.activeElement` on `<body>`; tab order was therefore read from the DOM (skip link first, then brand, then nav) and the skip link's focus styles were checked by focusing it programmatically. Colour contrast and screen-reader output are not measured yet. The 410 branch was exercised later, with a real redirect row — see the next section.

## Storefront states and responsive widths (WEB-12.b, 2026-11-13)

Same server and data as the accessibility baseline. Each state was reached with a real request, not by mocking a component; nothing was written to the database.

| State | How it was reached | Result |
| --- | --- | --- |
| Empty listing | `/tim-kiem?q=zzzznotfound` | "No result matches “zzzznotfound”." with the heading intact |
| Catalog unavailable | a second dev server on `:4017` with `TM_MONGO_URI=mongodb://127.0.0.1:27999` (nothing listening), `NUXT_IGNORE_LOCK=1`; the cached `/products` payload still answered, a cache-busting `?sort=price-asc&page=2` returned `503 error.catalogUnavailable` | The page renders its heading and the "Catalog temporarily unavailable / Product data could not be read right now" notice instead of an empty grid or a crash |
| 404 | `/khong-ton-tai-abc` | `noindex, follow`, `lang`, `h1`, a single "back home" action; no header/footer by design |
| 410 | `/probe-gone`, after the CMS stored a real `410` redirect row | the site's own error page with `Trang này đã được gỡ`, `noindex, follow`, `lang`, a single "back home" action (see the 410 section below for the full run) |

Responsive widths were checked at 390×844 and 1280×800 by measuring `documentElement.scrollWidth` against `clientWidth` and the computed grid/nav of the live page:

| Page | 390 px | 1280 px |
| --- | --- | --- |
| `/` | no horizontal overflow | — |
| `/products` | one card per row, filter full width, compact nav only | cards multi-column, desktop nav, compact nav hidden |
| `/products/bo-hn-bo` | no overflow, quantity input keeps its label | — |
| `/categories/<slug>` | one card per row, no overflow | four columns, no overflow |
| `/gio-hang` | no overflow, compact nav only | — |

The one defect this found and fixed: `UPagination` rendered a 392 px row inside a 373 px viewport on `/products`, so the whole page had a 10 px horizontal scroll (the pagination `nav` is a flex item with `min-width: auto`, so adding `flex-wrap` to the root could not shrink it, and the shrinking attempt then pushed a button past the edge). It is now `class="w-full"` with `:ui="{ list: 'flex-wrap justify-center' }"` in both `products/index.vue` and `categories/[slug].vue`: at 390 px the list wraps to two rows (`nav` height 68 px) and `scrollWidth` equals `clientWidth`.

Not verified: the client-side loading/pending affordance (it relies on the API answering slowly, which a local server cannot produce deterministically).

## The 410 branch with a real redirect row (WEB-12.c, 2026-11-13)

The branch had no mapping in local data, and inventing one is off the table, so the row was created through the CMS the way an operator would create it, then removed with the same tooling. CMS `:4005` (mock session, `TM_WEB_REVALIDATE_URL`/`TM_REVALIDATE_SECRET` pointing at the storefront) and storefront `:4018` (`sen-tuan`), both stopped afterwards.

1. Baseline: `GET /probe-gone` → `404`; the `content_redirects` collection was empty.
2. `POST /api/v1/admin/redirects` with `{"from":"/probe-gone","to":"","statusCode":410,"note":"verify slice"}` and `x-audit-reason` → `201`, `x-storefront-revalidate: revalidated`, stored `revision: 1`.
3. Purge with the save's reason (`redirect.create` → `site` scope) → `removedCount: 0`: the CMS had already dropped the two site keys.
4. `GET /probe-gone` with `Accept: text/html` → **`410`** and the site's error page: `#__nuxt` shell, `h1` "Trang này đã được gỡ", the description from `error.contentGone`, `noindex, follow`, `Cache-Control: no-store`.
5. `{"from":"/probe-move","to":"/","statusCode":301}` → `201`; `GET /probe-move` → `301` with `Location: /`. So the gone row and the moving row do not interfere.
6. Cleanup through the CMS: `DELETE /api/v1/admin/redirects/<id>` answers `422` without `?revision=` and `200` with it; `content_redirects` 2 → 0, `content_revisions` 0, then the four `audit_logs` rows (two create, two delete) were removed and the collection's redirect entries went 4 → 0.
7. The redirect lookup caches a path for 30 s (`publicRedirects.ts`), so `/probe-gone` kept answering `410` briefly; once that entry expired it answered `404` again, and `/probe-move` `404` too — the deleted rows really are gone, not merely hidden.

One behaviour worth knowing when checking this with `curl`: without an HTML `Accept` header (curl's default `*/*`) Nitro answers a dev-mode JSON error envelope instead of the page. That is not specific to `410` — `GET /khong-ton-tai` behaves the same way and renders `Không tìm thấy trang` only when asked with `Accept: text/html` — so a check of these states must send a browser-like `Accept`.

Still not verified in this branch: the client-side `clearError({ redirect: '/' })` action (read from the DOM as a button, not clicked), and 410 for a path that also has content behind it.

## Previewing a matrix build, and one browser pass (2026-11-13)

`pnpm test:build-matrix` built all eight targets in 319s — web and CMS for `default` and `sentuan`, web for `bagpost`, CMS for `bagpost`/`thanhtung`/`hoangvi` — with the storefront isolation suite at its usual 24/24 per build. That run is also the regression check for the `vue` alias added in WEB-15: every CMS customer build executes `tm-cms/nuxt.config.ts`, so a broken alias would fail the matrix, not just `sentuan`.

The preview that follows a matrix build needs the environment a second time, and this is not obvious: the matrix builds with `NODE_ENV=production` and `TM_CUSTOMER_ID` only, so `runtimeConfig` is baked with an empty `mongoUri`. Starting the output directly answers `503 error.catalogNotConnected` on `/api/public/products` and `error.contentUnavailable` on `/api/public/content` while `/api/public/site-config` falls back silently — which reads like a broken build, not missing configuration. Start it with Nitro's runtime overrides instead:

```bash
PORT=4018 NUXT_MONGO_URI=mongodb://127.0.0.1:27017 NUXT_CATALOG_DB_NAME=sen-tuan \
  NUXT_PUBLIC_SITE_ID=sentuan node .devlogs/build-matrix/sentuan/web/.output/server/index.mjs
```

With those, `/`, `/products`, a product detail, `/bai-viet` and `/danh-muc` answer `200`, the home page lists eight real products, and the title/theme colour are `sentuan`'s with no other customer's name anywhere in the document.

The pass also turned up dead links the gates cannot see: `/about` and `/contact` returned `404` while the header and footer link to both. They now exist as settings-driven pages (see `05`, WEB-16). Two limits worth stating: this was one customer's storefront, and the CMS browser pass is still blocked on a Hub session.

## The Vue alias that unblocked the `link:` adoption (WEB-15, 2026-11-13)

WEB-13 stopped at "two Vue instances": with `link:`, Vite resolved `vue` from `tm-platform`'s tree (3.5.45) instead of the app's (3.5.44), the package's precompiled `resolveComponent('UBadge')` then ran without a `currentInstance`, and the pills rendered as empty `<ubadge>` elements while every gate stayed green. `vite.resolve.dedupe: ['vue']` did not help — there is no `vue` reachable from this app's `node_modules`, so dedupe had nothing to point at — and adding `vue` to `tm-cms/package.json` to give it one broke `vue-tsc` with 122 errors, including `Cannot find module 'vue'` in a layer file with no dependency of its own.

What works is an exact-match alias to the build the app already loads, located in the pnpm store:

```ts
// tm-cms/nuxt.config.ts
function appVueEntry(): string {
  const store = resolve(repoRoot, 'node_modules/.pnpm')
  const entry = readdirSync(store).find(name => name.startsWith('vue@'))
  return entry
    ? resolve(store, entry, 'node_modules/vue/dist/vue.runtime.esm-bundler.js')
    : 'vue'
}

vite: {
  server: { fs: { allow: [/* the linked package */] } },
  resolve: { alias: [{ find: /^vue$/, replacement: appVueEntry() }] },
}
```

The exact-match regex matters: an object-shaped alias would also rewrite `vue-router`, `vue-i18n` and `@vue/*`. With it, the package's module imports the app's own Vue file, `resolveComponent` finds the registered primitives, and the pills draw (`span[data-slot="base"]`, `unbadge` count 0). Two caveats are recorded in `05`: the store path is a layout detail rather than a contract, and pinning `vue` this way means a Vue bump in the other repo no longer reaches this app — the registry install (peer `vue`) remains the end state.

## Shared packages: the registry route (WEB-14, 2026-11-13)

`tm-utils`, `tm-validators` and `tm-types` are published at 0.1.0 and install from the registry with no Vite or Tailwind config, unlike the `link:` dependency that WEB-13 had to revert. Two mechanics are worth keeping from this attempt even though the type itself was reverted on review: `minimumReleaseAge` rejects a release this fresh until the exact version is listed in `minimumReleaseAgeExclude` (and then the lockfile must be pruned again before that line is removed, or every later install fails the supply-chain check), and a shared envelope is only worth importing where its shape matches the endpoint — `ApiResponse<T>` has an optional `data`, so an endpoint that always answers with a payload needs a local type that says so.

## `tm-hub` has the `StatusBadge` bug too (2026-11-13)

The same precompiled `resolveComponent('UBadge')` lookup fails in `tm-hub`, so its non-clickable pills (`app/pages/administration/{apps,configs,content,roles}.vue`) render as empty `<ubadge>` custom elements; the `clickable` ones draw a plain `<button>` and look correct, which is why a "pills render" check can pass while half the badges are invisible. Read from the running dev server (`:4000`): the package's module resolves `tm-hub/node_modules/.pnpm/vue@3.5.44…` — one Vue instance, unlike `tm-websites` — but the app's component registry holds only `RouterLink`, `RouterView`, `Icon`, `LazyIcon` and the i18n components, with no `UBadge`/`UIcon`.

So `tm-hub` needs only the registry half of the fix: a client plugin registering `UBadge` and `UIcon` from `#components`, with no `dedupe` and no `vue` dependency. `tm-websites` proved that mechanism on 2026-11-13 — with a single Vue instance and the two components registered, the pills drew `span[data-slot="base"]` with `bg-success/10` and real contrast ratios.

That plugin now exists in `tm-hub` (`app/plugins/tm-ui-globals.client.ts`, uncommitted — that repo is mid-migration and its working tree is the owner's). It registers all six primitives the dist resolves (`UBadge`, `UButton`, `UIcon`, `UPopover`, `USelectMenu`, `UTooltip`), which is what the badge wrapper hid: `ListFooter` needs `UIcon`, but `ModelSelect` — also imported by that repo — additionally needs a button, a popover, a select menu and a tooltip. `pnpm typecheck` there reports 0 errors, and the running dev server's registry on `/login` lists all six, so both preconditions hold. The admin pages themselves still need a signed-in session to look at: `/administration/configs` redirects to `/login` without one, and no test account is documented in that repo.

## Shared packages from `tm-platform` (WEB-13, 2026-11-13)

A `link:` dependency on `@tuanmjnh/tm-ui` renders nothing in the CMS and still passes every gate. Reproduce it before adopting anything from that repo: mount `StatusBadge` from the package and read `document.querySelectorAll('ubadge').length` in the live page — a non-zero count means the component resolved to a bare tag name, not to a component.

Why: the package's `dist` is precompiled by `scripts/build-sfc.mjs`, so its render functions call `resolveComponent('UBadge' | 'UIcon')` at runtime, and `link:` makes Vite resolve the package's own `vue` (3.5.45) instead of this repo's (3.5.44). With two Vue module instances the app registry is populated correctly but the package's `resolveComponent` has no `currentInstance`, so it returns the string. Nothing logs an error; `nuxt build` and `vue-tsc` stay green.

The wiring used for the probe, for whoever repeats it once the package is published: `"@tuanmjnh/tm-ui": "link:../../../../tm-platform/packages/tm-ui"` in the layer that imports it (`cms-base`, not `core-base` — TypeScript resolves from the importing file's directory), `vite.server.fs.allow` for that directory in `tm-cms/nuxt.config.ts`, `@source "<layer>/node_modules/@tuanmjnh/tm-ui/dist"` in `tm-shared/packages/design-system/css/index.css` (without it the pills' `bg-success/10` never reach the CSS), and a client plugin registering `UBadge`/`UIcon` from `#components`. Do not add `vue` to `tm-cms/package.json` to make `dedupe` resolve a root copy: that broke `vue-tsc` with 122 errors.

The pills' contrast is fine under the WEB-12.d tokens once they render: 6.44:1 and 5.85:1 in light, 7.95:1 and 9.03:1 in dark, measured by compositing the 10 % tint over the page background (`getComputedStyle` returns `oklch`, so parse colours through a canvas, not a number regex).

## Colour contrast (WEB-12.d, 2026-11-13)

Measured with axe-core 4.10.2 (`color-contrast` rule only) against the live dev storefront (`:4018`, `sen-tuan`), in both colour modes. The storefront has no theme switch: it follows the OS, so a visitor on a light desktop gets the light theme, which is where the problems were.

Baseline on `/products` (light): 39 text nodes under AA. The causes were in the palette, not in a page:

- `--ui-primary` resolved to the palette's 500 step (amber-500), which is ~2:1 as text on white, and ~1.7:1 on the pale `bg-primary/10` chips and badges. Fills are fine at that step; text is not.
- `text-muted` and `text-dimmed` are translucent mixes of the body colour in Nuxt UI, so they fade towards white: 2.5:1 for muted, 1.2:1 for dimmed. Overriding `--ui-text-muted` alone changed nothing — the utilities do not read it.

What changed in `tm-shared/packages/design-system/css/tokens.css`:

- `:root` (light): `--ui-primary: var(--ui-color-primary-800)` (~6.6:1 on white, 5.6:1 on `bg-primary/10`), `--ui-text-muted` and `--ui-text-dimmed` at `neutral-600` (~7:1).
- `.dark`: the same three re-stated at dark's lighter steps (`primary-400`, `neutral-400`, `neutral-500`). This was necessary: Nuxt UI states its light values on a zero-specificity `:where(...)` selector, so the light block reached dark mode and turned grey-on-black text into 2.3:1 — the dark theme's measured 0 violations only came back once dark re-declared them.
- `.text-muted` and `.text-dimmed` now resolve to solid `neutral-600` (light) / `neutral-400`–`500` (dark) instead of the translucent mix.

Evidence after the change (0 violations in every row; numbers are text nodes axe could resolve):

| Page | Light | Dark |
| --- | --- | --- |
| `/` | 95 pass, 0 violations | 95 pass, 0 violations |
| `/products` | 105 pass, 0 violations | 105 pass, 0 violations |
| `/bai-viet` | 30 pass, 0 violations | 30 pass, 0 violations |
| `/khong-ton-tai` (404) | 5 pass, 0 violations | 5 pass, 0 violations |
| `/products/bo-hn-bo`, `/gio-hang` | 0 violations (measured with the backdrop visible; see the caveats) | 0 violations |

How the measurement had to be set up, because two things in this UI quietly corrupt a naive run:

- **The decorative backdrop.** `.udmt-backdrop` paints a radial amber gradient behind everything, and axe reports every element over a gradient as *incomplete* ("background colour could not be determined") rather than checking it. With it visible, `/bai-viet` resolved only 12 nodes and "0 violations" meant little. The table's runs hide that element (it is `aria-hidden` decoration, a ≤14% tint over the base surface) so the base surface can be read; 2 nodes per page stay unresolved (image overlays).
- **Frozen transitions.** `.bento-card` carries `transition: all .2s`; in a background tab Chrome pauses transitions, so a card measured mid-switch kept the *previous* theme's surface. That produced a run where every product card read as dark-on-dark (24–56 false violations) while the screenshot showed a white card. Every run above injects `transition: none; animation: none` before measuring; the card then reports its real `oklab(0.97 / 0.82)` surface.

### The CMS, same tokens (`:4005`, mock session, `sen-tuan`)

The CMS shares the design system, so the same three fixes apply, and it turned up three more once measured. Both themes, 0 violations in every row:

| Page | Light | Dark | Note |
| --- | --- | --- | --- |
| `/login` | 8 pass | 8 pass | dark had 1 violation before the fix |
| `/` (Control Center) | 11 pass | 11 pass | the dashboard's own "An error occurred" card was the violation (red-500 as text, 3.55:1) |
| `/catalog` | 318 pass | 318 pass | list + filters, the densest page |
| `/content` | 39 pass | 39 pass | two status badges were the violations |
| `/configs` | 61 pass | 61 pass | 13 inputs, labels and hints |
| `/audit` | 30 pass | 30 pass | empty table (`audit_logs` is 0 after the earlier probe cleanup), so the empty state is what was measured |
| `/settings` | 41 pass | 41 pass | read-only system info, no form controls |

What the CMS added to the token file:

- Dark `text-dimmed` at `neutral-500` was 3.25:1 on a stone-800 surface (the login footer) — now `neutral-400`, same as muted.
- `--ui-error` at red-500 was 3.55:1 as text on a light surface — light now uses `error-800`; so do `--ui-warning`, `--ui-success` and `--ui-info`, which start at 1.9–2.6:1.
- 700 was not enough for those four either: a warning badge (`bg-warning/10`) measured 4.06:1 and a success badge 4.38:1, because the badge's own 10% tint lifts the background. 800 clears both, and dark keeps its 400 steps.

Measurement change for the CMS: hiding only `.udmt-backdrop` was not enough. The login and dashboard paint their gradients on other elements, so axe still skipped every node. The runs above remove `background-image` from every element (a tint, not structure) together with transitions; the CMS pages then resolve 8–318 nodes each.

Not covered: colour contrast is the only rule run, so focus rings, screen-reader output and the pending affordance stay as they were; `text-primary` on photographic media is not measured by anything here; the storefront's own numbers were re-taken after the semantic-token change on `/products` (105 pass, 0 violations) but not on every page again.

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
