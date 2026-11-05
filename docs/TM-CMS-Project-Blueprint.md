# TM CMS — Full Project Architecture & Implementation Blueprint

> **Project:** `tm-cms`
> **Application:** Nuxt 4 SPA + Nitro API (when deployed as server application)
> **Purpose:** Customer-specific administration, CMS and business operations platform.
> **Customer model:** One customer/tenant owns one isolated business database. A customer may deploy CMS only or pair it with one or more `tm-web` sites.
> **Identity:** Authenticate through TM Hub. User permissions and membership are scoped to the customer's CMS app installation/tenant context.
> **UI:** Linear Flat Glassmorphism & Bento UI, compact radius, centralized design tokens, controlled Aurora / Glass / 3D background effects.
> **Package dependencies:** Private `@tm/*` NPM packages and published Nuxt Layers.
> **Status:** Target implementation specification. AI agent must audit actual source/API contracts before modifying code.

---

## 0. Instructions and non-negotiable decisions

This document defines the target `tm-cms` application. It is designed to be used with:

- `TM-Shared-Packages-Architecture.md`
- `TM-Hub-Tenant-Installations-Upgrade-Addendum.md`
- Existing reference `nuxt4-cms.md` (frozen reference; do not modify)
- Existing reference `TM-CMS-TM-Web-Architecture-v2.2.md`

### 0.1. Decisions

1. `tm-cms` is a standalone Nuxt 4 project, not a website subfolder or route inside `tm-web`.
2. Rendering mode is SPA: `ssr: false`.
3. Keep Nitro server/API routes when deployed through `nuxt build` to a server-capable target. SPA rendering does not mean the CMS API disappears. Do not use `nuxt generate` if this deployment expects Nuxt/Nitro server APIs in the same project.
4. CMS owns admin-oriented APIs, write workflows, validations, admin query services, reports and business operations.
5. TM Hub owns authentication identity, application installation context, tenant membership, roles, permissions and central services. CMS must not maintain a second local user/role/session authority.
6. Customer A CMS has its own `TM_TENANT_ID`, `TM_CMS_APP_ID` and database configuration. Customer B uses different IDs and a separate database.
7. A customer's CMS database is shared with that customer's `tm-web` only; it is not shared across different customers.
8. CMS and Website API implementations remain independent even if they use the same customer database and persistence model.
9. Shared NPM packages provide contracts, types, Zod schemas, config parsers, utilities, pure domain rules and optional server-only DB models. They do not provide one universal Product API.
10. CMS must work without `tm-web`. HR-only, Finance-only, Inventory-only customers are valid deployments.
11. Modules are configurable/entitled. Hiding menu items is UX only; every API enforces permission and module entitlement on the server.
12. Every page follows `CmsBasePage` unless a documented specialist layout requires otherwise.
13. Desktop page actions are in the page header; mobile page actions move to a bottom action footer/dock. Global mobile navigation is a separate region.
14. UI styles come from `@tm/design-system` and centralized app theme configuration. No scattered module-specific token definitions.
15. Build/release must be reproducible per customer. No shared mutable public folder or output directory between parallel customer builds.
16. Use component prefixes/folders and `Lazy` component imports selectively. Do not lazy-load above-the-fold critical UI without reason.
17. Do not rewrite all legacy functionality in one phase. Audit, migrate, test and preserve data compatibility.

### 0.2. Terms

- `tenantId`: customer/organization data owner.
- `appId`: TM Hub identifier for this concrete CMS app installation (unique per customer CMS deployment).
- `appKind`: `cms` for this installation.
- `siteId`: optional public website/channel identifier. CMS-only customers may not have one.
- `userId`: identity managed by TM Hub.
- `app membership`: user's membership/access for the current CMS app installation.
- `module entitlement`: subscription/configuration level enabling a module for the customer.
- `permission`: authorization capability such as `products.read` or `finance.transactions.approve`.

Do not treat `appId`, `tenantId`, `siteId` and `userId` as interchangeable.

---

# 1. Product scope

## 1.1. Main purpose

`tm-cms` is a customer-specific admin application used to manage data and operations. Depending on the customer's subscription and needs it can expose:

- Product and Catalog Management.
- Content Management.
- Commerce and Sales.
- Customers and Suppliers.
- Inventory and Warehouse.
- Purchase Orders.
- Finance and Payments.
- Human Resources.
- Reports and Analytics.
- Media Library.
- Import / Export.
- Notifications.
- System and Company Settings.
- AI Workspace and AI-assisted workflows (controlled rollout).

The application must not assume every customer uses every module. CMS-only deployments for HR, Finance or Inventory are first-class scenarios.

## 1.2. Out of scope

- Public SEO website presentation (belongs to `tm-web`).
- Public product catalog rendering.
- Website-specific product listing/detail design.
- Central user identity storage or authentication authority (TM Hub owns it).
- Provider API keys in browser storage.
- Direct browser-to-MongoDB access.
- One cross-customer shared database unless a separate architecture decision explicitly introduces it.

## 1.3. Deployment scenarios

| Scenario | CMS | Website | Database |
|---|---:|---:|---|
| HR / payroll only | Yes | No | Customer-specific DB |
| Inventory / warehouse | Yes | No | Customer-specific DB |
| Finance / operations | Yes | No | Customer-specific DB |
| Product management and public site | Yes | Yes | Same customer DB, different API/query layers |
| Multi-site catalog | Yes | One or more `tm-web` deployments | Same tenant DB; site-specific publishing/config |

---

# 2. Technology and architecture

## 2.1. Baseline technology

Preserve current versions and choose upgrades only after checking installed package manifests and compatibility:

