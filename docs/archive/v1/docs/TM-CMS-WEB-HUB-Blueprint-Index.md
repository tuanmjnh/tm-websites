# TM Customer Web Solution — Architecture Blueprint Index

> Bộ tài liệu triển khai `tm-cms` + `tm-web` và phần bổ sung tương thích cho `tm-hub`.
>
> Định hướng: **Two Independent Nuxt Applications · Shared NPM Foundation · Independent APIs · Tenant-Isolated Customer Data · Central TM Hub IAM**.

---

## 1. Files in this package

| File | Scope | Dùng khi |
|---|---|---|
| `TM-Shared-Packages-Architecture.md` | PNPM monorepo nguồn package, private registry, Zod, TypeScript types, DTOs, utils, domain rules, design tokens, Nuxt Layers, versioning | Xây source of truth cho package dùng chung trước/đồng thời với app |
| `TM-CMS-Project-Blueprint.md` | `tm-cms` Nuxt 4 SPA, admin shell, BasePage, CMS APIs, module nghiệp vụ, TM Hub auth, customer DB, AI Workspace, PWA | Xây ứng dụng quản trị CMS/ERP |
| `TM-WEB-Project-Blueprint.md` | `tm-web` Nuxt 4 SSR/Hybrid, minimal Web Base Layer, public APIs, slug resolver, SEO, ISR/cache, custom websites, public AI | Xây website giới thiệu sản phẩm và website custom |
| `TM-Hub-Tenant-App-Installation-Upgrade.md` | Đánh giá roadmap Hub hiện có và bổ sung Tenant, App Installation, site, config/media scope, service identity | Chỉ nâng cấp phần Hub còn thiếu sau Phase 0 audit |
| `TM-CMS-TM-Web-Architecture-v2.2.md` | Blueprint tổng quan trước khi tách thành các tài liệu chuyên biệt | Lưu làm tài liệu lịch sử/overview; không thay thế các spec chi tiết bên trên |

Hai tài liệu `nuxt4-cms.md` và `nuxt4-website.md` là frozen technical references cho hệ thống cũ. Không sửa trực tiếp các codebase cũ; dùng chúng để inventory và migrate có kiểm soát.

## 2. Architecture decisions — source of truth

### 2.1. Applications

- `tm-cms`: Nuxt 4 SPA (`ssr: false`) cho quản trị nghiệp vụ.
- `tm-web`: Nuxt 4 SSR/Hybrid cho public website, SEO và trải nghiệm khách hàng.
- Khách hàng có thể chỉ dùng CMS hoặc dùng cặp CMS + Web.
- Website có thể dùng starter UI hoặc custom hoàn toàn.
- Cả hai app là project/repository/deployment độc lập.

### 2.2. Customer and data isolation

- `tenantId`: khách hàng sở hữu dữ liệu.
- `appId`: app installation cụ thể đã đăng ký trong TM Hub.
- `appCode`: loại sản phẩm logic, ví dụ `tm-cms` hoặc `tm-web`.
- `siteId`: website/channel thuộc tenant.
- Mỗi khách hàng có database riêng (khuyến nghị logical MongoDB database per customer trên cùng cluster nếu phù hợp).
- CMS và Web của cùng khách hàng dùng chung DB của tenant đó, nhưng có API/repository/query riêng.
- Website DB credential ưu tiên read-only; public writes chỉ qua command path hẹp.

### 2.3. Identity

- TM Hub là nguồn xác thực trung tâm.
- Mặc định một global User có thể là member của nhiều tenant; membership, roles và permissions được scope theo tenant/app installation.
- Dùng quyền ở CMS app installation để kiểm soát thao tác admin.
- Public visitor của Web không cần TM Hub user login.
- Web server có service identity riêng, không gửi credential xuống browser.

### 2.4. Shared code vs independent logic

Shared NPM packages:

- Zod schemas, DTOs và TypeScript types.
- Common enums, pure utils, shared domain invariants.
- Customer/brand/site config schemas.
- Design tokens và optional low-level UI primitives.
- Optional server-only Mongoose model package nếu có lợi và test được.
- Nuxt Layers nền tảng.

Không share:

- CMS API endpoint/service/query implementation với Web API.
- CMS admin UI với public website UI.
- CMS admin DTO với Web public DTO.
- Repository/query policy khác nghiệp vụ.

### 2.5. Nuxt Layers

`tm-cms` extends:

- Core Layer.
- API Base Layer.
- Config Base Layer.
- CMS Base Layer.
- Optional CMS module layers.

`tm-web` minimal extends:

- Core Layer.
- API Base Layer.
- Config Base Layer.
- Web Base Layer.

`tm-web` có thể thêm Storefront Starter khi muốn dùng template sẵn. Fully custom website không phải kế thừa Storefront Starter.

### 2.6. Design System

- One centralized design token source.
- Linear Flat Glassmorphism & Bento UI preset.
- Compact radius 2/4/6/8/10px.
- Controlled Aurora Mesh, glowing orbs, isometric grid and refractive glass effects.
- No scattered module-level CSS that redefines colors/radius/shadow/glass tokens.
- Customer-specific brand values are validated config/CSS variables, not hardcoded in modules.
- `CmsBasePage` and `WebBasePage` share page composition principles but are not forced to be one UI implementation.

### 2.7. Responsive page actions

- Desktop: page-level actions in header/top region.
- Mobile: page-level actions in footer/bottom action dock.
- CMS global bottom navigation is separate from page action dock.
- Website global content footer is separate from page action dock.
- BasePage implementations must avoid duplicate interactive controls, hydration mismatch and content overlap.

### 2.8. Components

