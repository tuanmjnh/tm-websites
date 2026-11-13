# 06 — UI, storefront and delivery behavior

## Nuxt UI 4 baseline

Use Vue 3, Nuxt UI 4, Tailwind CSS 4 and the existing [design-system package](../../tm-shared/packages/design-system). Do not add another primitive library or duplicate buttons/forms/modals. Centralize theme tokens; customer layers supply brand values, not scattered module-level color/radius/shadow overrides.

Global component themes use `slots`, `variants`, `compoundVariants`, `defaultVariants`. Per-instance `:ui` accepts only actual slot keys for that component/version. Use `class` for one-off root layout. Validate against the installed component types rather than old Nuxt UI 2/3 examples.

Project interaction rules:

- Primary ordinary actions: `variant="soft"`; secondary cancel/close/icon actions: `ghost`; secondary bulk destructive actions: `subtle`. A deliberate design exception must be explicit.
- Real forms use `UForm` + Zod + matching `UFormField name`. `required` only marks the label; it does not replace schema validation.
- Make translated schemas reactive; all user-facing copy and validation messages exist in both vi/en.
- Inputs/selects/textareas use `w-full`; selects use `items`, explicit value binding, localized placeholders and search/empty states.
- Modals render content in `#body` or `#content`, not the trigger/default slot. Use valid `content` styling for width, not invented `ui.width`.
- Show action loading, prevent reentrant mutations and disable dependent fields during execution. Preserve input on recoverable failure.
- Use existing GridList patterns where suitable, stable item keys, cursor pagination, selection and accessible row actions. Do not replace a large dataset with an unbounded in-memory list.

## Layout and accessibility

Use the existing `CmsBasePage` and `WebBasePage` where they fit the app. Nested settings pages must not create duplicate dashboard panels/headers. Desktop page actions belong in the header; mobile actions may use a safe-area-aware bottom dock, separate from global navigation/footer. Avoid rendering duplicate focusable action sets.

Test narrow/mobile and desktop layouts in a browser. Cover keyboard navigation, visible focus, modal focus return, labels/errors, contrast, touch targets, reduced motion, long translated text, empty and large lists. Do not claim mobile support from CSS inspection alone.

Each data-driven page must support loading, empty, error, forbidden, unavailable-backend and success states. A disconnected domain displays an honest unavailable state, not sample business data or a fake successful mutation.

## SSR and public content

Essential content, title, canonical metadata and navigation must exist in the server-rendered response. Use SSR-safe data fetching and request-isolated state. Do not lazy-load critical SEO content behind a client-only request.

A typed resolver must map products, posts, pages, categories and tags to consistent discriminators. Legacy names such as `item` versus `product` need an explicit mapping; do not copy mismatched resolver/render maps. Define slug collision priority, redirects, locale behavior and deletion status in tests. Unknown routes must produce actual 404 responses, not HTTP 200 with a not-found message.

Sanitize rich content at a trusted boundary; allowlist embed sources and URL schemes. Public DTOs must never expose private costs, supplier pricing, customer data, draft records or internal notes.

## Locale and SEO policy

The current hosts use vi/en with `strategy: 'no_prefix'`. Preserve that observed behavior until a reviewed URL migration is approved. Define how locale is selected, how public responses/cache keys vary, and how alternate-language URLs are discoverable. Do not emit fictional hreflang URLs when there are no distinct language URLs.

Test canonical/OG/structured data against actual public records and site domain. Sitemap includes only published eligible URLs; preview deployments are noindex. Preserve legacy URLs with tested redirects where routes change. Do not include authenticated portal pages or internal API URLs in sitemap.

## Cache and invalidation

Cache keys must include every response-varying dimension: trusted customer/database, site, locale, route and normalized query. Never cache private authenticated responses, auth endpoints, carts, checkout, provider callbacks or mutations as public reads. Errors need deliberate no-store behavior.

The current secret-gated purge is not signed, replay-protected or durable, and broad Nitro handler deletion is not tenant-targeted invalidation. Target publication flow: commit the business change, record a durable invalidation event, deliver a bounded signed request with timestamp/replay controls, invalidate relevant tags/keys and record outcome/retry. Validate Nitro cache and CDN/provider invalidation separately; local cache removal does not prove CDN invalidation.

Do not add POST checkout/forms under a blanket public caching rule without tightening route policy first. Avoid relying solely on fire-and-forget hooks copied from legacy CMS.

## PWA

Current Web uses injectManifest and a custom worker; CMS has manifest assets but no equivalent verified offline worker. These are separate deliverables.

**Status 2026-11-12 — Web side verified, CMS side still open.** The acceptance list below was executed against a production build served on `:4016`: install, activated/control, cached-URL inspection (86 precache entries, all static assets, plus `offline.html` in its own cache), offline navigation on a listing and a deep product URL, online recovery, a second build updating the precache (twice, once with the browser closed between builds), and API/private behaviour (offline API requests reject instead of being answered by the shell, and no `/api/*` or SSR document is ever cached). Evidence and exact fingerprints: [08 — operations and verification](08-operations-and-verification.md#web-10-the-offline-shell-on-a-production-build-2026-11-12). Still missing: install-to-home-screen UI, a check that a build cannot ship another customer's assets, and the CMS worker.

Requirements: per-customer name/icons/theme, correct manifest scope, offline fallback distinct from SSR home, no private/API/auth caching, safe update lifecycle, no stale Nuxt build metadata pinning, controlled cache cleanup and customer isolation. An offline fallback must not turn navigated API/auth URLs into misleading successful HTML.

Acceptance requires a production-style local build in a fresh browser context: install, activated/control, inspect cached URLs, offline navigation, online recovery, second-build update and logout/private-route behavior. Verify worker/manifest headers from the actual served output. Build success alone is insufficient; development intentionally disables the worker.

## Framework references

- [Nuxt UI Form](https://ui.nuxt.com/docs/components/form)
- [Nuxt UI theme](https://ui.nuxt.com/docs/getting-started/theme)
- [Nuxt rendering](https://nuxt.com/docs/4.x/guide/concepts/rendering)

Context7 Nuxt UI v4.12.0 confirmed the form and theme conventions. Project-specific soft-button and layout rules are local standards, not framework defaults.