- Nuxt 4.x, Vue 3, TypeScript.
- `ssr: false` for the CMS UI.
- Nitro server routes for CMS API if deployed together.
- `@nuxt/ui` v4 + Tailwind CSS v4, unless source audit identifies a deliberate replacement.
- Pinia only for client state with clear ownership; avoid duplicating remote API cache unnecessarily.
- Zod 4 (or the version locked by `@tm/flow-contracts`).
- `@nuxtjs/i18n` (Vietnamese and English baseline; add locales per customer requirements).
- Mongoose 9.x for MongoDB if confirmed by existing source.
- `@vite-pwa/nuxt` optional per customer.
- TipTap v3 / TinyMCE only where existing editing workflow needs it; avoid loading both in every route.
- Chart library already validated by source (for example Unovis) where useful.
- Cloudinary via TM Hub Media Gateway or approved server integration; no Cloudinary secret in browser.
- `tm-hub-client` as official TM Hub SDK, using actual published package name/version.

Do not bump all dependencies during the architecture migration. Lock versions and upgrade separately with tests.

## 2.2. Application boundary

```text
Browser
  │
  ▼
tm-cms SPA
  ├── CMS Pages / Components / Stores
  └── CMS API calls
          │
          ▼
     CMS Nitro API (server)
       ├── Auth / Tenant / App Context guard
       ├── Permission + Module Entitlement checks
       ├── CMS Services / Use Cases
       ├── CMS Repositories / Admin Queries
       ├── TM Hub Client (server-side integration)
       └── Customer MongoDB
```

CMS APIs and CMS UI are deployed as one Nuxt app initially for operational simplicity. If backend scaling/hosting requirements later justify a separate backend deployment, retain contracts and boundaries and move the API without changing business contracts.

## 2.3. Repository and package policy

- `tm-cms` is an independent repository.
- Install shared packages from private registry.
- Use `@tm/nuxt-layer-core`, `@tm/nuxt-layer-api-base`, `@tm/nuxt-layer-config-base`, `@tm/nuxt-layer-cms-base` and optional module layers.
- Keep customer-specific build config/assets outside published generic packages.
- Pin package versions in lockfile; no production `file:` dependencies.

---

# 3. Nuxt Layers composition

## 3.1. Required layers

| Layer | Responsibilities | CMS uses |
|---|---|---:|
| `@tm/nuxt-layer-core` | Nuxt defaults, app foundations, error conventions, base plugins, shared utility integration | Required |
| `@tm/nuxt-layer-api-base` | API validation/error/request/security helpers; no business endpoints | Required |
| `@tm/nuxt-layer-config-base` | Validated customer/brand/module config; runtime config mapping | Required |
| `@tm/nuxt-layer-cms-base` | Admin shell, navigation shell, `CmsBasePage`, responsive page action layout | Required |
| `@tm/nuxt-layer-cms-modules` | Optional reusable feature UI; may be split by module later | Optional |
| domain-specific module layer | Optional product/content/commerce/inventory/finance/hr pages/components | By entitlement/build selection |

## 3.2. Expected composition

Illustrative only; package import names and Nuxt resolution must be verified with an actual layer playground/build:

```ts
export default defineNuxtConfig({
  extends: [
    '@tm/nuxt-layer-cms-modules',
    '@tm/nuxt-layer-cms-base',
    '@tm/nuxt-layer-config-base',
    '@tm/nuxt-layer-api-base',
    '@tm/nuxt-layer-core',
  ],
  ssr: false,
  css: ['@tm/design-system/css/index.css'],
})
```

Layer order/override precedence must be proven in a test app. Do not assume the snippet works without checking peer dependencies, module registration and CSS build.

## 3.3. CMS source owns

- `app/pages/**` for CMS routes.
- CMS business module components where the component is not generic.
- CMS-specific Pinia stores.
- CMS composables for admin workflows.
- CMS Nitro API endpoints.
- CMS service/use-case layer.
- CMS repositories and admin query implementation.
- CMS-specific tests, seeds and migrations.

The shared layers must not become a hidden second application. Customer-specific UI can override layout/components with documented extension points.

---

# 4. Target project structure

```text
tm-cms/
├── app/
│   ├── app.vue
│   ├── app.config.ts
│   ├── spa-loading-template.html
│   ├── assets/                    # Only app-specific assets; global tokens from package
│   ├── pages/
│   │   ├── index.vue
│   │   ├── login.vue              # Or layer-provided auth route, per auth flow
│   │   ├── products/
│   │   ├── content/
│   │   ├── commerce/
│   │   ├── inventory/
│   │   ├── finance/
│   │   ├── hr/
│   │   ├── customers/
│   │   ├── suppliers/
│   │   ├── reports/
│   │   ├── media/
│   │   ├── notifications/
│   │   └── settings/
│   ├── components/
│   │   ├── base/
│   │   ├── layout/
│   │   ├── page/
│   │   ├── data-display/
│   │   ├── forms/
│   │   ├── inputs/
│   │   ├── overlays/
│   │   ├── feedback/
│   │   ├── charts/
│   │   ├── editor/
│   │   ├── media/
│   │   └── modules/
│   │       ├── products/
│   │       ├── content/
│   │       ├── commerce/
│   │       ├── inventory/
│   │       ├── finance/
│   │       ├── hr/
│   │       ├── customers/
│   │       └── suppliers/
│   ├── composables/
│   │   ├── auth/
│   │   ├── api/
│   │   ├── products/
│   │   ├── content/
│   │   ├── commerce/
│   │   ├── inventory/
│   │   ├── finance/
│   │   ├── hr/
│   │   ├── media/
│   │   ├── reports/
│   │   └── ui/
│   ├── layouts/
│   ├── middleware/
│   ├── plugins/
│   └── stores/
├── server/
│   ├── api/
│   │   ├── auth/                  # CMS BFF auth routes if required by Hub flow
│   │   └── v1/admin/
│   │       ├── products/
│   │       ├── categories/
│   │       ├── content/
│   │       ├── commerce/
│   │       ├── inventory/
│   │       ├── finance/
│   │       ├── hr/
│   │       ├── customers/
│   │       ├── suppliers/
│   │       ├── reports/
│   │       ├── media/
│   │       ├── import/
│   │       └── system/
│   ├── middleware/
│   ├── plugins/
│   ├── repositories/
│   │   ├── products/
│   │   ├── content/
│   │   ├── inventory/
│   │   ├── finance/
│   │   └── hr/
│   ├── services/
│   │   ├── products/
│   │   ├── content/
│   │   ├── commerce/
│   │   ├── inventory/
│   │   ├── finance/
│   │   ├── hr/
│   │   ├── reports/
│   │   └── ai/
│   ├── policies/
│   ├── utils/
│   └── database/
│       ├── connection.ts
│       ├── models/                # Local models or @tm/flow-db-models registration
│       ├── migrations/
│       └── seeds/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── security/
│   └── e2e/
├── public/                        # Customer brand assets injected during build
├── nuxt.config.ts
├── package.json
├── pnpm-lock.yaml
└── README.md
```

