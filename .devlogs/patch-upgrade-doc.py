import io

p = 'D:/Applications/tm-platform/docs/upgrade.md'
s = io.open(p, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'

anchor = """Do not use `file:` for local iteration: pnpm copies it into `.pnpm`, so edits
need a forced reinstall and it is easy to believe a change landed when it did
not.
"""

addition = """3. **The app must register the components the package resolves at runtime.**
   `dist` is precompiled by `scripts/build-sfc.mjs`, so a component's render
   function calls `resolveComponent('UBadge' | 'UIcon')` rather than receiving an
   injected auto-import. Nuxt rewrites auto-imports only in files it compiles
   itself, so for a package those lookups fall through to the app's global
   component registry:

```ts
// app/plugins/tm-ui-globals.client.ts
import { UBadge, UIcon } from '#components'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.component('UBadge', UBadge)
  nuxtApp.vueApp.component('UIcon', UIcon)
})
```

   Skipping this is silent in the worst way: the display variant of
   `StatusBadge` renders `<ubadge label="…" color="success">` as an unknown
   element — an empty pill, no console error, `nuxt build` and `vue-tsc` green.
   Only the `clickable` variant (a plain `<button>`) still looks right, so a
   visual check can pass while half the badges are invisible.

4. **One Vue instance, or none of the above helps.** `link:` also changes where
   the package resolves `vue` from: Vite reads it out of `tm-platform`'s tree
   (its own 3.5.45) instead of the app's. When the app cannot resolve `vue` from
   its root — `tm-websites` is such a case, `vue` arrives through Nuxt's own
   dependencies and its layers declare none — Vite loads both copies, the
   package's `resolveComponent` runs with no `currentInstance`, and it returns
   the tag name string. The registry from step 3 is then correct and irrelevant:
   the wrong Vue instance is asking.

   Diagnose it on a running dev server by reading the module Vite rewrote:

```bash
curl -s "http://localhost:4000/_nuxt/@fs/<abs>/packages/tm-ui/dist/StatusBadge.js" | head -1
# from "/_nuxt/@fs/.../tm-hub/node_modules/.pnpm/vue@3.5.44.../vue/dist/..."  -> one instance, fine
# from "/_nuxt/@fs/.../tm-platform/node_modules/.pnpm/vue@3.5.45.../vue/dist/..."  -> two instances
```

   A registry install (section 1) removes this whole class of bug: `vue` is a
   peer, so it resolves from the app and there is only one copy. That is the real
   reason to publish rather than link. If linking is unavoidable, the app needs a
   `vue` it can resolve plus `vite.resolve.dedupe: ['vue']` — and do that
   deliberately: adding `vue` to a Nuxt app's `package.json` only to give
   `dedupe` something to resolve produced 122 `vue-tsc` errors in `tm-websites`,
   including `Cannot find module 'vue'` in a layer file that has no dependency of
   its own. `tm-hub` links today because it already declares `vue` itself; it was
   missing step 3 only.

Do not use `file:` for local iteration: pnpm copies it into `.pnpm`, so edits
need a forced reinstall and it is easy to believe a change landed when it did
not.
"""

check_anchor = """Expected today: tm-platform 6 packages green; tm-tools 68/68; tm-studio 83/83
plus 41 gateway tests; tm-hub 268/268.
"""

check_addition = """Expected today: tm-platform 6 packages green; tm-tools 68/68; tm-studio 83/83
plus 41 gateway tests; tm-hub 268/268.

A green typecheck says nothing about the wiring above — the failing modes are a
403 from Vite's allow list, a class string missing from the CSS, and an element
rendered as a tag name. Check them in a signed-in browser on a page that shows a
pill:

```js
document.querySelectorAll('ubadge').length   // must be 0
// the pill itself must be a span[data-slot="base"] carrying bg-success/10 or
// bg-warning/10, not an empty custom element
```

`app._context.components` containing `UBadge` and `UIcon` proves step 3 landed;
only the DOM proves the pill drew.
"""

for old, new in [(anchor, addition), (check_anchor, check_addition)]:
    o = old.replace('\n', nl)
    a = new.replace('\n', nl)
    assert s.count(o) == 1, (old[:50], s.count(o))
    s = s.replace(o, a)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('upgrade.md patched')
