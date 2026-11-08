# TM Web — Full Project Architecture & Implementation Blueprint

> **Project:** `tm-web`
> **Application:** Nuxt 4 SSR / Hybrid Rendering + Nitro Website API
> **Purpose:** Public-facing customer website focused on SEO, performance, content presentation and customer experience.
> **Customer model:** One tenant owns an isolated database. Its `tm-cms` and `tm-web` may share that tenant database, but they have independent APIs and query implementations.
> **Identity:** Public visitor does not need a TM Hub account. The Website server uses a tenant/site-scoped server credential/context for authorized public data access. Optional customer portal authentication is a separate feature.
> **Customization:** High. A customer may use the default storefront starter or build a fully custom design while inheriting only Core, API Base, Config Base and Web Base Layers.
> **UI direction:** Customer-specific; shared design tokens are optional. Default starter supports Linear Flat Glassmorphism & Bento UI, compact radius, Aurora Mesh Gradients, glowing 3D orbs, isometric grid perspective and refractive glass lighting.
> **Status:** Target implementation specification. AI agent must audit actual source/API contracts before modifying code.

---

## 0. Instructions and non-negotiable decisions

Use this document with:

- `TM-Shared-Packages-Architecture.md`
- `TM-CMS-Project-Blueprint.md`
- `TM-Hub-Tenant-Installations-Upgrade-Addendum.md`
- Existing reference `nuxt4-website.md` (frozen reference; do not modify)
- Existing reference `nuxt4-cms.md` (frozen reference; do not modify)

### 0.1. Decisions

1. `tm-web` is an independent Nuxt 4 project/repository from `tm-cms`.
2. Default rendering is SSR/Universal Rendering (`ssr: true`, Nuxt default). Hybrid route rules can opt routes into ISR, prerender or client rendering only when justified.
3. Use `nuxt build` for server-capable Vercel deployment. Do not use static `nuxt generate` when the app requires Nitro server APIs or per-request SSR.
4. Website has its own public API routes and its own website-oriented read services/repositories. Do not import CMS API services or admin query implementation.
5. The same customer database can be used by CMS and Web, but each customer has an isolated database from other customers.
6. Website server uses read-optimized queries and public DTO projections. It must not expose MongoDB credentials or connect from the browser.
7. Public APIs only return published/allowed site data. Every query resolves trusted tenant + site context from deployment configuration and/or verified host mapping.
8. Public visitor does not need a TM Hub account. Website server-to-server authentication/service credentials are not public browser credentials.
9. Customer can deploy `tm-cms` without `tm-web`. `tm-web` can be deployed independently when customer has website package.
10. Every `tm-web` deployment has customer/site brand config. A tenant may have multiple sites, each with its own `siteId`, domains, SEO, menu, theme and publication mapping.
11. Website can be heavily customized. Minimal customer website should extend only Core, API Base, Config Base and Web Base. Storefront Starter is optional.
12. Web Base Layer must not force header/footer/homepage/product-detail visual templates.
13. `WebBasePage` is available as a reusable page composition primitive, but custom pages can use another page implementation or override it.
14. Website CSS/theme is centrally governed for the selected design system. A fully custom customer site may supply its own coherent design system without inheriting CMS admin styles.
15. Desktop page-level actions belong in the page header/top region. Mobile primary page actions may move to a bottom action footer/dock; this dock is distinct from the public content footer and global mobile navigation.
16. Public SEO-critical content must be server-rendered or prerendered. Do not hide product/article content behind client-only fetch.
17. Cache keys and data access must include tenant/site/locale and relevant query dimensions. Never share cached customer content between tenants/sites.
18. Cache invalidation from CMS is server-to-server, signed, scoped and replay-protected.
19. Website public writes (contact/newsletter/quotation/checkout) are narrow commands only; no generic write access to master catalog/HR/Finance.
20. Use small, composable, reusable components grouped by domain. Apply Nuxt `Lazy` component prefix selectively to heavy/conditional components.
21. Do not modify frozen legacy projects directly. Migrate verified behavior into the new project.

### 0.2. Terms

- `tenantId`: customer that owns the data.
- `appId`: TM Hub app installation for this specific Website deployment.
- `appKind`: `web`.
- `siteId`: a website/channel in the tenant.
- `host`: incoming request hostname; map only through trusted allowed-domain config.
- `Public DTO`: explicitly projected and validated safe data for anonymous users.
- `SiteProduct`: optional mapping of a master product to an individual site.

Never treat `tenantId`, `appId`, `siteId` and `host` as values the browser can freely select.

---

# 1. Product scope and deployment model

## 1.1. Main purpose

`tm-web` is the public-facing website engine. It may render:

- Company/homepage and landing pages.
- Product catalog, category listing and product details.
- Blog/news and editorial formats.
- Static/dynamic pages.
- Search, tags and discovery.
- Contact forms and newsletter.
- Optional product inquiry, quotation request, cart and checkout.
- Optional customer/member portal (separate authentication boundary).
- SEO, structured data, sitemap, robots, Open Graph and canonical/hreflang.
- Optional public AI assistant constrained to public data.

A customer may have a single public website, multiple websites or no website at all.

## 1.2. Website customization levels

| Level | Implementation | Use when |
|---|---|---|
| Starter website | Extends Web Base + optional Storefront Starter | Normal catalog/content website |
| Branded website | Uses starter and brand/site theme config overrides | Same structure, different identity |
| Customized website | Extends Web Base and overrides selected pages/layout/components | Customer needs different UX |
| Fully custom website | Extends only Core/API/Config/Web Base, builds all UI independently | Distinct visual product/complex custom experience |