Folder grouping is a target convention. During migration, preserve existing structure temporarily if moving files all at once creates risk; gradually converge on this layout.

---

# 5. Central Design System and CSS governance

## 5.1. Visual direction

**Linear Flat Glassmorphism & Bento UI**:

- Linear: clean, dense, crisp, low-noise admin interface.
- Bento: grouped KPI cards, status panels and dashboards; do not turn every form/table row into a card.
- Glass: subtle translucent surfaces, thin border, soft refraction/highlight.
- Aurora mesh gradients: ambient background in app shell, login/overview/selected regions.
- Glowing 3D orbs: restrained ambient accents, not behind dense content.
- Isometric grid perspective: optional decorative background on dashboard/login/empty states.
- Compact border radius: 2/4/6/8/10px tokens. Avoid ubiquitous pill/large round corners.

Readable content, contrast, keyboard interaction and low visual noise take priority over effects.

## 5.2. One CSS source of truth

- `@tm/design-system/css/index.css` is imported once at app level.
- Package may split internal CSS by token group/effect, but consumers import one entrypoint.
- `app.config.ts` centrally configures Nuxt UI component variants and semantic colors.
- Components use semantic tokens and approved variants.
- Do not create module CSS files just to redefine colors, radius, shadows, glass surfaces or background.
- Scoped CSS is allowed for unique component geometry/animation but must use shared tokens.

## 5.3. Token contract

Minimum variables:

```css
:root {
  --tm-brand-primary: #10b981;
  --tm-brand-secondary: #0f766e;
  --tm-brand-accent: #22d3ee;

  --tm-radius-xs: 2px;
  --tm-radius-sm: 4px;
  --tm-radius-md: 6px;
  --tm-radius-lg: 8px;
  --tm-radius-xl: 10px;

  --tm-surface-app: #f5f8f7;
  --tm-surface-panel: rgb(255 255 255 / 86%);
  --tm-text-primary: #17211f;
  --tm-border-subtle: rgb(15 23 42 / 8%);
}

[data-theme='dark'] {
  --tm-surface-app: #0a1110;
  --tm-surface-panel: rgb(15 24 22 / 80%);
  --tm-text-primary: #e8f3ef;
  --tm-border-subtle: rgb(255 255 255 / 9%);
}
```

Example tokens are defaults only. Brand values must be injected from validated customer config. Do not hardcode customer-specific values into module code.

## 5.4. Aurora / glass performance rules

- Ambient background layers use pseudo-elements or one shell effect, not per row/card.
- Decorative layers: `pointer-events: none`, `aria-hidden="true"`.
- Limit large blur layers and backdrop-filter use.
- Avoid continuously animating many elements.
- Honor `prefers-reduced-motion`.
- Provide fallback when backdrop-filter is unsupported.
- Keep contrast and focus ring visible in light/dark themes.
- Disable/reduce isometric grids and heavy orb effects on small/low-power devices if profiling shows impact.

## 5.5. Example centralized Nuxt UI config

Use actual API supported by the installed Nuxt UI v4 version:

```ts
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'emerald',
      secondary: 'teal',
      success: 'green',
      info: 'cyan',
      warning: 'amber',
      error: 'rose',
      neutral: 'slate',
    },
    // Centralize component slot/variant defaults here.
  },
})
```

Do not configure component styling independently across every module page. If customer brand hue is arbitrary, use validated CSS variables in addition to supported Nuxt UI semantic palette mapping.

---

# 6. CMS shell and BasePage

## 6.1. Layout structure

Desktop:

```text
┌───────────────────────────────────────────────────────────────┐
│ SIDEBAR │ GLOBAL TOPBAR                                        │
│         ├───────────────────────────────────────────────────────┤
│         │ PAGE HEADER: breadcrumb / title / description / CTA  │
│         ├───────────────────────────────────────────────────────┤
│         │ TOOLBAR: tabs / search / filters / view options       │
│         ├───────────────────────────────────────────────────────┤
│         │ MAIN CONTENT: table / form / bento / chart            │
│         ├───────────────────────────────────────────────────────┤
│         │ OPTIONAL FOOTER: pagination / totals / summary        │
└───────────────────────────────────────────────────────────────┘
```

Mobile:

```text
┌────────────────────────────────┐
│ COMPACT HEADER / BACK / TITLE  │
├────────────────────────────────┤
│ TOOLBAR / TABS / FILTERS       │
├────────────────────────────────┤
│                                │
│ MAIN CONTENT                   │
│                                │
├────────────────────────────────┤
│ PAGE ACTION FOOTER / DOCK      │
│ [Primary] [Secondary] [More]   │
├────────────────────────────────┤
│ GLOBAL BOTTOM NAVIGATION       │
└────────────────────────────────┘
```

The page action dock and global bottom navigation are separate. Footer pagination/summary is also a separate semantic slot.

## 6.2. `CmsBasePage` contract

Suggested props:

```ts
interface CmsBasePageProps {
  id?: string
  title: string
  description?: string
  breadcrumbs?: Array<{ label: string; to?: string }>
  loading?: boolean
  error?: unknown
  contentWidth?: 'full' | 'wide' | 'normal' | 'narrow'
  density?: 'compact' | 'comfortable'
  mobileActions?: 'footer' | 'menu' | 'none'
  stickyHeader?: boolean
}
```

