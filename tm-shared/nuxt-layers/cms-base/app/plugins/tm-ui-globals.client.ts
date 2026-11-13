// `@tuanmjnh/tm-ui` ships precompiled components (dist/*.js) that resolve their
// UI primitives with `resolveComponent(...)`. Nuxt only injects auto-imports into
// files it compiles itself, so for that package every lookup falls through to
// the app's global registry. Without these registrations the components render
// their primitives as bare tags (`<ubadge>`, `<uselectmenu>`): empty pills and a
// model picker with no controls, no console error, green build.
//
// The list is the union of `resolveComponent("…")` in the package's dist; after
// upgrading the package, re-run:
//   grep -o 'resolveComponent("[A-Za-z]*")' node_modules/@tuanmjnh/tm-ui/dist/*.js | sort -u
import {
  UBadge,
  UButton,
  UIcon,
  UPopover,
  USelectMenu,
  UTooltip,
} from '#components'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.component('UBadge', UBadge)
  nuxtApp.vueApp.component('UButton', UButton)
  nuxtApp.vueApp.component('UIcon', UIcon)
  nuxtApp.vueApp.component('UPopover', UPopover)
  nuxtApp.vueApp.component('USelectMenu', USelectMenu)
  nuxtApp.vueApp.component('UTooltip', UTooltip)
})