Do not require a custom website to inherit the default storefront UI.

## 1.3. Customer app combinations

| Customer | CMS | Web | Behavior |
|---|---:|---:|---|
| A | Yes | Yes | CMS manages tenant data; Web renders published public data |
| B | Yes | No | No Web deployment or public routes needed |
| C | Yes | Yes | Fully custom website UI |
| D | Yes | Multiple | Same tenant product master; site-specific publishing/SEO/layout |

## 1.4. Deployment example

```text
admin.customer-a.vn -> tm-cms SPA + CMS API
www.customer-a.vn   -> tm-web SSR + Website API
TM Hub              -> Central IAM / app installation / configuration services
Customer A DB       -> Shared data source for CMS A + Web A
Customer B DB       -> Separate data source for Customer B
```

CMS and Web may be separate Vercel Projects, repositories and deployment pipelines. No shared build artifact or runtime process is required.

---

# 2. Technology baseline

Preserve the versions pinned by the new project's lockfile; do not upgrade all modules during migration.

- Nuxt 4.x, Vue 3, TypeScript.
- SSR enabled by default; use routeRules for hybrid behavior.
- Nitro server API and server middleware where needed.
- `@nuxt/ui` v4 + Tailwind CSS v4 if the site uses the shared TM design system.
- `@nuxtjs/i18n` with locale strategy configured per site.
- `@nuxt/image` for optimized responsive images.
- `@nuxtjs/sitemap`, `@nuxtjs/robots`, OG image module as verified in the selected versions.
- `@nuxt/content` only for content managed as local repo markdown; database CMS content must continue to use Website API/data services.
- Mongoose 9.x only in server runtime if direct tenant DB access is the chosen architecture.
- `@vite-pwa/nuxt` optional per site; public PWA cache must not store sensitive account data.
- `motion-v` or CSS transitions only where they improve UX and respect reduced motion.
- Turnstile or another approved bot protection for public forms/checkout.
- `tm-hub-client` only for server-side Hub interactions that are actually required by site runtime.

## 2.1. Rendering policy

- Default `ssr: true`.
- Public product/category/article/page routes render data on server.
- Use ISR/route cache per resource class where supported by deployment target.
- Use `ssr: false` only for explicitly interactive subroutes/widgets that do not contain SEO-critical content.
- Use prerender for stable static routes only when build-time content freshness is acceptable.
- Never assume all route paths should have one identical TTL.

---

# 3. Nuxt Layers strategy — minimal Web Base with optional UI

## 3.1. Required layers

| Layer | Responsibility | tm-web |
|---|---|---:|
| `@tm/nuxt-layer-core` | Base Nuxt conventions, shared runtime helpers, error/request foundations | Required |
| `@tm/nuxt-layer-api-base` | API error/validation/security helpers; no CMS or Web business endpoints | Required |
| `@tm/nuxt-layer-config-base` | Validated tenant/site/brand config, public projection, runtime config mapping | Required |
| `@tm/nuxt-layer-web-base` | Site context, SEO helpers, public fetch conventions, cache/revalidation utilities, error/redirect helpers | Required |
| `@tm/nuxt-layer-storefront-starter` | Default header/footer, homepage/product/category/post templates and starter components | Optional |
| `@tm/nuxt-layer-cms-base` | Admin shell/components | **Forbidden by default** |

## 3.2. Minimal Web composition

```ts
export default defineNuxtConfig({
  extends: [
    '@tm/nuxt-layer-web-base',
    '@tm/nuxt-layer-config-base',
    '@tm/nuxt-layer-api-base',
    '@tm/nuxt-layer-core',
  ],
  ssr: true,
  css: [
    // Include only if this site uses TM design tokens:
    '@tm/design-system/css/index.css',
  ],
})
```

The exact `extends` order and peer dependencies must be tested in the current Nuxt 4 version. App-owned files should override base layer behavior according to documented Nuxt priority rules.

## 3.3. Default starter composition

A standard customer site may add:

```ts
export default defineNuxtConfig({
  extends: [
    '@tm/nuxt-layer-storefront-starter',
    '@tm/nuxt-layer-web-base',
    '@tm/nuxt-layer-config-base',
    '@tm/nuxt-layer-api-base',
    '@tm/nuxt-layer-core',
  ],
  ssr: true,
})
```

Again, confirm actual layer priority. If starter is not needed, omit it.

## 3.4. Fully custom website composition

A customer may create a separate Nuxt repo and only install:

- `@tm/nuxt-layer-core`
- `@tm/nuxt-layer-api-base`
- `@tm/nuxt-layer-config-base`
- `@tm/nuxt-layer-web-base`
- `@tm/flow-contracts`, `@tm/flow-config`, `@tm/flow-utils` as needed

The custom repo owns:

- All pages/layouts/components.
- Its own design system/CSS if not using TM design tokens.
- Its own visual page composition.
- Optional page-level BasePage implementation.
- The local website API query implementation if the app hosts its Nitro endpoints.

It inherits server-safe site context, contract validation conventions, SEO helpers and cache/security abstractions, not the starter theme.

## 3.5. Web Base extension points

Provide small typed composables/helpers:

- `useSiteContext()` / `useSiteConfig()`.
- `useSiteBootstrap()`.
- `usePublicApi()`.
- `usePageSeo()`.
- `useCanonicalUrl()`.
- `useContentLocale()`.
- `resolveSiteContext(event)` server helper.
- `resolvePublicSlug()` service interface/contract.
- `sendSiteRedirect()` helper.
- `invalidateSiteCache()` server helper.
- Optional analytics/consent adapters.

These helpers must not import customer-specific UI or CMS services.

---

# 4. Target project structure

```text
tm-web/
├── app/
│   ├── app.vue
│   ├── app.config.ts                    # Optional TM UI theme defaults
│   ├── pages/
│   │   ├── index.vue
│   │   ├── [...slug].vue                # Only if universal slug resolver is selected
│   │   ├── search.vue
│   │   ├── tag/[slug].vue
│   │   ├── cart.vue                     # Optional feature
│   │   ├── checkout.vue                 # Optional feature
│   │   └── account/                     # Optional customer portal
│   ├── layouts/
│   │   ├── default.vue
│   │   └── minimal.vue                  # Optional
│   ├── components/
│   │   ├── base/
│   │   ├── layout/
│   │   ├── page/
│   │   ├── home/
│   │   ├── product/
│   │   ├── category/
│   │   ├── content/
│   │   ├── post/
│   │   │   └── formats/
│   │   ├── search/
│   │   ├── forms/
│   │   ├── commerce/                    # Optional
│   │   ├── seo/
│   │   └── custom/
│   ├── composables/
│   │   ├── site/
│   │   ├── api/
│   │   ├── product/
│   │   ├── content/
│   │   ├── seo/
│   │   ├── locale/
│   │   └── commerce/                    # Optional
│   ├── stores/
│   │   └── cart.ts                      # Optional, browser state only
│   ├── middleware/
│   └── plugins/
├── server/
│   ├── api/
│   │   ├── v1/public/
│   │   │   ├── bootstrap.get.ts
│   │   │   ├── layout.get.ts
│   │   │   ├── resolve/[...slug].get.ts
│   │   │   ├── home.get.ts
│   │   │   ├── products/
│   │   │   ├── categories/
│   │   │   ├── posts/
│   │   │   ├── search.get.ts
│   │   │   ├── tags/
│   │   │   └── forms/
│   │   └── _internal/
│   │       ├── revalidate.post.ts
│   │       └── health.get.ts
│   ├── middleware/
│   ├── plugins/
│   ├── services/
│   │   ├── site-context.service.ts
│   │   ├── site-resolver.service.ts
│   │   ├── site-product.service.ts
│   │   ├── site-content.service.ts
│   │   ├── site-search.service.ts
│   │   ├── site-cache.service.ts
│   │   └── public-form.service.ts
│   ├── repositories/
│   │   ├── products/
│   │   ├── categories/
│   │   ├── content/
│   │   └── site-settings/
│   ├── database/
│   │   ├── connection.ts
│   │   └── models/                      # Server-only models or shared DB model package
│   ├── policies/
│   │   ├── public-data.policy.ts
│   │   └── site-access.policy.ts
│   └── utils/
├── content/                             # Optional local Markdown content only
├── public/                              # Customer/site brand assets per isolated build
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── seo/
│   ├── security/
│   └── e2e/
├── nuxt.config.ts
├── package.json
└── README.md
```

Custom website repos may have a radically different app/components layout. Keep the Web Base API/extension contract stable, not this exact folder tree as a mandatory customer theme.

---

# 5. Website context, customer and site isolation

## 5.1. Context identifiers

- `tenantId` identifies the customer owning data.
- `appId` identifies the TM Hub Web app installation.
- `siteId` identifies the public site/channel.
- `host` is resolved against a trusted allowed-domain mapping.
- `locale` is resolved using site locale strategy and URL routing.

## 5.2. Resolve trusted site context

For a per-customer deployment, environment may provide fixed context:

```env
TM_TENANT_ID=tenant_customer_a
TM_WEB_APP_ID=customer_a_web
TM_SITE_ID=main
PUBLIC_SITE_URL=https://www.customer-a.vn
```

For a multi-site deployment, implement a server-only host → site mapping based on a trusted configured domain registry. Validate the host against allowed domains. Do not use arbitrary `?tenantId=` or `?siteId=` from a visitor to select a database.

## 5.3. Request context contract

```ts
interface TrustedSiteContext {
  tenantId: string
  appId: string
  siteId: string
  primaryDomain: string
  locale: string
  allowedLocales: string[]
}
```

Construct this on server for each request. If using Nuxt request event context, do not store customer-specific context in module-level mutable variables.

## 5.4. Database boundary

Preferred default: database per tenant. CMS A and Web A point to the same tenant DB; CMS B and Web B point to another DB.

Website DB account should be read-only where feasible. For contact/newsletter/checkout writes, use an explicitly constrained write path or dedicated ingestion service/role; do not give the public Website general write permissions for Product, Finance, HR or Inventory collections.

Do not leak:

- MongoDB URI/name/credentials.
- Hub app secrets.
- AI provider keys.
- Cache invalidation secret.
- Internal config or company fields not intended for public.

---

# 6. Website API — independent read-oriented implementation

## 6.1. Principles

- Public routes under `/api/v1/public/*`.
- Website API owns its website query patterns and response shapes.
- Read only published and site-eligible data.
- Use projection queries rather than loading full admin documents.
- Zod validates query/input and output DTOs where appropriate.
- Every repository is scoped by trusted tenant/site context.
- Rate limit public endpoints based on risk/traffic.
- Never expose generic collection query/filter endpoints.
- API errors must not reveal private records or database errors.