Suggested slots:

- `leading`: back/collapse/context control.
- `title`: custom title region.
- `actions`: desktop primary/secondary actions.
- `toolbar`: tabs, query controls, filters.
- default: main page content.
- `footer`: table pagination/summary.
- `mobileActions`: custom mobile action content.
- `empty`: optional empty state.

Do not render duplicate desktop and mobile buttons with duplicate IDs. Prefer one semantic action definition rendered in a responsive host, or a tested strategy that mounts only one variant. Provide safe-area padding and ensure dock does not cover the content.

## 6.3. Responsive action rules

- Desktop CTA: header right region.
- Mobile CTA: fixed/sticky footer action dock when there is a clear page-level primary action.
- Secondary actions: overflow menu / bottom sheet.
- Destructive action: confirmation and permission check.
- If no page actions exist, do not render an empty fixed footer.
- Long forms: sticky save/cancel footer only when it does not cover focused fields/keyboard.
- Touch target sizes must remain comfortable even with compact visual radius.

---

# 7. Component architecture and lazy loading

## 7.1. Component principles

- Pages orchestrate; components present; composables coordinate state/API; server services enforce business rules.
- Keep components small and responsibility-focused, but do not split every trivial element into a component without reuse/meaning.
- Highly reusable components must expose typed props, events, slots, loading/error/empty states and variants.
- Module-specific components stay under `modules/<domain>/`.
- Avoid direct database/API business logic inside visual component.
- Avoid components that silently fetch hidden customer data without explicit context.

## 7.2. Component folders

```text
components/
├── base/                # Confirm dialog, responsive modal, image viewer
├── layout/              # Sidebar, header, topbar, bottom nav, user menu
├── page/                # CmsBasePage, PageHeader, PageToolbar, PageActionDock
├── data-display/        # Table wrappers, grid list, stat cards, timeline
├── forms/               # Form shell, field wrappers, validation summary
├── inputs/              # Currency, date range, tags, attribute editor
├── overlays/            # Modal, drawer, slideover, command palette
├── feedback/            # Alert, empty, skeleton, error state
├── charts/              # Chart wrappers and reusable legends
├── editor/              # TipTap/TinyMCE wrappers
├── media/               # Media picker and preview
└── modules/
    ├── products/
    ├── content/
    ├── commerce/
    ├── inventory/
    ├── finance/
    ├── hr/
    ├── customers/
    └── suppliers/
```

## 7.3. Lazy prefix policy

Use Nuxt's `Lazy` component prefix for heavy/conditional UI and validate generated chunks in the current Nuxt 4 version.

Lazy candidates:

- Rich text editors.
- Charts and analytics panels below the fold.
- Heavy media picker/gallery.
- Advanced filters opened by user action.
- Complex modal/slideover content.
- Import preview/mapping UI.
- AI assistant panel.
- Large report/timeline visualizations.

Do not lazy-load critical shell, page heading, basic button/input, or essential content without measurable reason. `Lazy` creates an async component boundary; use `v-if` or an explicit interaction/visibility condition to defer mounting/loading when appropriate.

Example:

```vue
<template>
  <CmsBasePage title="Products">
    <ProductToolbar />
    <ProductTable :rows="rows" />
    <LazyProductEditor
      v-if="editorOpen"
      v-model="form"
      @save="saveProduct"
    />
    <LazyProductImportDialog
      v-if="importOpen"
      @completed="refresh"
    />
  </CmsBasePage>
</template>
```

---

# 8. Authentication and authorization with TM Hub

## 8.1. Authority boundaries

- TM Hub owns user identity, password/passkey/TOTP/OAuth lifecycle, sessions, app membership, tenant membership and role/permission assignments according to deployed Hub contract.
- CMS owns business records and CMS-specific authorization integration points, but not a duplicate identity database.
- Do not copy Hub user/role/session models into CMS as the source of truth.
- Local CMS may keep non-authoritative audit actor snapshots only when justified; use stable Hub `userId` references.

## 8.2. Application identity

Each customer CMS deployment has its own Hub installation registration:

```env
TM_TENANT_ID=tenant_customer_a
TM_CMS_APP_ID=customer_a_cms
HUB_URL=https://hub.example.com
```

The exact variable names must match the Hub and SDK contracts after repository audit. `TM_CMS_APP_ID` is a server-trusted deployment context; never let browser request body select another customer's app ID.

## 8.3. Recommended browser/server auth boundary

Preferred pattern:

```text
Browser
  └── same-origin /api/auth/* (CMS BFF)
         └── server-side tm-hub-client
                └── TM Hub Auth API
```

- Prefer Secure, HttpOnly, SameSite cookies when the Hub/BFF contract supports it.
- No refresh token in localStorage/sessionStorage.
- If access token must reach browser for a documented reason, document XSS/storage threat and do not expose Hub app secret.
- Use CSRF protection for state-changing cookie-authenticated endpoints (SameSite policy alone may not cover all deployment patterns).
- Server-side API guard resolves trusted app/tenant context and validates session/token against Hub's supported verification/introspection/JWKS method.
- Browser-supplied `tenantId`, `appId`, roles and permissions are never trusted.
- Use actual `tm-hub-client` refresh semantics; no custom parallel auth implementation unless SDK lacks a required capability.

## 8.4. Refresh/session requirements

- Access token lifetime follows Hub policy; do not hardcode 1h/15m without checking live Hub settings.
- Refresh token rotation/reuse detection follows Hub implementation.
- Avoid refresh loops. A refresh operation must not recursively call `fetchUser()` which retries refresh again.
- A server request must not share user-specific promise/token state globally across unrelated requests.
- Concurrent refresh for the same session should be coordinated with a safe per-session mechanism if required.
- 401 clears/renews session according to Hub response; 403 does not force logout.
- Logout revokes Hub session and clears CMS cookies.

