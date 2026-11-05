# Design Document: TM Websites Architecture Scaffolding (`tm-shared`, `tm-cms`, `tm-web`)

**Date:** 2026-11-02  
**Status:** Pending Approval  
**Target Projects:**
- `d:\Applications\tm-websites\tm-shared` (Shared packages monorepo)
- `d:\Applications\tm-websites\tm-cms` (Customer CMS Admin Nuxt 4 SPA)
- `d:\Applications\tm-websites\tm-web` (Customer Public Web Nuxt 4 SSR/Hybrid)

---

## 1. Intent & Context

### 1.1. Background
The legacy codebases (`D:\Applications\nuxt4-cms` and `D:\Applications\nuxt4-website`) accumulated significant technical debt:
- Configurations were fragmented across multiple manual customer files (`.env.bag-post`, `.env.hoang-vi`, `.env.sentuan`, etc.).
- There was no Nuxt Layers architecture for reusability, causing duplicate UI code, types, and schema validations.
- Build and release processes lacked tenant isolation and customer-specific parameterization.

The blueprint specifications (`TM-Shared-Packages-Architecture.md`, `TM-CMS-Project-Blueprint.md`, `TM-WEB-Project-Blueprint.md`, `TM-CMS-WEB-HUB-Blueprint-Index.md`) establish a clean architecture:
- **Two Independent Nuxt Applications** (`tm-cms` and `tm-web`) + **One Shared Package Monorepo** (`tm-shared`).
- **Shared NPM Foundation**: Contracts (Zod), configs, pure utils, design system, and low-level Nuxt Layers.
- **Tenant-Isolated Customer Data**: Multi-tenant customer database architecture with central TM Hub IAM.

### 1.2. The User's Direct Request
1. Scaffold clean skeleton architectures for all 3 projects (`tm-shared`, `tm-cms`, `tm-web`).
2. Design language: **Linear Flat Glassmorphism & Bento UI** with micro-rounded borders (compact radius 2/4/6/8/10px), inspired by `D:\Applications\tm-data-manager\app` (`.udmt-backdrop`, `.panel`, ambient glow).
3. Maximize productivity via centralized configuration (`@tm/flow-config`) and architecture conventions from `D:\Applications\tm-tools` (TM Hub satellite client `useHub()`, strict `BasePage` standard, triple-state UX).
4. Local linkage: During initial phase, `tm-cms` and `tm-web` reference `tm-shared` packages via local file/workspace paths (`file:../tm-shared/packages/...`) so separate AI agents can work on individual projects concurrently with instant HMR and rapid feedback.
5. Independent Git repos: The user will initialize separate Git repositories for each project.

---

## 2. Goals, Non-Goals & Anti-Goals

### 2.1. Goals
- **Scaffold `tm-shared` Monorepo**:
  - PNPM workspace containing key foundation packages:
    - `@tm/flow-contracts`: Zod schemas, DTOs, enums, API request/response types.
    - `@tm/flow-config`: Centralized customer, site, brand, and module entitlement parser.
    - `@tm/flow-utils`: Pure utility helpers (date, money, formatting, slug).
    - `@tm/design-system`: CSS tokens for Linear Flat Glassmorphism, Bento UI, micro border radius (2px - 10px), ambient backdrop, and theme definitions.
    - Nuxt Layers: `nuxt-layer-core`, `nuxt-layer-api-base`, `nuxt-layer-config-base`, `nuxt-layer-cms-base`, `nuxt-layer-web-base`.
- **Scaffold `tm-cms` (Admin SPA)**:
  - Nuxt 4 SPA (`ssr: false`) extending `@tm/nuxt-layer-cms-base`.
  - Layout with responsive sidebar and header action dock.
  - `CmsBasePage.vue` wrapping mechanism with slot structure (`#default`, `#right`, `#mobile-actions`).
  - Bento dashboard UI demoing StatCards, ambient background, and micro radius.
  - TM Hub satellite client abstraction (`useHub`).
- **Scaffold `tm-web` (Public Web SSR/Hybrid)**:
  - Nuxt 4 SSR/Hybrid (`ssr: true`) extending `@tm/nuxt-layer-web-base`.
  - Layout with public header, footer, and navigation.
  - `WebBasePage.vue` composition primitive.
  - Slug resolver routing stub (`pages/[...slug].vue`).
- **Centralized Configuration & Productivity**:
  - Centralized customer config manifest (`customer.config.ts`) eliminating scattered `.env.<customer>` files.
  - Root and package build/lint/typecheck scripts aligned with `D:\Applications\tm-tools`.

### 2.2. Non-Goals
- Migrating all business modules (Catalog, HR, Finance, Inventory, Purchase Orders) in this scaffolding phase (these will be assigned to specialized AI agents per module).
- Setting up a live private Verdaccio NPM registry in Phase 1 (local `file:` paths will be used temporarily).
- Connecting directly to live production customer MongoDB instances during scaffolding.