## 6.2. Suggested endpoint groups

```text
GET  /api/v1/public/bootstrap
GET  /api/v1/public/layout
GET  /api/v1/public/home
GET  /api/v1/public/resolve/:slug

GET  /api/v1/public/products
GET  /api/v1/public/products/:slug
GET  /api/v1/public/products/related
GET  /api/v1/public/categories
GET  /api/v1/public/categories/:slug/products

GET  /api/v1/public/posts
GET  /api/v1/public/posts/:slug
GET  /api/v1/public/content/pages/:slug
GET  /api/v1/public/search
GET  /api/v1/public/tags/:slug

GET  /api/v1/public/sitemap-data
POST /api/v1/public/forms/contact
POST /api/v1/public/forms/newsletter
```

Optional commerce endpoints only when feature is enabled:

```text
POST /api/v1/public/quotation-requests
POST /api/v1/public/cart/validate
POST /api/v1/public/checkout
```

Never expose CMS admin endpoints to the public app.

## 6.3. Website API response DTOs

Public DTOs should include only required presentation fields:

- Product: id, slug, name, excerpt/description safe for public, public images, categories, attributes/specifications, display price if configured, SEO fields.
- Category: id, slug, name, description, public image, parent/breadcrumb info.
- Post: title, slug, excerpt, safe content, cover, author public profile, published date, category, tags, format and SEO.
- Site bootstrap: public company identity, public contact/social links, locale/currency, enabled public features, navigation and theme settings.

Never include cost, margin, supplier secrets, internal stock ledger, internal notes, staff/user records, payroll, payment provider credentials or admin-only fields.

## 6.4. Query design

Examples:

```text
CMS Product Admin queries:
- listForAdmin(filters, pagination, permissions)
- getForEdit(id)
- aggregateForReport(filters)

Website queries:
- listPublishedProducts(siteContext, filters)
- getPublishedProductBySlug(siteContext, slug)
- listFeaturedProducts(siteContext, limit)
- findRelatedPublicProducts(siteContext, productId)
```

The two sets intentionally differ. They may share model definitions and pure rules, but not repository implementation or admin/public projection.

## 6.5. Search

- Validate query length and filter allow-list.
- Limit page size and sort fields.
- Avoid unrestricted regex/full collection scans.
- Use appropriate MongoDB indexes or dedicated search provider when scale requires.
- Return categorized results (products/posts/pages) only if this matches UX.
- Define `noindex`/canonical policy for search result URLs to avoid crawl traps.

---

# 7. Universal slug resolver and dynamic content routing

## 7.1. Preserve the legacy capability

The frozen `nuxt4-website` reference uses one catch-all route `app/pages/[...slug].vue` and a server resolver that identifies product, category, post, page or redirect. Preserve this as a supported strategy, not a compulsory strategy for every custom site.

Supported entity types may include:

- `product`
- `product_category`
- `post`
- `post_category`
- `page`
- `page_category`
- `tag`
- `redirect`
- `not_found`

Actual legacy entity names must be adapted to the source schema.

## 7.2. Resolver pipeline

```text
Incoming URL + TrustedSiteContext
        │
        ▼
Normalize path / locale / trailing slash
        │
        ▼
Check reserved/static route policy
        │
        ▼
Website Resolver Service
  ├── product slug
  ├── product category slug
  ├── post slug
  ├── post category slug
  ├── page slug
  ├── tag/other allowed entity
  └── redirect mapping
        │
        ▼
Return typed Public Resolver DTO
        │
        ▼
Render page component/template
```

## 7.3. Route collision policy

- Static routes (`/search`, `/cart`, `/checkout`, `/tag/:slug`, localized static routes) must have defined precedence over catch-all.
- API paths are outside page resolver.
- Reserve system slugs such as `api`, `admin`, `search`, `cart`, `checkout`, `account`, `tag`, `assets`, `robots.txt`, `sitemap.xml` where applicable.
- Handle locale prefix and fallback.
- Normalize trailing slash consistently.
- Check duplicate slug by site and locale where necessary.
- Do not infer entity type from path naming alone.

## 7.4. HTTP status semantics

- Found: 200.
- Permanent slug move: 301.
- Temporary redirect: 302/307 according to method semantics.
- Not found: real 404.
- Permanently removed: 410 when the content workflow supports it.
- Do not return 200 with a “not found” body.
- Prevent redirect loops and cross-domain open redirects; target domains must be allow-listed or relative paths.

## 7.5. Rendering

`[...slug].vue` should remain a thin orchestration component:

- Resolve route and locale.
- Fetch typed public resolver DTO.
- Set SEO metadata.
- Dispatch to typed component/template.
- Handle status/redirect/not-found.

Do not place all product/article presentation logic inside the catch-all page.

---

# 8. SEO and discoverability baseline

## 8.1. Page metadata

Every indexable route must supply:

- Unique title.
- Unique meta description.
- Canonical URL.
- Open Graph title/description/image.
- Twitter card metadata where used.
- Correct document language.
- Correct robots directives.

## 8.2. Structured data

Use JSON-LD only when page content supports it:

- Organization / LocalBusiness.
- WebSite and SearchAction where relevant.
- Product and Offer only when public pricing/availability data is accurate.
- Article/BlogPosting.
- BreadcrumbList.

Do not invent review/rating/availability data. Structured data must match visible page content.

## 8.3. Sitemap and robots