## 8.5. Permission enforcement

Examples:

```text
products.read
products.create
products.update
products.delete

inventory.read
inventory.adjust
inventory.transfer

finance.transactions.read
finance.transactions.create
finance.transactions.approve

hr.staff.read
hr.staff.manage
hr.payroll.read
hr.payroll.approve
```

- Use stable permission codes, not display labels.
- Route access is derived from permissions but does not secure APIs.
- API middleware checks authentication, active app installation, tenant scope, module entitlement, permission and resource ownership.
- Return 401 for unauthenticated, 403 for unauthorized, and avoid cross-tenant data disclosure.
- Component `v-if` permission checks improve UX only.

## 8.6. Module entitlements

Server enforcement order:

```text
Authenticate
→ Resolve trusted tenant + CMS app installation
→ Verify app/tenant active
→ Verify module entitlement enabled
→ Verify user permission
→ Verify record ownership/scope
→ Execute use case
```

The UI navigation is built from entitlement + Hub routes/permissions. It is not the security boundary.

---

# 9. Customer database and persistence

## 9.1. Recommended isolation

Default recommendation: one logical MongoDB database per customer, potentially on the same MongoDB cluster:

```text
MongoDB Cluster
├── tm_customer_a
├── tm_customer_b
└── tm_customer_c
```

Customer A's CMS and Web point to `tm_customer_a`; Customer B's CMS and Web point to `tm_customer_b`.

## 9.2. Credentials

- CMS server receives a customer-scoped DB credential with required read/write permissions.
- Website server receives a read-only DB credential for public read collections where feasible.
- Public forms/checkout must use a deliberately limited write path/role or a separate ingestion/service boundary; do not grant Website general admin write privileges.
- Never expose MongoDB URI/name/credentials to browser or `runtimeConfig.public`.
- DB credentials belong in Vercel environment secrets or an approved secret manager, not customer config committed to Git.
- Do not let `tenantId`/database name be constructed from untrusted request parameters.

## 9.3. Connection manager

- Reuse a tested connection manager with named connection pools if current `tm-hub` or CMS code provides one suitable for this app.
- Fail fast (`bufferCommands: false` where appropriate), deduplicate concurrent connection attempts, apply bounded cooldown/retry, handle connection state and shutdown.
- Do not create one new connection per request.
- Do not silently point missing production config to a shared/default customer database.
- Dev fallback is allowed only with explicit `NODE_ENV=development` and local DB configuration.

## 9.4. Persistence models and naming

The frozen reference uses legacy names such as `Item`, `ItemCategory`, `Post`, `Page`, `Inventory`, etc. Do not rename collections during extraction without migration. Domain/UI may call Product while the mapper persists to legacy `Item` collection.

Use `@tm/flow-db-models` only if server-only shared model definitions are beneficial and pass compatibility tests. Otherwise preserve local model files initially and extract gradually.

## 9.5. Tenant and site data

- Database-per-tenant provides the primary customer boundary.
- Still store/validate `siteId` on site-scoped records if a tenant operates multiple websites.
- Product master data can be shared; optional `SiteProduct` mapping stores per-site publication, sort order, SEO override and visibility.
- CMS routes must use the current tenant DB connection; Web app for that tenant uses the same DB but public-only reads.

---

# 10. CMS API architecture

## 10.1. API design principles

- CMS-specific routes live under `/api/v1/admin/*`.
- Validate body/query/params with shared Zod contracts.
- Controller: parse request, authorize, call use case, serialize DTO.
- Service/use case: enforce business invariants and transaction boundaries.
- Repository: execute CMS-oriented query; always scoped to current tenant DB/context.
- Mapper: convert persistence model to admin DTO.
- API does not accept fields that user is not allowed to edit.
- Use consistent error envelope and request/correlation IDs.
- Use cursor pagination for large collections if source supports it; otherwise standardize offset semantics deliberately.

## 10.2. Suggested endpoint inventory

Do not create all endpoints blindly. Audit existing routes and keep compatibility for consumers.

### Dashboard and system

```text
GET    /api/v1/admin/dashboard/summary
GET    /api/v1/admin/dashboard/activity
GET    /api/v1/admin/profile
GET    /api/v1/admin/system/bootstrap
GET    /api/v1/admin/system/config
GET    /api/v1/admin/system/data
GET    /api/v1/admin/audit-logs
```

### Products and catalog

```text
GET    /api/v1/admin/products
POST   /api/v1/admin/products
GET    /api/v1/admin/products/:id
PUT    /api/v1/admin/products/:id
DELETE /api/v1/admin/products/:id
POST   /api/v1/admin/products/bulk
GET/POST/PUT/DELETE /api/v1/admin/product-categories/...
GET/POST/PUT/DELETE /api/v1/admin/attributes/...
GET/POST/PUT/DELETE /api/v1/admin/options/...
GET/POST/PUT/DELETE /api/v1/admin/keywords/...
```

### Content

```text
GET/POST /api/v1/admin/content/posts
GET/PUT/DELETE /api/v1/admin/content/posts/:id
GET/POST /api/v1/admin/content/pages
GET/PUT/DELETE /api/v1/admin/content/pages/:id
GET/POST/PUT/DELETE /api/v1/admin/content/categories/...
```

### Commerce and CRM

```text
GET/POST /api/v1/admin/commerce/orders
GET/PUT /api/v1/admin/commerce/orders/:id
POST   /api/v1/admin/commerce/orders/:id/transitions
GET/POST /api/v1/admin/commerce/quotations
GET/PUT/DELETE /api/v1/admin/commerce/quotations/:id
GET/POST /api/v1/admin/customers
GET/PUT/DELETE /api/v1/admin/customers/:id
GET/POST /api/v1/admin/customer-segments
```

### Inventory and purchasing

