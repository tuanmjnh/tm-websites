# TM Websites Architecture Scaffolding Implementation Plan

> **Status (2026-11-04):** Implemented and superseded as a working plan. Actual paths diverged to `tm-shared/nuxt-layers/*` and `tm-shared/customer-layers/{cms,web}/*`; verification results are in [2026-11-04-customer-build-verification.md](../reports/2026-11-04-customer-build-verification.md). Keep this file as historical context only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the complete skeleton architecture for `tm-shared` (Monorepo with contracts, config, utils, design-system, base layers, and customer layers), `tm-cms` (Nuxt 4 SPA admin app), and `tm-web` (Nuxt 4 SSR/Hybrid public web app) featuring Linear Flat Glassmorphism & Bento UI with micro border-radius (2px - 10px).

**Architecture:** Independent three-tier architecture where `tm-shared` acts as a local PNPM package/layers monorepo, while `tm-cms` and `tm-web` are standalone Nuxt 4 apps extending shared base and customer layers via local paths (`link:` and `extends:`). UI design uses Nuxt UI v4 + Tailwind CSS v4 with glassmorphism tokens (`.udmt-backdrop`, `.panel`) from `D:\Applications\tm-data-manager\app` and high-productivity patterns from `D:\Applications\tm-tools`.

**Tech Stack:** Nuxt 4, Vue 3, Nuxt UI v4 (@nuxt/ui), Tailwind CSS v4, Zod, TypeScript, PNPM Workspaces, Lucide Icons.

**Spec:** `docs/superpowers/specs/2026-11-02-tm-websites-scaffolding-design.md`

## Global Constraints
- Do NOT merge `tm-cms` and `tm-web` into a single monolithic app.
- Rendering modes: `tm-cms` MUST have `ssr: false`; `tm-web` MUST have `ssr: true`.
- Radius scale: Strict micro radius tokens `2px`, `4px`, `6px`, `8px`, `10px` (`radius-2` to `radius-10`).
- Icon economy: Single family (`i-lucide-*`), no duplicate text/icon pairs.
- No client-side Mongoose or database credentials.

## Review Focus
- Local package resolution: ensure `tm-cms` and `tm-web` can resolve `@tm/*` without npm registry errors.
- Micro-radius consistency: cards and modals use `rounded-[4px]`, `rounded-[6px]`, or `rounded-[8px]`, avoiding large default radii.
- Ambient backdrop: `.udmt-backdrop` is inert (`pointer-events-none`) and layered behind content (`z-0`).
- Customer layer overrides: customer layers must cleanly override `app.config.ts` without breaking base layer functionality.
- Satellite Hub compatibility: `useHub()` interface provides seamless reactive state and token handling.

---

### Task 1: Scaffold `tm-shared` Monorepo Root & Core Packages

**Files:**
- Create: `tm-shared/package.json`
- Create: `tm-shared/pnpm-workspace.yaml`
- Create: `tm-shared/tsconfig.base.json`
- Create: `tm-shared/packages/flow-contracts/package.json`
- Create: `tm-shared/packages/flow-contracts/src/index.ts`
- Create: `tm-shared/packages/flow-contracts/src/common.ts`
- Create: `tm-shared/packages/flow-contracts/src/auth.ts`
- Create: `tm-shared/packages/flow-contracts/src/catalog.ts`
- Create: `tm-shared/packages/flow-utils/package.json`
- Create: `tm-shared/packages/flow-utils/src/index.ts`
- Create: `tm-shared/packages/flow-config/package.json`
- Create: `tm-shared/packages/flow-config/src/index.ts`
- Create: `tm-shared/packages/flow-config/src/schema.ts`
- Create: `tm-shared/packages/design-system/package.json`
- Create: `tm-shared/packages/design-system/css/index.css`
- Create: `tm-shared/packages/design-system/css/tokens.css`
- Create: `tm-shared/packages/design-system/css/glass.css`
- Create: `tm-shared/packages/design-system/css/bento.css`

**Interfaces:**
- Produces: `@tm/flow-contracts` (Zod schemas: `UserSchema`, `TenantSchema`, `ProductSchema`, `ApiResponseSchema`), `@tm/flow-utils` (helpers: `formatDate`, `formatCurrency`, `slugify`), `@tm/flow-config` (schema: `CustomerConfigSchema`, `parseCustomerConfig`), `@tm/design-system` (CSS tokens for Glassmorphism & Bento).

