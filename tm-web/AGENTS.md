# Web agent guidance

Read the [monorepo rules](../AGENTS.md), [canonical docs](../docs/v2/README.md), [data/API policy](../docs/v2/04-data-and-api.md) and [storefront requirements](../docs/v2/06-ui-and-storefront.md) first.

- This host is Nuxt 4 SSR (`ssr: true`) with Nitro public/portal APIs. Essential content and metadata must render server-side.
- Keep pages/layouts in Web/domain/customer layers, not host `app/pages` or `app/layouts`. The registry selects customer-first composition; customer websites may override presentation fully.
- Read business content/config/catalog from local MongoDB services. Existing Hub public content/config readers are transitional, not the desired architecture.
- Public reads require published/site-scoped positive projections. Private portal actions require Hub identity plus business-resource ownership; the current CMS BFF does not automatically provide Web auth.
- Never expose Mongo credentials, supplier costs, drafts or personal data. Server-side checkout must recompute prices, stock, taxes and shipping; browser totals are untrusted.
- Use typed resolver discriminators, real 404/410 responses and explicit legacy redirects. Follow current vi/en URL behavior until a reviewed migration changes it.
- Public cache keys include customer/site/locale/query dimensions. Auth, portal, cart, checkout, mutations and sensitive errors must not be publicly cached.
- PWA is separate from SSR/cache delivery. Verify fresh browser installation/control, offline/online recovery and update behavior; never cache private/API data.
- Use WebBasePage and Nuxt UI 4 where appropriate, preserve loading/empty/error states, responsive accessibility and both locales.
- Follow root alias/import boundaries and verification gates. Do not claim UI/SEO/PWA success from build output alone.