- Components are small enough to have clear responsibilities, not artificially split into trivial fragments.
- Group components by technical role and business domain.
- Pages orchestrate; components render; composables coordinate client behavior; server services enforce business logic.
- Use `Lazy` prefix selectively for heavy, conditional components.
- Do not lazy-load SEO-critical content, essential navigation or primary above-the-fold content without evidence.

---

## 3. Recommended implementation order

```text
Phase A — Read-only audits
  ├── Audit TM Hub actual source/schema/API/SDK
  ├── Audit legacy nuxt4-cms source
  └── Audit legacy nuxt4-website source

Phase B — Shared foundation
  ├── PNPM package workspace + private registry + Changesets
  ├── flow-contracts (Zod, DTO, types)
  ├── flow-config + flow-utils
  ├── design-system (central CSS tokens)
  └── Nuxt Core / API Base / Config Base Layers

Phase C — Hub compatibility gap
  ├── Add tenant/app-installation ownership only where absent
  ├── Pair CMS + Web installations under tenantId
  ├── Confirm membership and token context
  ├── Add site/public config scope if needed
  └── Add same-tenant public Media access if needed

Phase D — CMS foundation
  ├── Nuxt CMS SPA and CMS Layers
  ├── Central Design System + CmsBasePage
  ├── TM Hub authentication and authorization
  ├── Tenant-specific DB connection
  └── CMS API boundaries

Phase E — Web foundation
  ├── Nuxt Web SSR and minimal Web Layers
  ├── Site context and public DB read policy
  ├── Web API/public DTOs
  ├── SEO and universal slug resolver
  ├── Cache/ISR and signed invalidation
  └── Optional storefront starter/custom website fixture

Phase F — Migration and launch
  ├── Migrate modules by domain
  ├── Per-customer branding/assets
  ├── Integration and tenant isolation tests
  ├── Preview/production Vercel deployment
  └── Rollback and operator documentation
```

Do not start all phases in parallel. Shared package contracts and Hub identity/context boundaries should be stable before consuming apps depend on them.

## 4. TM Hub review — conclusion from the supplied roadmap

The uploaded Hub roadmap has a solid app-scoped IAM baseline:

- App Registry.
- App Membership.
- Roles and permissions scoped by `appId`.
- Routes calculated from permissions.
- Backend resource ownership checks by `appId`.
- App-scoped Remote Config, Media and Notifications.
- Official SDK and `tm-tools` backward compatibility.

But the supplied roadmap does not explicitly define a Tenant grouping two app installations belonging to one customer, nor `siteId`/shared media access for CMS-uploaded assets used by that customer's public Website.

The Hub addendum recommends an additive interpretation:

- One App record represents one concrete installation.
- `appId` is unique per customer app deployment.
- `appCode` identifies `tm-cms` or `tm-web`.
- `tenantId` links the CMS and Web deployments to the same customer.
- Keep existing roles/permissions app-scoped.
- Keep global User identity by default; scope memberships and roles by tenant/app.
- Add only missing Site/config/media/service capability features.

**Do not apply the Hub addendum blindly.** It explicitly requires a read-only Phase 0 audit. If the actual `tm-hub` code already implements an equivalent requirement, mark it complete and do not build a duplicate model/API.

## 5. Mandatory conventions for the AI coding agent

1. Read all four detailed specification files before modifying app code.
2. Read repository-level `AGENTS.md`, README, scripts, lockfiles and deployment notes.
3. Start with Phase 0 read-only audit for each repository.
4. Treat old `nuxt4-cms` and `nuxt4-website` projects as frozen references.
5. Do not ask the user to repeat decisions documented here. Resolve non-blocking ambiguities using the defaults in each spec and record them.
6. Do not invent API endpoints, database fields, secrets, customer IDs or current code behavior; inspect actual implementation.
7. Prefer additive changes and backward compatibility.
8. Do not share CMS and Web repositories/query implementations merely because both use the same database.
9. Do not expose secrets, database credentials, Hub credentials or AI provider keys to browser bundles.
10. Do not use frontend route/menu filtering as authorization.
11. Do not claim tests/build/migration/deployment passed unless actually executed.
12. After each phase report files inspected/created/modified, API/schema/DB changes, security impact, migration/rollback, commands and test results.

### Required Phase 0 report template

```text
PROJECT:
PHASE: 0 — READ-ONLY AUDIT
Status: Complete / Partial / Blocked

Current architecture:
Actual framework/runtime versions:
Current app rendering/deployment mode:
Current routes/APIs:
Current data models/collections/indexes:
Current schemas/types:
Current auth/tenant/app context:
Current shared packages/layers:
Current components/BasePage/design system:
Current cache/SEO/branding:

Already compliant:
Partially compliant:
Missing:
Conflicts with specification:
Security/data-isolation risks:
Backward compatibility risks:

Files inspected:
Files proposed for Phase 1:
Migration strategy:
Tests/commands available:
Exact Phase 1 execution plan:
```

---

## 6. Official technical references

- Nuxt 4 Layers: https://nuxt.com/docs/4.x/getting-started/layers
- Nuxt rendering modes: https://nuxt.com/docs/4.x/guide/concepts/rendering
- Nuxt UI v4 theme/design system: https://ui.nuxt.com/docs/getting-started/theme
- Nuxt runtime config: https://nuxt.com/docs/4.x/api/composables/use-runtime-config
- Vercel Nuxt deployment: https://vercel.com/docs/frameworks/full-stack/nuxt
- PNPM workspaces: https://pnpm.io/workspaces
- Zod: https://zod.dev/
- Changesets: https://github.com/changesets/changesets
