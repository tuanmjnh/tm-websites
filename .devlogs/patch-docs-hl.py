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


feature = """### WEB-18 — product names are highlighted, and a query-param bug in the search page (landed 2026-11-13)

- `CatalogProductCard` gains an optional `term` prop; when it is set the name and the summary render through the existing `WebSearchHighlight` instead of plain text, so the visitor's term is wrapped in `<mark>`. `tim-kiem.vue` passes `q` and `products/index.vue` passes `listQuery.search`, so the highlight only ever reflects a query that was actually searched.
- The same page had a real bug hidden behind the same code path: `tim-kiem.vue`'s "view all products" link was `query: { search: q }`, but `products/index.vue` reads `route.query.q` (its `search` field is derived from `q`). The link landed on the unfiltered list. It now passes `q`.
- Evidence (`sentuan`, built into `tm-web/.output`, preview on `:4018`, `q=Bo`): `/tim-kiem` renders 16 `<mark>` across 8 product cards, the view-all link is `/products?q=Bo`, and `/products?q=Bo` renders 24 `<mark>` on the same names. `pnpm typecheck` 0, `pnpm lint` 0, `pnpm test:web-routes` 4/4, `pnpm verify:all` 28/28.
- Limits: only literal terms are highlighted and only in the card title and summary; the term is escaped before it becomes a pattern, so it cannot inject markup. The `CatalogProductCard`'s category and price are deliberately left plain.

"""

patch('docs/v2/05-feature-parity.md', [
    ('### WEB-17 — a dead-link gate, and a second look at WEB-16 (landed 2026-11-13)',
     feature + '### WEB-17 — a dead-link gate, and a second look at WEB-16 (landed 2026-11-13)'),
])

todo = """### WEB-18 — product-name highlighting, and a query-param fix (landed 2026-11-13)

- `CatalogProductCard` now takes an optional `term` and renders name + summary through `WebSearchHighlight`; `tim-kiem.vue` passes `q` and `products/index.vue` passes `listQuery.search`.
- Fixed `tim-kiem.vue`'s "view all products" link, which was `query: { search: q }` while the catalog page reads `route.query.q` and therefore silently dropped the filter.
- Evidence on `sentuan` with `q=Bo`: 16 `<mark>` on the search page, 24 on the catalog page, and the link is `/products?q=Bo`. `typecheck`/`lint`/`test:web-routes`/`verify:all` (28/28) green.
- Open: the query-param mismatch is not covered by any gate (the dead-link gate only sees paths), so a test for the "view all" link's `q` would be the natural next step.

"""

patch('tasks/todo.md', [
    ('### WEB-17 — the dead-link gate, and the rest of the browser pass (landed 2026-11-13)',
     todo + '### WEB-17 — the dead-link gate, and the rest of the browser pass (landed 2026-11-13)'),
])