- Sitemap must include canonical, published, indexable pages only.
- Split sitemap by entity type when volume warrants.
- Exclude drafts, private routes, cart/checkout/account, internal API, search filter combinations and non-canonical variants.
- `robots.txt` differs by production/preview; prevent indexing preview deployments.
- Update sitemap cache after publish/unpublish/delete/redirect.

## 8.4. Internationalization

- Site defines default locale and supported locale list.
- Use proper localized fields and fallback rules.
- Set `hreflang` only when equivalent localized resources actually exist.
- Canonical per locale must be deterministic.
- Do not render one locale's content under another locale canonical accidentally.

## 8.5. SEO validation

Tests should verify SSR HTML response includes title, description, canonical, main heading and primary content without waiting for browser JS. Test 404/301, sitemap, robots, OG and structured data.

---

# 9. Cache, ISR and invalidation

## 9.1. Cache classes

| Data/page | Direction |
|---|---|
| Homepage/landing | ISR/SWR based on editorial update frequency |
| Product detail | ISR/SWR + invalidate on product publish/update |
| Category pages | ISR/SWR + invalidate on product/category changes |
| Blog/article | ISR/SWR + invalidate on publish/update |
| Public site config/menu | Short cache or revisioned cache |
| Search | Short TTL or uncached depending on query cardinality |
| Contact/newsletter/checkout POST | Never cache |
| Cart/account/personalized pages | Private/no shared CDN cache |
| Draft/preview | Authenticated/private cache policy; never public shared cache |

For Vercel, choose supported `routeRules`/ISR behavior for the current Nuxt adapter. Do not copy old TTL examples without validating provider behavior.

## 9.2. Cache key isolation

Cache key must include the relevant dimensions:

```text
tenantId : siteId : locale : routeType : canonicalPath : normalizedQuery
```

Do not rely on path alone when one deployment serves multiple sites/domains. Cache must never cross customer boundaries.

## 9.3. CMS-to-Web invalidation

```text
CMS writes/publishes content
  → commit succeeds
  → create durable event (outbox/job where needed)
  → send signed webhook
  → Web internal revalidation endpoint verifies signature/time/event ID
  → map entity to allowed affected paths/cache tags
  → invalidate site-scoped cache
  → record result and retry failures safely
```

Requirements:

- HMAC signature or equivalent authenticated service mechanism.
- Timestamp tolerance and replay protection/event idempotency.
- Validate tenant/site/app installation.
- Derive allowed paths on server from entity mapping; do not accept arbitrary user-supplied purge path.
- Rate limit endpoint.
- Audit delivery status without logging secrets.
- Retry with bounded backoff.
- Prefer durable outbox/job when the publish event must not be lost after DB commit.
- Acknowledge only after event is verified/accepted; if invalidation is async, return an accepted job/event ID.

## 9.4. Cache invalidation scope

Examples:

- Product update: product canonical path, related category listing, homepage sections/tags, sitemap if indexability changes.
- Category update: category path, affected product pages/breadcrumbs, sitemap.
- Post publish: article, category, homepage/news blocks, tags, sitemap.
- Menu/site config: pages/layout/bootstrap cache relevant to that site.
- Delete/slug change: old URL redirect/410 and new URL cache.

Do not purge every site in a tenant unless the change truly affects all sites.

---

# 10. BasePage and public page composition

## 10.1. `WebBasePage`

Web Base Layer may expose a generic page composition primitive, but it must not force the public site's layout. It can provide:

- Main content region and semantic landmarks.
- Optional title/description/breadcrumbs.
- Optional page-level actions.
- Optional content width/density.
- Optional sticky mobile action dock.
- SEO metadata is preferably handled by composable/head logic, not a UI component requiring content layout.

Example props:

```ts
interface WebBasePageProps {
  title?: string
  description?: string
  breadcrumbs?: Array<{ label: string; to?: string }>
  contentWidth?: 'full' | 'wide' | 'normal' | 'narrow'
  mobileActions?: 'footer' | 'inline' | 'none'
}
```

Slots:

- `breadcrumbs`
- `heading`
- default content
- `pageActions`
- `mobileActions`

A custom site is free not to use this component or replace it entirely.

## 10.2. Desktop behavior

- Site header/navigation belongs to site layout.
- Page title/breadcrumb and page-specific actions appear near the top of the content region.
- Product CTA can appear in product summary/sticky desktop panel according to design.
- Do not add an admin-like persistent toolbar to the public website.

## 10.3. Mobile behavior

- Compact site navigation.
- Relevant page primary action may move to a sticky bottom action footer: Add to cart, Call, Contact, Request quote.
- Do not display action dock if current page has no meaningful action.
- Public global footer remains normal content footer; mobile action dock is separate.
- Safe-area, browser bottom bars and keyboard overlap must be tested.

## 10.4. SSR and hydration

- Avoid reading `window`, `document`, localStorage or viewport during SSR setup.
- Avoid duplicated IDs or duplicate interactive action controls.
- Prefer CSS responsive placement for same semantic control where possible.
- If conditionally mounting desktop/mobile variants, verify hydration and focus behavior.

---

# 11. Component design and Lazy loading

## 11.1. Folder strategy

