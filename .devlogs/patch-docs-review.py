import io

def patch(path, pairs):
    s = io.open(path, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in s else '\n'
    for old, new in pairs:
        o, a = old.replace('\n', nl), new.replace('\n', nl)
        assert s.count(o) == 1, (path, old[:50], s.count(o))
        s = s.replace(o, a)
    io.open(path, 'w', encoding='utf-8', newline='').write(s)
    print('patched', path)


feature = """### WEB-17 — a dead-link gate, and a second look at WEB-16 (landed 2026-11-13)

- The review found the two pages rendering the same thing twice: `/about` printed exactly the email/phone/address block `/contact` owns, and the empty state was copy-pasted. `/about` now shows only the customer's description plus a link to `/contact`, and both pages render the shared `WebNotice` (the same shape as the existing `CatalogStateNotice`), so the layer has one empty state instead of three. `contact.vue` also stopped modelling "no link" as `href: ''` — the address row simply has no `href` — and the four about-only message keys left with the block they described.
- What let the bug through: a link to a page that does not exist typechecks, lints and builds. `pnpm test:web-routes` (`scripts/build/test-web-routes.ts`, part of the default `verify:all` set) reads the page files, scans the layer's literal internal targets (`to=`, `to:`, `href=`, `navigateTo`, `router.push`) and fails with `target (file:line)`.
- The catch-all page deliberately does not satisfy a link: it renders CMS content by path, which is exactly how `/about` answered `404` while still "having a page". Without that rule the gate would pass on any href and be worthless.
- Proven both ways: delete `about.vue` and the gate exits `1`, naming `/about has no page file` and `links point at pages that do not exist: /contact (tm-shared/nuxt-layers/web-base/app/pages/about.vue:45)`; restore it and it is green again, with `pnpm verify:all` at 28/28.
- Not covered: literal targets only. A link built at runtime (`/products/${slug}`) is out of scope, and so is a CMS-managed menu row — those hrefs are admin content, not routes in the repository.

"""

patch('docs/v2/05-feature-parity.md', [
    ('### WEB-16 — the header\'s `/about` and `/contact` links pointed at nothing (landed 2026-11-13)',
     feature + '### WEB-16 — the header\'s `/about` and `/contact` links pointed at nothing (landed 2026-11-13)'),
])

operations = """## The per-customer browser pass, and why a matrix output is not a preview (2026-11-13)

The matrix was rebuilt after WEB-16/WEB-17 (8/8 targets, 319s), then each customer was opened in the browser from its own build:

| customer | app | checked | result |
| --- | --- | --- | --- |
| `default` | web | `/`, `/about`, `/contact`, `/products`, `/bai-viet` | `200`, title "TM Enterprise Storefront", theme `#8b5cf6` |
| `bagpost` | web | the same routes plus the public APIs | `200`, title "Bag Post Logistics & Packaging", theme `#10b981`, correct brand everywhere, no other customer's name; the `bag-post` database holds 0 products and 0 categories, so an empty listing is the data, not a failure |
| `bagpost` | cms | `/login` | `200`, "Bag Post CMS", `#10b981`, email + password |
| `thanhtung` | cms | `/login` | `200`, "Thanh Tùng CMS", `#3b82f6` |
| `hoangvi` | cms | `/login` | `200`, "Hoàng Vi CMS", `#f43f5e` |

No page carried another customer's name in any of the five. The first attempt cost time and is worth recording: running `.devlogs/build-matrix/<customer>/<app>/.output/server/index.mjs` answers `500` with `ERR_MODULE_NOT_FOUND: Cannot find package 'devalue' … chunks/routes/renderer.mjs`. A matrix output is a build artifact validated in place, not a runnable tree — its externals resolve relative to the app directory and there is no `node_modules` beside `.devlogs`. Build the app's own output instead:

```bash
TM_CUSTOMER_ID=bagpost pnpm build:cms
PORT=4021 NUXT_MONGO_URI=mongodb://127.0.0.1:27017 NUXT_MONGO_DB=bag-post NUXT_SITE_ID=bagpost \\
  node tm-cms/.output/server/index.mjs
```

Same customer, same build: `200` and the login page renders. The storefront happened to run from the matrix copy only because web inlines everything it needs.

Not covered: the CMS was checked up to the login page — signing in needs a Hub account, and there is none for these customers. `thanhtung` and `hoangvi` have no storefront in the registry, so there is no web pass for them.

"""

patch('docs/v2/08-operations-and-verification.md', [
    ('## Previewing a matrix build, and one browser pass (2026-11-13)',
     operations + '## Previewing a matrix build, and one browser pass (2026-11-13)'),
])

todo = """### WEB-17 — the dead-link gate, and the rest of the browser pass (landed 2026-11-13)

- Review of WEB-16: `/about` no longer repeats `/contact`'s channel block, both pages share one `WebNotice` empty state, and the keys only the removed block used are gone.
- New default gate `pnpm test:web-routes` fails on any literal navigation target with no page behind it, and the catch-all page does not count as one; proven by deleting `about.vue` and watching it name the dead link with file:line. `verify:all` is 28/28.
- Per-customer pass finished: `default` and `bagpost` storefronts, and the `bagpost`/`thanhtung`/`hoangvi` CMS login pages all render their own brand, title and theme colour with no foreign name. Matrix 8/8 in 319s.
- Finding: a matrix output is not runnable (`ERR_MODULE_NOT_FOUND: devalue`) — preview from the app's own `.output` after `TM_CUSTOMER_ID=<id> pnpm build:web|cms`.
- Open: no signed-in CMS pass (needs a Hub account), and runtime-built links (`/products/${slug}`) plus CMS-managed menu rows stay outside the gate.

"""

patch('tasks/todo.md', [
    ('### WEB-16 — `/about` and `/contact` exist now (landed 2026-11-13)',
     todo + '### WEB-16 — `/about` and `/contact` exist now (landed 2026-11-13)'),
])