### 2.3. Anti-Goals
- Do NOT merge `tm-cms` and `tm-web` into a single monolithic Nuxt application.
- Do NOT bundle Mongoose or server-side DB models into client browser bundles.
- Do NOT write ad-hoc CSS classes or arbitrary inline color values in individual component templates.

---

## 3. Approaches Considered & Trade-Offs

### Approach 1: Phased Hybrid with Local Path Linking (Chosen)
- `tm-shared`, `tm-cms`, and `tm-web` are independent folders with their own `package.json` and configs.
- `tm-cms` and `tm-web` consume layers and packages via local relative path references (`file:../tm-shared/packages/...`).
- **Why chosen:** Gives the user total freedom to initialize 3 separate Git repos while maintaining high development velocity, hot module reloading (HMR), and easy cross-project code navigation.

### Approach 2: Strict Registry First
- Publish all `tm-shared` packages to an internal verdaccio / npm registry before starting `tm-cms` or `tm-web`.
- **Trade-off:** High friction in early development; any tweak to CSS tokens or Zod contracts requires version bumping, building, and publishing before testing in the app.

### Approach 3: In-Place Refactoring of `nuxt4-cms` and `nuxt4-website`
- Directly edit the existing legacy repos.
- **Trade-off:** High risk of regression, leftover dead code, and conflicting legacy dependencies.

---

## 4. Architectural & Technical Specifications

### 4.1. Visual Design Language: Linear Flat Glassmorphism & Bento UI
Sourced from `D:\Applications\tm-data-manager\app` and adapted to blueprint standards:
1. **Micro-Radius Scale**:
   - Compact tokens: `radius-2` (2px), `radius-4` (4px), `radius-6` (6px), `radius-8` (8px), `radius-10` (10px).
   - Default UI panel / card radius: `rounded-[6px]` or `rounded-[8px]`.
2. **Ambient Aurora Backdrop (`.udmt-backdrop`)**:
   - Radial gradients positioned at top edges with subtle opacity (`14%` light, `26%` dark), blending primary/secondary brand hues.
3. **Glass Panels (`.panel`)**:
   - `background: color-mix(in oklab, var(--ui-bg-elevated) 82%, transparent);`
   - `backdrop-filter: blur(16px);`
   - `border: 1px solid var(--ui-border);`
4. **Bento Grid Architecture**:
   - Asymmetric grid layouts (`grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4`) displaying key metrics (`StatCard`), quick actions, and data tables with compact density.

