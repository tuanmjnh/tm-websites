import io

def patch(path, replacements):
    s = io.open(path, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in s else '\n'

    for old, new in replacements:
        old = old.replace('\n', nl)
        new = new.replace('\n', nl)
        assert s.count(old) == 1, (path, old[:60], s.count(old))
        s = s.replace(old, new)

    io.open(path, 'w', encoding='utf-8', newline='').write(s)
    print('patched', path)


feature = """### WEB-13 — shared packages from `tm-platform` (probe, blocked 2026-11-13)

- Direction: a component that both this repo and `tm-hub` need belongs in `D:\\Applications\\tm-platform\\packages` (`@tuanmjnh/*`), not in `tm-shared`. This slice tried the first adoption: `@tuanmjnh/tm-ui`'s `StatusBadge` for the CMS module badges (`ModuleStatusBadges.vue`, one call site, replacing two hand-written `UBadge`s).
- What a `link:` dependency needs on top of what `tm-platform/docs/upgrade.md` documents (dependency, Vite `server.fs.allow`, Tailwind `@source`): the package's `dist/*.js` is precompiled, so its `resolveComponent('UBadge')` / `('UIcon')` calls require those components on the app instance (a client plugin registering them from `#components`), and Vite must not bundle a second Vue.
- Why it is blocked: with `link:` the package resolves `vue` from `tm-platform` (3.5.45) next to this repo's 3.5.44, and Vite loads both. `resolveComponent` then runs with no `currentInstance`, returns the tag name string, and Vue renders `<ubadge label="…" color="success">` as an unknown element — empty pills, no console error, and `pnpm build:cms` still green. Registering the components changed nothing: the registry was correct, the wrong Vue instance was asking.
- The obvious repair does not work here: `vite.resolve.dedupe: ['vue']` only helps when `vue` resolves from the app root, and adding `vue` to `tm-cms/package.json` for that broke `vue-tsc` with 122 errors, including `Cannot find module 'vue'` in `cms-base/app/composables/useMobileBar.ts` — the layer has no `vue` of its own to resolve.
- Consequence: no `link:` for Vue-dependent `@tuanmjnh/*` packages in this repo until `@tuanmjnh/tm-ui` is published (its publish is currently blocked on npm OTP). Installed from the registry, `vue` comes from the app as a peer and there is one instance; `tm-platform` should also consider shipping the SFCs instead of a precompiled `dist`, so the app's auto-imports apply. Pure-TypeScript packages (`tm-utils`, `tm-validators`, `tm-types`) have none of these problems and can be adopted first.
- Reverted in full: no dependency, config, CSS or component change landed; typecheck, lint and `build:cms` were green before and after.

"""

patch('docs/v2/05-feature-parity.md', [
    ('### WEB-12.d — colour contrast in both themes (landed 2026-11-13)',
     feature + '### WEB-12.d — colour contrast in both themes (landed 2026-11-13)'),
])

operations = """## Shared packages from `tm-platform` (WEB-13, 2026-11-13)

A `link:` dependency on `@tuanmjnh/tm-ui` renders nothing in the CMS and still passes every gate. Reproduce it before adopting anything from that repo: mount `StatusBadge` from the package and read `document.querySelectorAll('ubadge').length` in the live page — a non-zero count means the component resolved to a bare tag name, not to a component.

Why: the package's `dist` is precompiled by `scripts/build-sfc.mjs`, so its render functions call `resolveComponent('UBadge' | 'UIcon')` at runtime, and `link:` makes Vite resolve the package's own `vue` (3.5.45) instead of this repo's (3.5.44). With two Vue module instances the app registry is populated correctly but the package's `resolveComponent` has no `currentInstance`, so it returns the string. Nothing logs an error; `nuxt build` and `vue-tsc` stay green.

The wiring used for the probe, for whoever repeats it once the package is published: `"@tuanmjnh/tm-ui": "link:../../../../tm-platform/packages/tm-ui"` in the layer that imports it (`cms-base`, not `core-base` — TypeScript resolves from the importing file's directory), `vite.server.fs.allow` for that directory in `tm-cms/nuxt.config.ts`, `@source "<layer>/node_modules/@tuanmjnh/tm-ui/dist"` in `tm-shared/packages/design-system/css/index.css` (without it the pills' `bg-success/10` never reach the CSS), and a client plugin registering `UBadge`/`UIcon` from `#components`. Do not add `vue` to `tm-cms/package.json` to make `dedupe` resolve a root copy: that broke `vue-tsc` with 122 errors.

The pills' contrast is fine under the WEB-12.d tokens once they render: 6.44:1 and 5.85:1 in light, 7.95:1 and 9.03:1 in dark, measured by compositing the 10 % tint over the page background (`getComputedStyle` returns `oklch`, so parse colours through a canvas, not a number regex).

"""

patch('docs/v2/08-operations-and-verification.md', [
    ('## Colour contrast (WEB-12.d, 2026-11-13)',
     operations + '## Colour contrast (WEB-12.d, 2026-11-13)'),
])

todo = """### WEB-13 — shared packages from `tm-platform` (probe, blocked 2026-11-13)

- `tm-websites` stays on local components for now. `@tuanmjnh/tm-ui` cannot be consumed through `link:` here: the package resolves its own `vue` (3.5.45 vs 3.5.44), Vite loads two Vue instances, and its precompiled `resolveComponent('UBadge')` renders empty `<ubadge>` tags while every gate stays green.
- The probe covered the full wiring (`link:` dependency in `cms-base`, `vite.server.fs.allow`, `@source` for the package's `dist`, `UBadge`/`UIcon` registered from `#components`) and was reverted whole; evidence and traps are in `08` under "Shared packages from `tm-platform`".
- Next: re-run the adoption after `@tuanmjnh/tm-ui` is published to the registry (peer-resolved `vue` = one instance), or after `tm-platform` ships the raw SFCs instead of a precompiled `dist`. Start with the pure-TypeScript packages (`tm-utils`, `tm-validators`, `tm-types`), which have none of this coupling.

"""

patch('tasks/todo.md', [
    ('### Waiting for an external fact (no workaround)',
     todo + '### Waiting for an external fact (no workaround)'),
    ('- **Legacy data snapshot** — migration dry-run; no fixture is invented to stand in for it.',
     '- **Legacy data snapshot** — migration dry-run; no fixture is invented to stand in for it.\n- **`@tuanmjnh/tm-ui` publish** (npm OTP) — the only way a Vue-dependent package from `tm-platform` can be adopted without a second Vue instance (WEB-13).'),
])