```text
components/
├── base/                # Image, breadcrumb, page primitives
├── layout/              # SiteHeader, SiteFooter, Navigation, MobileMenu
├── page/                # WebBasePage, PageHeading, PageActionDock
├── home/                # Hero, featured sections, latest content
├── product/             # ProductCard, Gallery, Detail, Specification
├── category/            # CategoryHeader, CategoryGrid, Filters
├── content/             # Content renderer/prose components
├── post/
│   └── formats/         # standard/gallery/audio/video/link/quote/dynamic
├── search/              # Search result cards and list sections
├── forms/               # Contact, newsletter, inquiry
├── commerce/            # Optional cart/checkout components
├── seo/                 # Breadcrumb/structured data display helpers only
└── custom/              # Customer site-specific components
```

Custom sites may replace this entire visual organization. Web Base should only require its published helpers and contracts.

## 11.2. Component design rules

- Keep pages thin; compose reusable feature components.
- Component props must be typed and presentation-focused.
- Do not put database access or secrets in component code.
- Separate public data fetching from visual components.
- Provide loading, empty and error states for interactive sections.
- Use semantic HTML and accessible controls.
- Keep image dimensions/aspect ratio stable to prevent CLS.
- Prefer reusable product/category/post cards with configurable slots/variants where visual reuse is real.
- Do not create a single mega-component for all public content entity types.

## 11.3. Lazy components

Use `Lazy` prefix for:

- Below-the-fold recommendations.
- Heavy gallery/lightbox only opened after click.
- Video/audio players when not immediately needed.
- Dynamic content blocks with optional dependencies.
- Search overlays and large filter panels.
- Cart drawer/checkout widgets where deferred.
- AI assistant panel.

Do not lazy-load:

- Main h1/title and SEO content.
- Primary product name/price/description.
- Hero image/content if it is the LCP element.
- Main article text.
- Essential navigation.

Use actual Nuxt 4 component auto-import/lazy behavior and inspect network chunks. `Lazy` prefix is not a substitute for `v-if`/interaction gating; a rendered lazy component may still load immediately when the branch renders.

---

# 12. Central design system and visual customization

## 12.1. Default TM visual preset

When customer chooses TM preset:

- Linear Flat + Bento composition.
- Compact radii 2/4/6/8/10px.
- Aurora mesh gradients behind hero or selected backgrounds.
- Restrained glowing 3D orbs.
- Isometric grid perspective for selected visual regions.
- Refractive glass surfaces on selected floating UI/overlays.
- Strong typography, whitespace and image hierarchy.

## 12.2. Centralized CSS

- Import one `@tm/design-system/css/index.css` entry only when adopting TM Design System.
- Brand colors are variables injected from validated site config.
- No per-module CSS redefining tokens.
- CSS can be site-specific if design truly differs, but it must remain centralized in that site's design-system/theme files, not scattered across every component.

## 12.3. Custom site theme

A custom website may define:

- Typography scale.
- Colors and semantic roles.
- Spacing/radius.
- Surface/elevation.
- Motion.
- Breakpoints/container.

It may opt out of TM Glassmorphism completely. It must still preserve accessibility/performance requirements and must not modify shared packages locally.

## 12.4. Visual effects performance

- Avoid backdrop-filter on every card/product tile.
- Use effects mostly on hero, header, key Bento panels or floating panels.
- Decorative effects must not block pointer events or screen readers.
- Respect reduced-motion.
- Avoid layout changes from late fonts/images/effects.
- Test mobile GPU and low-end device performance.

---

# 13. SEO and public content workflows

## 13.1. Publish model

Only `published` content eligible for the current site/locale is publicly queryable. Draft, scheduled, archived or site-disabled records must not leak even if a visitor guesses the slug.

## 13.2. Sitemap update

When CMS publishes/unpublishes/deletes content or changes slug/canonical:

- update or invalidate sitemap data.
- maintain redirect from old slug when appropriate.
- ensure no duplicate canonical URL.
- purge relevant page and listing cache.

## 13.3. Preview

Optional editor preview must use a signed, expiring preview token and noindex/private cache headers. Preview endpoints must not become public draft leaks.

## 13.4. OG images

- Use customer/site brand assets.
- Include page title and approved metadata only.
- Keep correct image dimensions and cache version.
- Do not include internal product cost/notes or customer personal data.

---

# 14. Public forms, commerce and bot protection

## 14.1. Public write boundary

The public app may write only specific validated command types:

- Contact inquiry.
- Newsletter subscription.
- Product inquiry / quotation request.
- Optional order/checkout command.

It must not expose generic `POST /products`, `PUT /inventory`, HR, Finance or generic database mutation endpoints.

## 14.2. Validation and abuse controls

- Zod input schema with size limits and allowed fields.
- Rate limiting by IP/session/fingerprint signals where lawful and appropriate.
- Turnstile or equivalent bot protection on forms that need it.
- Server-side validation of product/price/stock; never trust total/discount/price sent by browser.
- Idempotency key for checkout or repeated submissions.
- Email/phone validation appropriate to business flow.
- Spam detection and bounded payload/file sizes.

## 14.3. Cart and checkout (optional)

- Cart may be browser state, but price/discount/availability recalculated server-side.
- Avoid storing sensitive payment details in Pinia/localStorage.
- Payment provider secret remains server-only.
- Checkout routes must not be shared cached.
- Order creation must be idempotent and auditable.
- If no e-commerce entitlement, cart/checkout pages/endpoints must be disabled.

---

# 15. Optional public AI assistant