```text
GET    /api/v1/admin/inventory/stock
POST   /api/v1/admin/inventory/adjustments
POST   /api/v1/admin/inventory/transfers
GET/POST /api/v1/admin/warehouses
GET/PUT/DELETE /api/v1/admin/warehouses/:id
GET/POST /api/v1/admin/suppliers
GET/POST /api/v1/admin/purchase-orders
POST   /api/v1/admin/purchase-orders/:id/receive
```

### Finance

```text
GET    /api/v1/admin/finance/overview
GET    /api/v1/admin/finance/transactions
POST   /api/v1/admin/finance/transactions
GET    /api/v1/admin/finance/payments
POST   /api/v1/admin/finance/payments
GET    /api/v1/admin/finance/reports/*
```

Finance state transitions must be auditable, authorized and transaction-safe. Do not allow changing approved/paid records through generic update endpoints if the domain requires explicit workflow commands.

### HR

```text
GET/POST /api/v1/admin/hr/staff
GET/PUT/DELETE /api/v1/admin/hr/staff/:id
GET/POST /api/v1/admin/hr/attendance
GET/POST /api/v1/admin/hr/payroll/runs
POST   /api/v1/admin/hr/payroll/:id/approve
POST   /api/v1/admin/hr/payroll/:id/mark-paid
```

HR and payroll are sensitive modules. Strict permission checks, audit trail, minimum response fields and no public DTO leakage are mandatory.

### Import, media, notifications, settings

```text
POST   /api/v1/admin/import/preview
POST   /api/v1/admin/import/run
GET    /api/v1/admin/import/jobs/:id
GET    /api/v1/admin/media/*              # Prefer TM Hub Media SDK/Gateway
GET    /api/v1/admin/notifications
POST   /api/v1/admin/notifications/read
GET/PUT /api/v1/admin/settings/company
GET/PUT /api/v1/admin/settings/menus
GET/PUT /api/v1/admin/settings/modules
```

Media/notifications may proxy TM Hub SDK rather than duplicate data/service implementation. Keep app-specific UI and workflow inside CMS.

## 10.3. Service and repository boundaries

Example:

```text
server/api/v1/admin/products/index.get.ts
  → validate AdminProductQuerySchema
  → authorize products.read
  → productAdminService.listForAdmin(context, query)
  → productAdminRepository.findPage(context, query)
  → map to AdminProductDTO
  → validate output DTO in tests (or runtime if policy requires)
```

Repository functions must receive trusted server context, not raw customer ID from client.

## 10.4. Transactions and consistency

Use MongoDB transaction only when deployment topology supports it and business invariants require it. For workflows spanning multiple collections (inventory receipt, order stock reservation, finance payment reconciliation), define idempotency keys and audit transitions. If transactions unavailable, document compensating action/outbox pattern; do not pretend multi-document writes are atomic.

---

# 11. Business modules to preserve/migrate

Reference `nuxt4-cms.md` describes 80+ pages, 45 models, 29 backend services, 23 Pinia stores, 69 composables and many Zod/type files. These counts are inventory hints only; Phase 0 must compare actual source and resolve differences before migration.

## 11.1. Products and Catalog

- Items/products, categories, attributes, options/variants, keywords, pricing.
- Product editor with media, SEO fields, specifications and category assignments.
- Bulk actions, filters, export/import.
- Preserve legacy `Item` collection compatibility.
- Website public publication is controlled via publish state and optional site mapping.

## 11.2. Content Management

- Posts, pages, categories, tags/keywords.
- Seven existing post formats from reference: standard, gallery, audio, video, link, quote, dynamic.
- Draft/review/published/archived workflow if present in source.
- Content editor loaded lazily.
- Publishing triggers signed revalidation event for each linked `tm-web` site.

## 11.3. Commerce and Sales

- Orders, POS, quotations, customers, segments.
- Explicit order/quotation status transition use cases.
- Keep calculations in domain/service layer, not UI.
- Do not enable checkout/POS modules by default for every customer.

## 11.4. Inventory and Supply Chain

- Multi-warehouse stock.
- Stock transaction history.
- Purchase orders and receiving.
- Supplier links.
- Reservations/available quantity must be calculated with a documented source of truth.

## 11.5. Finance

- Payments, transactions, debts, finance reports.
- Separate read reports from write/approval commands.
- Currency, rounding, tax and timezone policies must be explicit.
- Append-only ledger/audit approach where business requires it; do not overwrite historical financial effects.

## 11.6. HR

- Staff profiles, attendance, shifts, salary configurations, payroll.
- Role-restricted data access.
- Payroll generation, review, approval and paid states must be explicit.
- Avoid returning bank/payroll/private employee fields in general staff list DTO.

## 11.7. System and settings

- Company profile, menus, system config/data, mail, shipping, integrations, audit, roles/routes view from Hub where appropriate.
- Do not duplicate Hub IAM management data as local source of truth.
- Customer-specific app modules/settings remain in CMS DB if they are business settings, not Hub IAM records.

---

# 12. Frontend state and data fetching

- Pinia owns long-lived client UI/domain state only when needed (filters, selected work context, cart-like admin workflows).
- Server data fetching should use Nuxt data fetching patterns or a standardized CMS API composable; do not mirror every server list into Pinia without benefit.
- Avoid stale duplicated state between `useAsyncData` and Pinia.
- Every list page has consistent pagination/filter reset/loading/error/empty behavior.
- API composables validate parameters using shared schema/types and normalize errors.
- Persist only harmless preferences (sidebar collapsed, table density, locale); never persist Hub refresh token in localStorage.

Suggested composables:

```text
useCmsApi()
useCmsAuth()
useCmsPermissions()
useCmsModules()
useCmsNavigation()
useAdminProducts()
useAdminProductCategories()
useAdminContentPosts()
useAdminInventory()
useAdminFinanceReports()
useAdminHrStaff()
useAdminHrPayroll()
useCmsMedia()
useCmsNotifications()
```

Names may follow existing source conventions where migration cost is lower.

---

# 13. AI Workspace in CMS

