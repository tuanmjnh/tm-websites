import io

def patch(path, pairs):
    s = io.open(path, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in s else '\n'
    for old, new in pairs:
        o, a = old.replace('\n', nl), new.replace('\n', nl)
        assert s.count(o) == 1, (path, old[:40], s.count(o))
        s = s.replace(o, a)
    io.open(path, 'w', encoding='utf-8', newline='').write(s)
    print('patched', path)


feature = """### WEB-19 — the dead-link gate now covers the CMS too (landed 2026-11-13)

- The same gate that caught `/about` and `/contact` now reads both app roots: the storefront and the CMS. `scripts/build/test-web-routes.ts` takes an `APPS` list (root, page directory, minimum link count) and runs the same manifest + link scan + resolution per app, so a new sidebar entry in `cms-base/layouts/default.vue` that points at a page which was renamed or removed fails `verify:all` instead of waiting for a click.
- Proven both ways: moving `cms-base/app/pages/audit.vue` out made the gate exit `1` naming `/audit (…/pages/index.vue:176)`, and restoring it put it back to green. `verify:all` is 28/28.
- Limits unchanged: literal targets only, and the catch-all page still does not count as a route for either app.

"""

patch('docs/v2/05-feature-parity.md', [
    ('### WEB-18 — product names are highlighted, and a query-param bug in the search page (landed 2026-11-13)',
     feature + '### WEB-18 — product names are highlighted, and a query-param bug in the search page (landed 2026-11-13)'),
])

todo = """### WEB-19 — the dead-link gate now covers the CMS too (landed 2026-11-13)

- `test:web-routes` reads both `web-base` and `cms-base` page trees and scans both navigation surfaces; a renamed or deleted CMS page now fails the gate with file:line instead of producing a 404. Proven by moving `audit.vue` out and back.
- `verify:all` 28/28. Limits unchanged: literal targets only.

"""

patch('tasks/todo.md', [
    ('### WEB-18 — product-name highlighting, and a query-param fix (landed 2026-11-13)',
     todo + '### WEB-18 — product-name highlighting, and a query-param fix (landed 2026-11-13)'),
])