- Website assistant is off by default unless enabled for a site.
- Public user is anonymous; never give agent access to admin modules/tools.
- Allowed data: published products, public pages, public FAQs, public policies and contact information only.
- Use server-side AI runtime/proxy; provider credentials never enter browser bundle.
- Use per-site model policy, quota, rate limits and usage metering.
- Prompt injection in public content must not grant tools or reveal secrets.
- Tools are read-only by default; inquiry submission is a narrowly scoped explicit tool with abuse controls.
- Do not let the public assistant read HR, Finance, inventory ledger, customer CRM or unpublished content.
- Verify whether TM Hub currently provides AI inference/streaming; provider connection/model management alone is not an inference API.

---

# 16. Branding and PWA

## 16.1. Site brand config

Each `siteId` can define:

- Site name and tagline.
- Primary domain and allowed domains.
- Logo light/dark and favicon.
- Theme colors / typography / design preset.
- Homepage sections and navigation references.
- Default SEO and OG images.
- Default locale and supported locales.
- Feature flags: blog, catalog, inquiry, cart, checkout, AI assistant.
- Theme overrides or custom UI flag.

## 16.2. Build-time vs runtime assets

Build-time: favicon and optional PWA icons, build metadata, any HTML shell assets requiring static inclusion.

Runtime: public site settings, menu, text labels, content, feature flags when fetched from a trusted public config endpoint.

Do not claim a runtime JSON change can replace build-embedded assets in an already-built deployment unless the asset URLs themselves are served dynamically.

## 16.3. PWA

Optional by site. Use site-specific manifest ID/name/theme/icons/cache namespace. Avoid caching private/customer-specific personalized data. If multiple sites share a deployment, PWA scope/start URL must not collide.

---

# 17. Environment and deployment

## 17.1. Environment variables

```env
NODE_ENV=production
TM_TENANT_ID=tenant_customer_a
TM_WEB_APP_ID=customer_a_web
TM_SITE_ID=main

HUB_URL=https://hub.example.com
HUB_APP_ID=customer_a_web
HUB_APP_SECRET=                  # only if needed; server-only

MONGODB_URI=mongodb+srv://...    # server-only, preferably read-only DB user
MONGODB_DATABASE=tm_customer_a

PUBLIC_SITE_URL=https://www.customer-a.vn
PUBLIC_SITE_ALLOWED_HOSTS=www.customer-a.vn,customer-a.vn

CACHE_REVALIDATION_SECRET=       # server-only

AI_RUNTIME_URL=                  # optional server-only integration
AI_RUNTIME_TOKEN=                # server-only
```

The actual deployment can use a per-customer secret reference/database binding instead of exposing full URI in source config. Never prefix private values with `NUXT_PUBLIC_`.

## 17.2. Vercel deployment

- Use `nuxt build` for SSR/ISR-capable deployment.
- Each customer site may have a separate Vercel Project for independent domain, environment, cache and secrets.
- Use Preview env with non-production data/tenant/site.
- Configure private registry read token at build time with least privilege.
- Environment variable changes apply to new deployments; redeploy after config changes.
- Verify actual Vercel/Nuxt routeRules behavior and cache invalidation on preview before production.

## 17.3. Deploy choices

| Customer site | Deployment |
|---|---|
| Standard | `tm-web` source + storefront starter + site config |
| Branded | `tm-web` source + brand/site config |
| Highly custom | Separate Nuxt project using only Web Base and Shared NPM packages |
| CMS only customer | No `tm-web` deployment |

---

# 18. Migration from frozen `nuxt4-website`

## 18.1. Legacy behavior to inventory

The reference describes:

- Nuxt 4 SSR/ISR public app.
- Universal dynamic slug resolver.
- 6 physical route files.
- 18 public endpoints.
- Product/content/site config services.
- 39 Mongoose models in Website source, mostly overlapping CMS.
- 29 Zod schemas and 28 type files.
- Product/post/page/category/redirect rendering.
- Seven post formats: standard, gallery, audio, video, link, quote, dynamic.
- Sitemap/robots/OG image, Turnstile, responsive images and cache purge.

Counts and exact implementation are hints; audit actual source.

## 18.2. Migration rules

- Do not change frozen reference repository.
- Preserve public URL behavior where SEO/link equity requires it.
- Preserve slug resolver behavior unless tests demonstrate a defect.
- Keep public API separate from CMS API.
- Use public DTOs to prevent admin data leakage.
- Keep website query service read-optimized.
- Do not migrate admin-only models/services just because they exist in legacy Website repository.
- Do not blindly duplicate all 39 models if `@tm/flow-db-models` provides tested shared persistence models.
- Preserve 301 redirects for renamed slugs.

## 18.3. Migration phases

### Phase 0 — Read-only audit

- Inspect routes, public APIs, resolver, Mongoose models, services, cache, routeRules, i18n and SEO.
- List all URL patterns and entity types.
- Inventory fields returned to public endpoints and classify sensitive fields.
- Inspect current CMS-to-Web cache purge integration.
- Inspect current DB connection/credentials and identify read/write needs.
- Produce file-level migration map. No code edits.

### Phase 1 — Minimal Nuxt Web Base consumer

- Create `tm-web` Nuxt 4 SSR project.
- Install Core/API/Config/Web Base layers.
- Verify SSR build and server APIs.
- Add trusted site context and health endpoint.
- Add basic SEO defaults and 404 handling.

### Phase 2 — Public data API foundation

- Add tenant-specific DB connection.
- Create public repository/query pattern.
- Create Public DTO projection using shared contracts.
- Add tests that ensure admin/private fields cannot leak.

### Phase 3 — Resolver and core pages

