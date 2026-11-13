import io

def patch(path, replacements):
    s = io.open(path, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in s else '\n'
    for old, new in replacements:
        old = old.replace('\n', nl)
        new = new.replace('\n', nl)
        assert s.count(old) == 1, (path, old[:70], s.count(old))
        s = s.replace(old, new)
    io.open(path, 'w', encoding='utf-8', newline='').write(s)
    print('patched', path)


feature = """### WEB-14 — first shared package from `tm-platform` (landed 2026-11-13)

- What landed: `@tuanmjnh/tm-types` installed from the npm registry into the CMS layer (`cms-base`), and `useCategoryAdmin.ts` typed with the shared `ApiResponse<T>` instead of its hand-written `{ success: boolean, data: AdminCategory[] }`. The response narrows it back to a required `data` (`Omit<ApiResponse<AdminCategory[]>, 'data'> & { data, tree }`) because this endpoint always answers with both the flat list and the tree.
- Why this package and not `tm-ui`: `tm-utils`, `tm-validators` and `tm-types` are published (0.1.0), only `tm-ui` is not — and `link:` on a Vue package is what broke WEB-13. A published package installs under `.pnpm` with the app's own dependency graph, so the `fs.allow` / `@source` / second-Vue wiring does not apply, and `tm-types` has no runtime at all.
- Install friction worth knowing: this repo pins `minimumReleaseAge`, so pnpm refused the brand-new 0.1.0 until it was listed in `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` (one line, committed with the change).
- Evidence: `pnpm typecheck` 0 errors — it first reported four real "`data` is possibly undefined" sites in `categories.vue`/`content.vue`, which is why the type narrows `data` instead of leaving it optional — `pnpm verify:all` 27/27, and the live contract on the dev CMS: `POST /api/auth/login` → `200`, then `GET /api/v1/admin/categories` → `200` with `{ success: true, data: [], tree: [] }`. The database holds no categories; nothing was created to make the shape look better.
- Not adopted: `tm-utils` is Hub-shaped (`deviceCredentialScope`, `parseUpstreamAiError`) and `tm-validators`' `PaginationParamsSchema` assumes page/limit offsets while every list endpoint here is cursor-based; using either would replace working code with a worse contract.

"""

patch('docs/v2/05-feature-parity.md', [
    ('### WEB-13 — shared packages from `tm-platform` (probe, blocked 2026-11-13)',
     feature + '### WEB-13 — shared packages from `tm-platform` (probe, blocked 2026-11-13)'),
])

operations = """## Shared packages: the registry works, `link:` does not (WEB-14, 2026-11-13)

`@tuanmjnh/tm-types@0.1.0` was installed from npm (`pnpm add` through the workspace), not linked, and it needed no Vite or Tailwind config: `.pnpm` places it in the app's dependency graph and a types-only package never reaches the bundle. Two things cost time and belong in any repeat: `minimumReleaseAge` blocks a release this new until the exact version is added to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`, and the shared `ApiResponse<T>` has an optional `data`, so every consumer that assumes a payload fails the typecheck until the endpoint's type narrows it (`vue-tsc` found two such pages, which is the useful part).

Verification for a types-only adoption is typecheck plus the live contract, not a browser: `POST /api/auth/login` then `GET /api/v1/admin/categories` on the dev CMS — `{ success: true, data: [], tree: [] }` — is enough to prove the shape the type claims.

## `tm-hub` has the `StatusBadge` bug too (2026-11-13)

The same precompiled `resolveComponent('UBadge')` lookup fails in `tm-hub`, so its non-clickable pills (`app/pages/administration/{apps,configs,content,roles}.vue`) render as empty `<ubadge>` custom elements; the `clickable` ones draw a plain `<button>` and look correct, which is why a "pills render" check can pass while half the badges are invisible. Read from the running dev server (`:4000`): the package's module resolves `tm-hub/node_modules/.pnpm/vue@3.5.44…` — one Vue instance, unlike `tm-websites` — but the app's component registry holds only `RouterLink`, `RouterView`, `Icon`, `LazyIcon` and the i18n components, with no `UBadge`/`UIcon`.

So `tm-hub` needs only the registry half of the fix: a client plugin registering `UBadge` and `UIcon` from `#components`, with no `dedupe` and no `vue` dependency. `tm-websites` proved that mechanism on 2026-11-13 — with a single Vue instance and the two components registered, the pills drew `span[data-slot="base"]` with `bg-success/10` and real contrast ratios.

"""

patch('docs/v2/08-operations-and-verification.md', [
    ('## Shared packages from `tm-platform` (WEB-13, 2026-11-13)',
     operations + '## Shared packages from `tm-platform` (WEB-13, 2026-11-13)'),
])

todo = """### WEB-14 — first shared package from `tm-platform` (landed 2026-11-13)

- `@tuanmjnh/tm-types@0.1.0` from the npm registry in `cms-base`; `useCategoryAdmin` types its envelope with the shared `ApiResponse<T>`, narrowed so `data` stays required. `minimumReleaseAge` needed the one-line exclusion in `pnpm-workspace.yaml`; typecheck 0 errors, `verify:all` 27/27, live `GET /api/v1/admin/categories` → `{ success, data, tree }`.
- Still out: `tm-ui` until it is published (WEB-13). `tm-utils` and `tm-validators` do not fit the current contracts (Hub device credentials and upstream AI errors; page/limit pagination) — do not force them in.
- Found on the way: `tm-hub` shows the same empty-`StatusBadge` bug — its non-clickable pills are unresolved `<ubadge>` elements because the app registry has no `UBadge`/`UIcon`, even though it has a single Vue instance. The fix there is a client plugin registering both from `#components`; the detail is in `08`.

"""

patch('tasks/todo.md', [
    ('### WEB-13 — shared packages from `tm-platform` (probe, blocked 2026-11-13)',
     todo + '### WEB-13 — shared packages from `tm-platform` (probe, blocked 2026-11-13)'),
])
