import io

def patch(path, pairs):
    s = io.open(path, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in s else '\n'
    for old, new in pairs:
        o, a = old.replace('\n', nl), new.replace('\n', nl)
        assert s.count(o) == 1, (path, old[:60], s.count(o))
        s = s.replace(o, a)
    io.open(path, 'w', encoding='utf-8', newline='').write(s)
    print('patched', path)


feature = """### WEB-16 — the header's `/about` and `/contact` links pointed at nothing (landed 2026-11-13)

- Found in the per-customer browser pass, not by a gate: on the production build of `sentuan`, `/products`, `/bai-viet`, `/danh-muc` and a product detail answered `200`, while `/about` and `/contact` answered `404` — although both the header fallback menu (`usePublicSite`) and the footer (`layouts/default.vue`) link to them, and the web layer has no such pages.
- Fix: two pages in `web-base`, both reading the site's own settings through `usePublicSite()`/`useSiteConfig()` — a phone number or an address is never invented, so a site that has saved none gets an explicit empty state instead of a form that goes nowhere. `usePageRobots({ empty })` keeps a contentless page out of the index.
- State of this site (as the DB actually is): settings company fields are all empty, so `/about` renders "This page has no content yet" and `/contact` "No contact details yet", both `noindex, follow`. The moment an operator fills the company block in the CMS, the same pages render the real details with no code change.
- Evidence: after `TM_CUSTOMER_ID=sentuan pnpm build:web` and a preview on `:4018`, `/about` and `/contact` answer `200` (`<title>Giới thiệu Sen Tuấn Jewelry & Gemstones</title>`, `<h1>` matching), the main area shows the empty state with its panel, and `robots` is `noindex, follow`. `pnpm typecheck` and `pnpm lint` clean, `pnpm verify:all` 27/27.
- Not covered: the same check was not repeated for every customer, and no test asserts the two routes exist — a scaffold check would be the next step if these pages are expected to stay.

"""

patch('docs/v2/05-feature-parity.md', [
    ('### WEB-15 — `@tuanmjnh/tm-ui` adopted through the link (landed 2026-11-13)',
     feature + '### WEB-15 — `@tuanmjnh/tm-ui` adopted through the link (landed 2026-11-13)'),
])

operations = """## Previewing a matrix build, and one browser pass (2026-11-13)

`pnpm test:build-matrix` built all eight targets in 319s — web and CMS for `default` and `sentuan`, web for `bagpost`, CMS for `bagpost`/`thanhtung`/`hoangvi` — with the storefront isolation suite at its usual 24/24 per build. That run is also the regression check for the `vue` alias added in WEB-15: every CMS customer build executes `tm-cms/nuxt.config.ts`, so a broken alias would fail the matrix, not just `sentuan`.

The preview that follows a matrix build needs the environment a second time, and this is not obvious: the matrix builds with `NODE_ENV=production` and `TM_CUSTOMER_ID` only, so `runtimeConfig` is baked with an empty `mongoUri`. Starting the output directly answers `503 error.catalogNotConnected` on `/api/public/products` and `error.contentUnavailable` on `/api/public/content` while `/api/public/site-config` falls back silently — which reads like a broken build, not missing configuration. Start it with Nitro's runtime overrides instead:

```bash
PORT=4018 NUXT_MONGO_URI=mongodb://127.0.0.1:27017 NUXT_CATALOG_DB_NAME=sen-tuan \\
  NUXT_PUBLIC_SITE_ID=sentuan node .devlogs/build-matrix/sentuan/web/.output/server/index.mjs
```

With those, `/`, `/products`, a product detail, `/bai-viet` and `/danh-muc` answer `200`, the home page lists eight real products, and the title/theme colour are `sentuan`'s with no other customer's name anywhere in the document.

The pass also turned up dead links the gates cannot see: `/about` and `/contact` returned `404` while the header and footer link to both. They now exist as settings-driven pages (see `05`, WEB-16). Two limits worth stating: this was one customer's storefront, and the CMS browser pass is still blocked on a Hub session.

"""

patch('docs/v2/08-operations-and-verification.md', [
    ('## The Vue alias that unblocked the `link:` adoption (WEB-15, 2026-11-13)',
     operations + '## The Vue alias that unblocked the `link:` adoption (WEB-15, 2026-11-13)'),
])

todo = """### WEB-16 — `/about` and `/contact` exist now (landed 2026-11-13)

- The per-customer browser pass on the `sentuan` production build found both routes answering `404` while the header and footer link to them. Added two settings-driven pages in `web-base` (company name, description, email, phone, address, social links) with honest empty states and `noindex` while empty.
- Also from this pass: `test:build-matrix` is 8/8 in 319s (and is the regression check for WEB-15's `vue` alias); previewing a matrix build requires `NUXT_*` runtimeConfig overrides or the public APIs answer `503`, which is configuration and not a build failure — both recorded in `08`.
- Open: no test asserts the two routes exist, and the CMS browser pass still needs a Hub session.

"""

patch('tasks/todo.md', [
    ('### WEB-15 — `@tuanmjnh/tm-ui` adopted through the link (landed 2026-11-13)',
     todo + '### WEB-15 — `@tuanmjnh/tm-ui` adopted through the link (landed 2026-11-13)'),
])