- [ ] **Step 1: Create `tm-shared` root manifest and pnpm-workspace.yaml**
- [ ] **Step 2: Implement `@tm/flow-contracts` with Zod schemas and TypeScript types**
- [ ] **Step 3: Implement `@tm/flow-utils` with formatting and slug utilities**
- [ ] **Step 4: Implement `@tm/flow-config` with customer configuration validator**
- [ ] **Step 5: Implement `@tm/design-system` with Linear Flat Glassmorphism & Bento tokens from `tm-data-manager/app`**

---

### Task 2: Scaffold `tm-shared` Nuxt Base Layers

**Files:**
- Create: `tm-shared/packages/nuxt-layer-core/package.json`
- Create: `tm-shared/packages/nuxt-layer-core/nuxt.config.ts`
- Create: `tm-shared/packages/nuxt-layer-core/app/app.config.ts`
- Create: `tm-shared/packages/nuxt-layer-api-base/package.json`
- Create: `tm-shared/packages/nuxt-layer-api-base/nuxt.config.ts`
- Create: `tm-shared/packages/nuxt-layer-api-base/server/utils/apiResponse.ts`
- Create: `tm-shared/packages/nuxt-layer-config-base/package.json`
- Create: `tm-shared/packages/nuxt-layer-config-base/nuxt.config.ts`
- Create: `tm-shared/packages/nuxt-layer-config-base/app/composables/useCustomerConfig.ts`
- Create: `tm-shared/packages/nuxt-layer-cms-base/package.json`
- Create: `tm-shared/packages/nuxt-layer-cms-base/nuxt.config.ts`
- Create: `tm-shared/packages/nuxt-layer-cms-base/app/components/CmsBasePage.vue`
- Create: `tm-shared/packages/nuxt-layer-cms-base/app/components/BentoCard.vue`
- Create: `tm-shared/packages/nuxt-layer-web-base/package.json`
- Create: `tm-shared/packages/nuxt-layer-web-base/nuxt.config.ts`
- Create: `tm-shared/packages/nuxt-layer-web-base/app/components/WebBasePage.vue`

**Interfaces:**
- Consumes: `@tm/design-system`, `@tm/flow-config`, `@tm/flow-contracts`.
- Produces: Nuxt layers `nuxt-layer-core`, `nuxt-layer-api-base`, `nuxt-layer-config-base`, `nuxt-layer-cms-base`, `nuxt-layer-web-base`.

- [ ] **Step 1: Scaffold `nuxt-layer-core` importing `@tm/design-system` and configuring Nuxt UI v4**
- [ ] **Step 2: Scaffold `nuxt-layer-api-base` with standard API response handlers and error formatting**
- [ ] **Step 3: Scaffold `nuxt-layer-config-base` with `useCustomerConfig` composable**
- [ ] **Step 4: Scaffold `nuxt-layer-cms-base` with `CmsBasePage` and `BentoCard` primitives**
- [ ] **Step 5: Scaffold `nuxt-layer-web-base` with `WebBasePage` primitive**

---

### Task 3: Scaffold Customer Layers in `tm-shared`

**Files:**
- Create: `tm-shared/packages/customer-layers/cms/sentuan-cms/package.json`
- Create: `tm-shared/packages/customer-layers/cms/sentuan-cms/nuxt.config.ts`
- Create: `tm-shared/packages/customer-layers/cms/sentuan-cms/app/app.config.ts`
- Create: `tm-shared/packages/customer-layers/cms/bag-post-cms/package.json`
- Create: `tm-shared/packages/customer-layers/cms/bag-post-cms/nuxt.config.ts`
- Create: `tm-shared/packages/customer-layers/cms/bag-post-cms/app/app.config.ts`
- Create: `tm-shared/packages/customer-layers/cms/thanh-tung/package.json`
- Create: `tm-shared/packages/customer-layers/cms/thanh-tung/nuxt.config.ts`
- Create: `tm-shared/packages/customer-layers/cms/thanh-tung/app/app.config.ts`
- Create: `tm-shared/packages/customer-layers/cms/hoang-vi/package.json`
- Create: `tm-shared/packages/customer-layers/cms/hoang-vi/nuxt.config.ts`
- Create: `tm-shared/packages/customer-layers/cms/hoang-vi/app/app.config.ts`
- Create: `tm-shared/packages/customer-layers/web/sentuan/package.json`
- Create: `tm-shared/packages/customer-layers/web/sentuan/nuxt.config.ts`
- Create: `tm-shared/packages/customer-layers/web/sentuan/app/app.config.ts`
- Create: `tm-shared/packages/customer-layers/web/bag-post/package.json`
- Create: `tm-shared/packages/customer-layers/web/bag-post/nuxt.config.ts`
- Create: `tm-shared/packages/customer-layers/web/bag-post/app/app.config.ts`