## 13.1. Scope

CMS AI is an authenticated administration capability. It may help with:

- Drafting product descriptions, article outlines and SEO metadata.
- Summarizing business reports for users authorized to view those reports.
- Explaining CMS data and assisting with import mapping.
- Internal support assistant using approved documentation.
- Content translation/localization.

AI is an assistant, not an authorization bypass. It cannot reveal HR/Finance/employee data unless the current user has permission and the specific tool is explicitly granted.

## 13.2. Provider and model handling

- Provider credentials are managed in TM Hub or a server-side secret manager.
- Browser receives provider/model display metadata only, never provider keys.
- CMS calls an approved server-side AI Runtime/Proxy.
- Confirm whether TM Hub currently has inference/streaming APIs; Provider Connection/Model Catalog/Grant management does not automatically mean inference is implemented.
- If Hub does not provide inference, CMS server can use a controlled AI gateway with credentials from server environment/secret store; do not duplicate credential admin UI without decision.

## 13.3. AI safety and data scope

- Tool calls use current user + tenant + app context.
- Every tool independently checks permissions and data scope.
- Use allow-listed tools; default to read-only.
- Require confirmation for writes, bulk actions, financial changes or external sends.
- Log model/provider, usage/cost metadata, user, tenant, action and outcome; never log secrets or full sensitive prompts unless policy permits.
- Redact personal/sensitive fields not required for task.
- Set rate limits, per-tenant budgets, allowed models and retention policy.

---

# 14. Branding, PWA and app loading

## 14.1. CMS-specific identity

Each customer CMS deployment has:

- App display name.
- Logo variants.
- Favicon.
- PWA icon set if enabled.
- Primary/accent palette mapped to design tokens.
- SPA loading template.
- Copyright/company branding.
- Optional locale/timezone/currency defaults.

## 14.2. Build-time assets

Favicon, PWA icons and `spa-loading-template.html` must be prepared for that customer build. They are not safely swapped by a public runtime config after build. Generate/copy assets into an isolated build workspace.

## 14.3. PWA

- PWA is optional per customer.
- App name, short name, theme/background colors, icons and manifest start URL use CMS app identity.
- Cache only app shell/static resources and deliberately selected offline data.
- Never cache sensitive admin API responses, HR/payroll or finance data in shared service worker caches.
- Version/cache namespace must be customer/app-specific.
- Logout clears user-specific cached data where applicable.

## 14.4. Loading template

The CMS SPA loader must be self-contained, lightweight, accessible and use the same customer brand tokens/assets. It must not include secrets or call public config API before app initialization. Validate output HTML in build tests.

---

# 15. Environment and deployment

## 15.1. Environment variables

Example only; final names follow app config implementation:

```env
NODE_ENV=production
NUXT_PUBLIC_APP_KIND=cms
TM_TENANT_ID=tenant_customer_a
TM_CMS_APP_ID=customer_a_cms

HUB_URL=https://hub.example.com
HUB_APP_ID=customer_a_cms
HUB_APP_SECRET=                         # only if Hub contract needs it; server only

MONGODB_URI=mongodb+srv://...           # server only
MONGODB_DATABASE=tm_customer_a

CUSTOMER_CONFIG_ID=customer-a
BRAND_ASSET_REVISION=git-sha-or-version

# Optional AI server integration only
AI_RUNTIME_URL=
AI_RUNTIME_TOKEN=                       # server only
```

Do not prefix secrets with `NUXT_PUBLIC_`. Avoid duplicate variables that can disagree; document one authoritative mapping.

## 15.2. Vercel

- Use `nuxt build` for server-capable Nuxt deployment.
- Set customer environment variables per Vercel Project and environment (Preview/Production/Development).
- Use separate Vercel project for each customer CMS deployment when customer-specific environments/domains/credentials are required.
- The same CMS source can back multiple projects.
- Configure private registry read token in Vercel build environment; least privilege.
- Do not share one project's DB/Hub secret with another customer's project.
- Preview deployment must use isolated non-production database/tenant/app installation.

## 15.3. Build commands