- Migrate universal slug resolver or choose explicit route strategy.
- Migrate product/category/post/page/redirect entity handlers.
- Test URL collisions, locale and correct HTTP status.

### Phase 4 — SEO and cache

- Implement metadata, canonical, hreflang, sitemap, robots, JSON-LD.
- Define route class caching policy.
- Build signed cache revalidation endpoint.
- Integrate CMS publish events/outbox when available.

### Phase 5 — Starter UI

- Build default public layout, header/footer, homepage/product/content templates.
- Build `WebBasePage` optional primitive.
- Use component folders and selective lazy components.
- Implement responsive interactions.

### Phase 6 — Customer brand and customization

- Add validated site config.
- Generate assets per site build.
- Test brand override and fully custom site example with no Storefront Starter dependency.

### Phase 7 — Optional commerce/forms/AI

- Implement only entitled features.
- Validate server-side writes, rate limit and bot protection.
- AI public assistant gets read-only public tools only.

### Phase 8 — Production validation

- SSR HTML/SEO tests, lighthouse/performance checks, tenant isolation, cache leakage, invalidation, form abuse tests, deployment smoke tests.

---

# 19. Testing matrix

## 19.1. SSR and SEO

- Initial HTTP response includes product/article main content.
- Unique title, description, canonical, OG and document language.
- Real 404/301/410 semantics.
- Sitemap excludes drafts/private/filter traps.
- robots blocks preview/private paths.
- JSON-LD matches visible content.
- Locale fallback/hreflang is correct.

## 19.2. Data isolation

- Customer A host/config reads only DB A.
- Customer B deployment reads only DB B.
- Query parameter/body cannot select another tenant/site.
- Wrong host is rejected or routed to explicit default behavior.
- Multiple sites in one tenant see only their publication mapping.
- Public DTO excludes cost, supplier, internal notes, HR and finance data.

## 19.3. Cache isolation and invalidation

- Cache key includes tenant/site/locale/path/query dimensions.
- A publish event for site A does not purge/alter site B unless intended.
- Invalid signature/replay/expired webhook is rejected.
- Arbitrary purge path is rejected.
- Retries are idempotent.
- Product slug change invalidates old/new URLs and sitemap.

## 19.4. Public API abuse

- Search query limits and page size limits.
- Form size validation/rate limit.
- Bot token validation where required.
- Checkout recomputes price and stock server-side.
- No generic mutation endpoints.
- Secrets never appear in server response/client bundle.

## 19.5. UI/performance

- Desktop and mobile navigation.
- Mobile action dock does not cover public footer/content.
- LCP image optimized and dimensions reserved.
- Heavy lazy components load on demand.
- Reduced motion supported.
- No hydration mismatch or layout shift from client-only viewport logic.
- Glass/aurora effects profiled on low-end mobile devices.

---

# 20. Definition of Done

- [ ] `tm-web` is independent from CMS.
- [ ] Nuxt 4 SSR is enabled by default.
- [ ] Server API runs on selected deployment target.
- [ ] Web Base is minimal and UI-agnostic.
- [ ] Storefront Starter is optional.
- [ ] Custom website can build with only Core/API/Config/Web Base.
- [ ] Website API/query/services are independent from CMS.
- [ ] Database access is tenant/site scoped and server-only.
- [ ] Public DTOs do not expose private fields.
- [ ] Universal slug resolver or explicit routing has comprehensive tests.
- [ ] SEO baseline passes SSR tests.
- [ ] Cache policy and invalidation are tenant/site scoped.
- [ ] Public forms/writes are narrowly constrained.
- [ ] `WebBasePage` is available and responsive but not mandatory for custom UI.
- [ ] Component organization and selective Lazy imports are applied.
- [ ] Customer branding/site config is validated and isolated.
- [ ] Public AI, if enabled, uses server-only provider and read-only public scope.
- [ ] Build/deploy smoke tests pass and are recorded.

---

# 21. Required AI coding agent workflow

1. Read this file and linked Shared Packages/CMS/Hub documents.
2. Inspect actual `nuxt4-website` source and CMS contracts before editing; frozen reference is read-only.
3. Start Phase 0 as read-only; produce a route/API/model/SEO/cache inventory.
4. Do not ask the user to restate decisions captured in this document. For non-blocking ambiguity, use stated defaults and record assumptions.
5. If legacy behavior conflicts with target, report the difference and propose the lowest-risk compatibility path.
6. Never copy CMS services into Web; Web must own public projections and queries.
7. Never expose raw Mongo documents or credentials.
8. Build a minimal custom-site fixture to prove that Web Base does not require Storefront Starter UI.
9. Implement phase-by-phase; no unrelated refactors.
10. After each phase report files, APIs, schema, DB/cache/security changes, commands/tests actually run, risks and rollback.
11. Do not claim SEO, Vercel ISR, cache purge or build is working until tested in the target runtime.

## 22. External technical references

- Nuxt Layers: https://nuxt.com/docs/4.x/getting-started/layers
- Nuxt rendering concepts: https://nuxt.com/docs/4.x/guide/concepts/rendering
- Nuxt runtime config: https://nuxt.com/docs/4.x/api/composables/use-runtime-config
- Nuxt Vercel deployment: https://vercel.com/docs/frameworks/full-stack/nuxt
- Nuxt UI v4 theming: https://ui.nuxt.com/docs/getting-started/theme
- Nuxt SEO: https://nuxt.com/modules/seo
- Nuxt Sitemap: https://nuxtseo.com/docs/sitemap/getting-started/installation