**Interfaces:**
- Consumes: Base layers.
- Produces: Customer presets customizing theme branding, logos, and entitlements.

- [ ] **Step 1: Scaffold CMS customer layers (`sentuan-cms`, `bag-post-cms`, `thanh-tung`, `hoang-vi`)**
- [ ] **Step 2: Scaffold Web customer layers (`sentuan`, `bag-post`)**

---

### Task 4: Scaffold `tm-cms` (Nuxt 4 SPA Base Application)

**Files:**
- Create: `tm-cms/package.json`
- Create: `tm-cms/nuxt.config.ts`
- Create: `tm-cms/tsconfig.json`
- Create: `tm-cms/customer.config.ts`
- Create: `tm-cms/app/app.vue`
- Create: `tm-cms/app/app.config.ts`
- Create: `tm-cms/app/layouts/default.vue`
- Create: `tm-cms/app/pages/index.vue`
- Create: `tm-cms/app/composables/useHub.ts`
- Create: `tm-cms/server/api/auth/session.get.ts`
- Create: `tm-cms/server/api/auth/login.post.ts`
- Create: `tm-cms/server/api/auth/logout.post.ts`
- Create: `tm-cms/i18n/locales/en.json`
- Create: `tm-cms/i18n/locales/vi.json`
- Create: `tm-cms/AGENTS.md`

**Interfaces:**
- Consumes: `nuxt-layer-cms-base`, `@tm/flow-contracts`, `@tm/flow-config`.
- Produces: Standalone Nuxt 4 SPA admin app.

- [ ] **Step 1: Create `tm-cms/package.json` and `nuxt.config.ts` with `ssr: false` extending `nuxt-layer-cms-base`**
- [ ] **Step 2: Scaffold layout with `.udmt-backdrop`, sidebar, and glassmorphic navbar**
- [ ] **Step 3: Scaffold Bento Dashboard page (`app/pages/index.vue`) using `CmsBasePage` and `BentoCard`**
- [ ] **Step 4: Scaffold `useHub.ts` and Nitro BFF auth endpoints**
- [ ] **Step 5: Create `customer.config.ts`, i18n locales, and `AGENTS.md` for AI agent developers**

---

### Task 5: Scaffold `tm-web` (Nuxt 4 SSR/Hybrid Base Application)

**Files:**
- Create: `tm-web/package.json`
- Create: `tm-web/nuxt.config.ts`
- Create: `tm-web/tsconfig.json`
- Create: `tm-web/customer.config.ts`
- Create: `tm-web/app/app.vue`
- Create: `tm-web/app/app.config.ts`
- Create: `tm-web/app/layouts/default.vue`
- Create: `tm-web/app/pages/index.vue`
- Create: `tm-web/app/pages/[...slug].vue`
- Create: `tm-web/app/composables/useSiteContext.ts`
- Create: `tm-web/i18n/locales/en.json`
- Create: `tm-web/i18n/locales/vi.json`
- Create: `tm-web/AGENTS.md`

**Interfaces:**
- Consumes: `nuxt-layer-web-base`, `@tm/flow-contracts`, `@tm/flow-config`.
- Produces: Standalone Nuxt 4 SSR/Hybrid public web app.

- [ ] **Step 1: Create `tm-web/package.json` and `nuxt.config.ts` with `ssr: true` extending `nuxt-layer-web-base`**
- [ ] **Step 2: Scaffold public storefront layout with glass header and footer**
- [ ] **Step 3: Scaffold index hero showcase and universal slug resolver (`[...slug].vue`)**
- [ ] **Step 4: Scaffold `useSiteContext.ts`, `customer.config.ts`, i18n locales, and `AGENTS.md`**

---

### Task 6: Workspace Tooling, Central Scripts & Verification

**Files:**
- Create: `scripts/generate-customer.ts`
- Create: `scripts/verify-scaffold.ts`
- Modify: Root or project scripts for one-click setup and layer verification

- [ ] **Step 1: Write verification script checking directory integrity and export resolutions**
- [ ] **Step 2: Run verification script and confirm all 3 projects and customer layers are properly scaffolded**

