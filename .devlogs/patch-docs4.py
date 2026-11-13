import io, re

def patch(path, pairs):
    s = io.open(path, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in s else '\n'
    for old, new in pairs:
        o, a = old.replace('\n', nl), new.replace('\n', nl)
        assert s.count(o) == 1, (path, old[:60], s.count(o))
        s = s.replace(o, a)
    io.open(path, 'w', encoding='utf-8', newline='').write(s)
    print('patched', path)


feature = """### WEB-15 — `@tuanmjnh/tm-ui` adopted through the link (landed 2026-11-13)

- What landed: the CMS module badges (`ModuleStatusBadges.vue`, `/inventory`, `/orders`, `/catalog`, `/reports`, `/ai`) draw the package's `StatusBadge` instead of two hand-written `UBadge`s, with `@tuanmjnh/tm-ui` linked into the `cms-base` layer.
- The four wiring steps are in `tm-platform/docs/upgrade.md` §0: the dependency (in the layer that imports it), `vite.server.fs.allow`, `@source` for the package's `dist`, and a client plugin registering the primitives the package resolves (`UBadge`, `UButton`, `UIcon`, `UPopover`, `USelectMenu`, `UTooltip` — the union from `grep resolveComponent dist/*.js`, not just the ones the badge needs).
- What unblocked WEB-13: the fourth requirement, one Vue instance. `vue` is not reachable from any `node_modules` here, so `vite.resolve.dedupe` has nothing to resolve from the app root, and adding `vue` as a dependency to make it work broke `vue-tsc` with 122 errors. Instead `tm-cms/nuxt.config.ts` aliases `vue` (exact match) to the build the app already loads, found in the pnpm store (`node_modules/.pnpm/vue@*/node_modules/vue/dist/vue.runtime.esm-bundler.js`). No dependency changes, typecheck stays green, and the package stops resolving its own 3.5.45 next to our 3.5.44.
- Evidence: on the dev CMS `/inventory` the pills are `span[data-slot="base"]` carrying `bg-success/10 text-success ring ring-inset ring-success/25` and `rounded-[4px]`, with `document.querySelectorAll('ubadge').length` at `0` — the same class set measured in the WEB-13 probe at 6.44:1 / 5.85:1 (light) and 7.95:1 / 9.03:1 (dark). `active:scale-95`, a class that exists only in the package's dist, is present in the built CSS, so the `@source` scan really runs. `pnpm typecheck` 0 errors, `TM_CUSTOMER_ID=sentuan pnpm build:cms` exit 0, `pnpm verify:all` 27/27.
- Not verified: the model picker (`ModelSelect`) has no call site in this repo, so its four extra primitives are registered but unexercised; the alias is a dev-and-build resolution rule, so a Vue minor bump in `tm-platform` no longer reaches this app — which is the intended trade and is why publishing the package (peer `vue`) is still the right end state.
- The alias path is read from the pnpm store by directory name (`vue@*`). It is not a dependency contract, and a second `vue@` in the store would make the first match arbitrary; if that ever happens, replace it with an explicit dependency and `dedupe`, and re-run the typecheck before believing it.

"""

patch('docs/v2/05-feature-parity.md', [
    ('### WEB-14 — shared envelope from `tm-platform`, attempted and reverted (2026-11-13)',
     feature + '### WEB-14 — shared envelope from `tm-platform`, attempted and reverted (2026-11-13)'),
])

operations = """## The Vue alias that unblocked the `link:` adoption (WEB-15, 2026-11-13)

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

"""

patch('docs/v2/08-operations-and-verification.md', [
    ('## Shared packages: the registry route (WEB-14, 2026-11-13)',
     operations + '## Shared packages: the registry route (WEB-14, 2026-11-13)'),
])

todo = """### WEB-15 — `@tuanmjnh/tm-ui` adopted through the link (landed 2026-11-13)

- CMS module badges use the package's `StatusBadge`; the four wiring steps (dependency in `cms-base`, `fs.allow`, `@source`, plugin registering the six primitives the dist resolves) are documented in `tm-platform/docs/upgrade.md` §0.
- WEB-13's blocker was solved without a `vue` dependency: `tm-cms/nuxt.config.ts` aliases exact `vue` to the build the app already loads, found in the pnpm store. Pills verified in the DOM (`span[data-slot="base"]`, `ubadge` count 0), `scale-95` from the package's dist in the built CSS, typecheck 0, `build:cms` exit 0, `verify:all` 27/27.
- Open: `ModelSelect` has no call site here so its primitives are unexercised; the alias pins Vue, so publishing `tm-ui` (peer `vue`) is still the preferred end state.

"""

patch('tasks/todo.md', [
    ('### WEB-14 — shared envelope from `tm-platform`, attempted and reverted (2026-11-13)',
     todo + '### WEB-14 — shared envelope from `tm-platform`, attempted and reverted (2026-11-13)'),
])