```bash
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

If customer-specific build config or assets are generated:

```bash
pnpm customer:validate customer-a
pnpm customer:prepare customer-a cms
pnpm customer:build customer-a cms
```

Never run parallel customer builds against the same mutable `public/` or `.output/` path.

---

# 16. Migration from frozen `nuxt4-cms`

## 16.1. Reference inventory to preserve

The reference document describes:

- SPA Nuxt 4, Nuxt UI/Tailwind v4, Mongo/Mongoose.
- 80+ page routes.
- Product/Catalog, Commerce, Content, Inventory, Finance, HR, system/settings and portals.
- 45 Mongoose models.
- 29 server services.
- 23 Pinia stores.
- 69 composables.
- 29 Zod schemas and 28 TypeScript type files.

Counts are reference-only. Verify actual source before acting.

## 16.2. Do not copy local IAM authority

Replace local CMS login/user/role/session authority with TM Hub integration. Preserve only business records and optional non-authoritative user references. Plan any legacy staff/user migration carefully: staff profile is business HR data and must not be confused with Hub identity.

## 16.3. Migration phases

### Phase 0 — Source audit (read-only)

- Inspect source repository, package scripts, Nuxt config, route map, middleware.
- Inventory all pages, components, composables, stores, APIs, models, services, schemas and tests.
- Identify existing DB collection names/indexes and migration conventions.
- Identify local auth code and all consumers.
- Identify shared CMS/Website collections and write ownership.
- Produce file-level migration map and risk list.
- Do not modify code.

### Phase 1 — New app foundation

- Create `tm-cms` repository/project.
- Install Nuxt layers and private shared package baseline.
- Configure `ssr: false`, Nitro, i18n, runtime config and design system.
- Build a minimal admin shell with placeholder pages.
- Confirm dev/build on target Node runtime.

### Phase 2 — Design System + BasePage

- Implement global tokens/theme.
- Build Admin Shell, `CmsBasePage`, Page Header, Toolbar, Action Dock.
- Visual tests desktop/tablet/mobile.
- Only after this phase migrate pages in groups.

### Phase 3 — TM Hub auth

- Integrate actual `tm-hub-client` SDK contracts.
- Add CMS BFF/session cookies if needed.
- Verify login, logout, refresh, TOTP, passkey, app membership, permissions and tenant context.
- Add backend authorization tests.

### Phase 4 — Shared Contracts extraction

- Migrate Zod schemas/types by domain into NPM packages.
- Use compatibility aliases where needed.
- Do not rename Mongo collections.

### Phase 5 — Database and API foundation

- Build tenant-specific DB connection manager.
- Build CMS repositories and admin APIs.
- Verify customer DB cannot be selected via request input.
- Add integration tests.

### Phase 6 — Module migration

Recommended sequence:
1. Company/system settings and media integration.
2. Products/Catalog.
3. Content.
4. Customers/Suppliers.
5. Inventory/Purchase Orders.
6. Commerce/Orders/Quotations/POS.
7. Finance.
8. HR.
9. Reports/import/export/notifications.
10. AI workspace.

Sequence may change based on customer priority and dependencies. Do not implement inactive modules just to match a checklist.

### Phase 7 — Customer branding and PWA

- Validate customer config.
- Generate favicon/PWA/loading template assets.
- Run isolated customer build.
- Verify no cross-customer asset leakage.

### Phase 8 — Production hardening

- Security tests, authorization matrix, DB isolation tests.
- Performance/bundle analysis.
- Backup/restore exercise.
- Build and deploy test.
- Migration report and rollback notes.

---

# 17. Testing matrix

## 17.1. Authentication

- Login success/failure.
- TOTP required and verified.
- Passkey flow if supported.
- Session refresh and rotation.
- Logout/revocation.
- Expired/inactive app installation.
- User removed from tenant/app membership.
- Concurrent refresh does not loop or cross-contaminate sessions.

## 17.2. Authorization

- User with `products.read` can view list but cannot write.
- User without `finance.read` receives 403 from finance endpoints even if URL is known.
- User cannot alter `tenantId`/`appId` in request to read another customer.
- Disabled module endpoint is denied server-side.
- Component/menu visibility matches permissions, but API check remains authoritative.
- Cross-module pages can render permitted sections without granting every permission.

## 17.3. Data integrity

- Product create/update validates shared Zod input.
- Legacy Item documents still map correctly.
- Public-only fields not used as admin write payload accidentally.
- Order/inventory/finance workflows have idempotency and state-transition tests.
- Multi-document behavior tested on actual MongoDB topology.

## 17.4. UI and responsive

- BasePage desktop header actions.
- Mobile footer actions and bottom navigation do not overlap.
- Safe-area and keyboard behavior.
- Empty/loading/error/permission-denied states.
- Light/dark theme and customer brand override.
- Reduced motion and focus ring.
- Heavy lazy components only load when invoked.

## 17.5. Deployment

- Build using frozen lockfile.
- CMS SPA shell loads.
- Nitro API responds on deployment target.
- Runtime secrets absent from client build output.
- Customer A and B builds use different assets and DB config.
- Preview environment does not touch production data.

---

# 18. Definition of Done

- [ ] Nuxt 4 CMS is an independent SPA project (`ssr: false`).
- [ ] Nitro API behavior is confirmed for selected deployment target.
- [ ] Required Nuxt Layers install/build correctly.
- [ ] Shared NPM packages are version-pinned.
- [ ] Central Design System has one global CSS entrypoint.
- [ ] `CmsBasePage` works on desktop and mobile.
- [ ] Desktop actions appear in header; mobile page actions appear in footer dock.
- [ ] Components are grouped by logical domain and are reusable.
- [ ] Lazy prefix is applied selectively and build chunks are verified.
- [ ] TM Hub is the identity/RBAC authority.
- [ ] No duplicated CMS user/role/session source of truth.
- [ ] Customer DB is isolated and selected only from trusted deployment context.
- [ ] CMS APIs own admin query/write workflows.
- [ ] Public DTO/private field boundary is enforced.
- [ ] CMS works without `tm-web`.
- [ ] Customer brand/PWA/loading assets are isolated per build.
- [ ] AI credentials never reach browser.
- [ ] Typecheck/lint/unit/integration/E2E/build results are recorded truthfully.
- [ ] Migration and rollback plan is documented.

---

# 19. Required AI coding agent workflow

1. Read this document, shared package specification, Hub addendum and repository instructions.
2. Inspect actual source; do not infer file/API names from this target blueprint.
3. Start with Phase 0 audit. Phase 0 is read-only.
4. Produce a current-state inventory and discrepancy report.
5. Give a file-level plan for Phase 1; proceed phase-by-phase without unrelated refactors.
6. Do not ask the user to restate decisions captured here. For non-blocking ambiguity, use the defaults in this document and record the assumption.
7. If a security, data ownership or destructive migration decision is truly blocking, stop only that operation, explain evidence and give safe alternatives. Do not invent credentials, production endpoints or schema details.
8. Keep legacy project frozen. New code goes to `tm-cms`.
9. After each phase report: files inspected/created/modified, API/schema changes, DB/migration impact, auth/security changes, tests and commands actually run, risks, rollback and next phase.
10. Never claim tests, deployment or migration passed unless executed and verified.

## 20. External technical references

- Nuxt Layers: https://nuxt.com/docs/4.x/getting-started/layers
- Nuxt rendering modes: https://nuxt.com/docs/4.x/guide/concepts/rendering
- Nuxt UI v4: https://ui.nuxt.com/docs/getting-started/theme
- Nuxt runtime config: https://nuxt.com/docs/4.x/api/composables/use-runtime-config
- Nuxt Vercel deployment: https://vercel.com/docs/frameworks/full-stack/nuxt
- PNPM Workspace: https://pnpm.io/workspaces
- Zod: https://zod.dev/