### 4.2. `tm-shared` Monorepo Structure
```text
d:\Applications\tm-websites\tm-shared/
├── packages/
│   ├── design-system/
│   │   ├── css/
│   │   │   ├── index.css
│   │   │   ├── tokens.css
│   │   │   ├── glass.css
│   │   │   └── bento.css
│   │   └── package.json
│   ├── flow-contracts/
│   │   ├── src/
│   │   │   ├── common/ (pagination, result, id)
│   │   │   ├── auth/ (user, session, permission DTOs)
│   │   │   ├── catalog/ (product, category DTOs)
│   │   │   └── index.ts
│   │   └── package.json
│   ├── flow-config/
│   │   ├── src/
│   │   │   ├── schema/ (customerConfigSchema, brandSchema, moduleSchema)
│   │   │   ├── parser.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── flow-utils/
│   │   ├── src/
│   │   │   ├── date.ts
│   │   │   ├── money.ts
│   │   │   ├── slug.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── nuxt-layer-core/
│   │   ├── app/
│   │   ├── nuxt.config.ts
│   │   └── package.json
│   ├── nuxt-layer-api-base/
│   │   ├── server/utils/
│   │   ├── nuxt.config.ts
│   │   └── package.json
│   ├── nuxt-layer-config-base/
│   │   ├── app/composables/useAppConfigResolver.ts
│   │   ├── nuxt.config.ts
│   │   └── package.json
│   ├── nuxt-layer-cms-base/
│   │   ├── app/components/CmsBasePage.vue
│   │   ├── app/layouts/cms.vue
│   │   ├── nuxt.config.ts
│   │   └── package.json
│   └── nuxt-layer-web-base/
│       ├── app/components/WebBasePage.vue
│       ├── app/layouts/web.vue
│       ├── nuxt.config.ts
│       └── package.json
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

### 4.3. `tm-cms` Project Structure (Nuxt 4 SPA)
```text
d:\Applications\tm-websites\tm-cms/
├── app/
│   ├── components/
│   │   ├── dashboard/ (StatCard.vue, BentoGrid.vue)
│   │   └── base/
│   ├── composables/
│   │   ├── useHub.ts (Satellite client from tm-tools)
│   │   └── useNavMenu.ts
│   ├── layouts/
│   │   └── default.vue (Sidebar + Navbar + Backdrop)
│   ├── pages/
│   │   ├── index.vue (Bento dashboard)
│   │   └── settings/
│   ├── app.config.ts (Color palette: primary violet, neutral zinc, etc.)
│   └── app.vue
├── server/
│   └── api/ (Admin Nitro endpoints)
├── i18n/locales/ (en.json, vi.json)
├── nuxt.config.ts (ssr: false, extends: local layers)
├── package.json
├── tsconfig.json
└── AGENTS.md (Guidance for AI agents working on tm-cms)
```

### 4.4. `tm-web` Project Structure (Nuxt 4 SSR/Hybrid)
```text
d:\Applications\tm-websites\tm-web/
├── app/
│   ├── components/
│   │   ├── storefront/ (HeroSection.vue, ProductCard.vue)
│   │   └── base/
│   ├── composables/
│   │   └── useSiteContext.ts
│   ├── layouts/
│   │   └── default.vue (Public header + footer)
│   ├── pages/
│   │   ├── index.vue (Storefront / Brand showcase)
│   │   └── [...slug].vue (Universal slug resolver for CMS pages/products)
│   ├── app.config.ts
│   └── app.vue
├── server/
│   └── api/ (Public website Nitro endpoints)
├── i18n/locales/ (en.json, vi.json)
├── nuxt.config.ts (ssr: true, extends: local layers)
├── package.json
├── tsconfig.json
└── AGENTS.md (Guidance for AI agents working on tm-web)
```

### 4.5. Multi-Tenant Centralized Configuration System
Instead of maintaining 5+ separate `.env.<customer>` files, each deployment specifies:
`TM_CUSTOMER_ID=sentuan` (or `bag-post`, `hoang-vi`, etc.).
`@tm/flow-config` loads and validates customer profiles with Zod:
- Tenant ID & App ID.
- Brand colors, logos, font scales.
- Module entitlements (Catalog, HR, Finance, Inventory).
- Site routing and public domain bindings.

---

### 4.6. Multi-Customer Layer Architecture (Nuxt Customer Layers)

To enable seamless multi-customer customization and builds without code duplication, we introduce a structured **Customer Layers** system:

#### CMS Customer Configurations & Layers:
1. **`tm-cms` (Base)**: Core generic admin shell extending `@tm/nuxt-layer-cms-base`.
2. **Customer Layers (`tm-shared/packages/customer-layers/cms/` or `tm-cms/customers/`)**:
   - `sentuan-cms`: Tailored branding, specific module entitlements, custom navigation overrides.
   - `bag-post-cms`: Tailored logistics/order fields, custom bento dashboard cards.
   - `thanh-tung`: Tailored inventory & catalog parameters.
   - `hoang-vi`: Tailored customer service & booking extensions.

#### Web Customer Configurations & Layers:
1. **`tm-web` (Base)**: Core generic storefront & public web shell extending `@tm/nuxt-layer-web-base`.
2. **Customer Layers (`tm-shared/packages/customer-layers/web/` or `tm-web/customers/`)**:
   - `sentuan`: Brand storefront, customized hero/bento showcase, domain bindings.
   - `bag-post`: Postal & logistics tracking widgets, customized theme tokens.

Each customer layer can override `app.config.ts` (theme colors, brand logos), provide customer-specific assets, custom routes/components, while inheriting all core logic and Bento Glassmorphism design tokens from base layers.

---

## 5. Builder Check Resolutions & Implementation Decisions

Following technical review, the following decisions are confirmed for scaffolding:

1. **Authentication Architecture (`tm-cms`)**:
   - **Hybrid Best-Practice**: We scaffold a Nitro BFF authentication endpoint structure (`server/api/auth/*`) with HttpOnly cookies as mandated by the blueprint security rules, paired with a client-side composable `useHub.ts` (matching the intuitive developer ergonomics of `D:\Applications\tm-tools`). This allows AI agents to consume `const { user, login, logout, hubFetch } = useHub()` cleanly while keeping token storage secure on the server side.

2. **Master Customer Configuration Location**:
   - `@tm/flow-config` in `tm-shared` hosts the **Zod Schemas, Type Definitions, and Validator/Parser** (`customerConfigSchema`, `moduleEntitlementsSchema`, `brandThemeSchema`).
   - A reference customer profile template (`customer.config.ts` using `sentuan` as the reference implementation) is provided in `tm-cms` and `tm-web` roots. No customer secrets or private credentials are hardcoded into shared packages.

3. **Local Package Linking & Transpilation Strategy**:
   - Shared packages in `tm-shared` export TypeScript sources directly via `"exports": { ".": "./src/index.ts" }`.
   - In `tm-cms` and `tm-web`, Nuxt Layers are extended via relative paths (`extends: ['../tm-shared/packages/nuxt-layer-cms-base']`) and packages referenced via `"link:../tm-shared/packages/..."`.
   - Nuxt 4's Vite bundler handles on-the-fly TypeScript transpilation, enabling instant Hot Module Replacement (HMR) without needing intermediate `dist/` compilation builds.

---

## 6. What is Left to the Builder / Future Agent Teams
- Detailed business logic implementation of individual CMS sub-modules (Catalog, Purchase, HR, etc.).
- Complete Mongoose collection schemas and server database connection pooling.
- Production CI/CD pipelines and deployment scripts for Vercel/Node servers.
- Migrating remaining legacy customer profiles (`bag-post`, `hoang-vi`, `thanh-tung`).


