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


feature = """### WEB-20 — a gate for query-param mismatches between links and their pages (landed 2026-11-13)

- `test:web-routes` now also scans navigation links that carry a `query: { ... }` object and checks that every key in it is a key the target page reads from `route.query`. A page that reads `route.query[key]` dynamically is treated as accepting any key, so `/bai-viet` and `/tim-kiem` stay out of the check.
- This is the class of bug that made `tim-kiem.vue`'s "view all products" link pass `search=` while `products/index.vue` read `q` — the filter was silently dropped and the link landed on the unfiltered list. The gate now fails with `/products: query key "search" is never read by the target page`.
- Proven both ways: reverting the link to `query: { search: q }` made the gate exit `1` naming the key and the target; restoring `query: { q }` put it back to green. `verify:all` is 28/28.
- Limits: only links written as `{ path, query: { ... } }` (or the reverse order) are seen; a query built at runtime or passed through a variable is out of scope, same as the path gate.

"""

patch('docs/v2/05-feature-parity.md', [
    ('### WEB-19 — the dead-link gate now covers the CMS too (landed 2026-11-13)',
     feature + '### WEB-19 — the dead-link gate now covers the CMS too (landed 2026-11-13)'),
])

todo = """### WEB-20 — a gate for query-param mismatches (landed 2026-11-13)

- `test:web-routes` now fails when a navigation link's `query` keys are not read by the target page. Proven by reverting the `search`/`q` fix and watching it name the key.
- `verify:all` 28/28. Limits: literal `{ path, query }` objects only.

"""

patch('tasks/todo.md', [
    ('### WEB-19 — the dead-link gate now covers the CMS too (landed 2026-11-13)',
     todo + '### WEB-19 — the dead-link gate now covers the CMS too (landed 2026-11-13)'),
])
