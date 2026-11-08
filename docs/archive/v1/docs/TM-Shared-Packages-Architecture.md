# TM Shared Packages — Architecture & Implementation Specification

> **Vai trò:** Tài liệu nền tảng bắt buộc cho `tm-cms`, `tm-web` và các website Nuxt tùy biến thuộc hệ sinh thái TM.
>
> **Mục tiêu:** Phát triển một nguồn code dùng chung, publish thành private NPM packages có version; không sao chép Zod schemas, TypeScript types, DTOs, pure utilities, shared domain rules, design tokens hoặc Nuxt base layers giữa các ứng dụng.
>
> **Mô hình phát triển:** PNPM Monorepo + Changesets + private NPM-compatible registry.
>
> **Nguyên tắc quan trọng:** Shared Packages không đồng nghĩa với shared API implementation. CMS API và Website API độc lập.

---

## 0. Quyết định kiến trúc đã chốt

1. Tạo repository riêng `tm-platform-packages` để phát triển, kiểm thử và phát hành package.
2. Dùng `pnpm` workspace trong repository package; dùng Changesets + SemVer để version/release.
3. Consumer projects cài package đã publish từ private registry, không import bằng đường dẫn source tương đối trong production.
4. `tm-cms` và `tm-web` là hai Nuxt 4 projects/repositories độc lập.
5. Cả hai app kế thừa Nuxt Layers phù hợp với vai trò của app.
6. Shared contracts dùng Zod làm nguồn validation/type inference có chủ đích; không duy trì hai bộ type và schema độc lập.
7. Shared persistence models là package server-only, tùy chọn theo domain; tuyệt đối không để browser bundle import Mongoose.
8. Repository, API controller, query services và endpoint business-specific thuộc app/API tương ứng.
9. Design tokens và CSS nền tảng có một nguồn duy nhất. Module không tự định nghĩa lại hệ màu, radius, shadow, glass surface hoặc effect.
10. Không tạo package mới chỉ vì có thể tách; chỉ tách khi có boundary, versioning hoặc consumer độc lập thực sự.
11. `tm-hub-client` là SDK riêng để kết nối TM Hub; không trộn logic IAM vào `flow-contracts`.
12. Không publish secrets, customer database credentials, private customer config hoặc asset riêng của khách lên package registry.

## 1. Repository layout

```text
tm-platform-packages/
├── packages/
│   ├── shared-kernel/
│   ├── flow-contracts/
│   ├── flow-config/
│   ├── flow-utils/
│   ├── flow-domain/
│   ├── flow-db-models/             # server-only, nếu thật sự dùng chung
│   ├── design-system/
│   ├── ui-primitives/
│   ├── nuxt-layer-core/
│   ├── nuxt-layer-api-base/
│   ├── nuxt-layer-config-base/
│   ├── nuxt-layer-cms-base/
│   ├── nuxt-layer-web-base/
│   └── nuxt-layer-storefront-starter/ # optional
│
├── apps/
│   └── playground/                 # Nuxt consumer kiểm thử package/layer
│
├── scripts/
│   ├── validate-workspace.ts
│   ├── check-package-exports.ts
│   ├── check-dependency-boundaries.ts
│   └── release-report.ts
│
├── .changeset/
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── package.json
├── tsconfig.base.json
└── turbo.json                      # optional, chỉ thêm nếu workflow cần
```

### 1.1. Package naming

| Package | Mục tiêu | Browser-safe? |
|---|---|---:|
| `@tm/shared-kernel` | ID primitives, result types, pagination primitives, common errors | Có |
| `@tm/flow-contracts` | Zod schemas, DTOs, enums, request/response contracts | Có nếu entrypoint không chứa server code |
| `@tm/flow-config` | Customer, CMS, site, brand, module config schema + parser | Có với public projection; private config chỉ server |
| `@tm/flow-utils` | Pure helpers: date, money, slug, locale, safe parsing | Có |
| `@tm/flow-domain` | Pure business rules độc lập framework/database | Có nếu chỉ chứa pure code |
| `@tm/flow-db-models` | Mongoose schema/model definitions và model registration | **Không** |
| `@tm/design-system` | CSS entrypoint, tokens, theme presets, visual effects | CSS/shared |
| `@tm/ui-primitives` | Vue components cấp thấp dùng chung | SSR-safe nếu component hỗ trợ |
| `@tm/nuxt-layer-*` | Nuxt config, layouts, components, composables, server utilities theo layer | Nuxt-only |
| `tm-hub-client` | SDK kết nối TM Hub theo API SDK đã công bố | Theo từng API của SDK |

Tên package cuối cùng phải được kiểm tra namespace/registry và package manifest thực tế trước khi publish. Không tự ý đổi package đang được consumer sử dụng.

### 1.2. Bắt đầu tối thiểu

Không cần tạo mọi package trong ngày đầu. Thứ tự khởi tạo:

1. `@tm/flow-contracts`
2. `@tm/flow-config`
3. `@tm/flow-utils`
4. `@tm/design-system`
5. Nuxt layers nền tảng: `core`, `api-base`, `config-base`
6. `@tm/flow-domain` khi đã xác định được pure business rules dùng chung
7. `@tm/flow-db-models` khi hai API cùng cần đúng persistence model và đã có compatibility tests
8. `@tm/ui-primitives` nếu component cần dùng chung qua nhiều Nuxt apps
9. CMS/Web-specific layers và optional storefront starter

Không tách package quá nhỏ chỉ theo folder. Mỗi package cần có ownership, purpose, dependency graph, exports và policy versioning rõ ràng.

## 2. Dependency boundaries

```text
shared-kernel
     ↑
     ├──────────── flow-contracts (Zod + DTO + types)
     ├──────────── flow-config
     ├──────────── flow-utils
     └──────────── flow-domain

flow-db-models (server-only) ──> shared contracts/types khi phù hợp
ui-primitives ────────────────> design-system / Vue / Nuxt UI peer deps
nuxt-layer-core ─────────────> design-system / shared utils
nuxt-layer-api-base ─────────> shared-kernel / contracts
nuxt-layer-config-base ──────> flow-config
nuxt-layer-cms-base ─────────> core + config + API base + UI primitives
nuxt-layer-web-base ─────────> core + config + API base + SEO utilities
```

### 2.1. Cấm dependency

- `flow-contracts` không phụ thuộc Nuxt, Vue, Mongoose, database driver hoặc API runtime.
- `flow-domain` không phụ thuộc Nuxt, Vue, Nitro, Mongoose hoặc HTTP client cụ thể.
- `flow-db-models` không được import từ client code.
- `flow-api-client` (nếu tạo sau này) không import database models/repositories.
- Nuxt layer không được tạo dependency vòng với app consumer.
- Website UI không import CMS components chỉ để dùng lại một control; đưa control phù hợp vào `ui-primitives`.
- `tm-hub-client` không trở thành package chứa business logic CMS/Website.

CI phải kiểm tra dependency graph để phát hiện cycle và forbidden imports.

## 3. Contracts: Zod là nguồn định nghĩa có kiểm soát

### 3.1. Cấu trúc đề xuất

```text
packages/flow-contracts/src/
├── common/
│   ├── identifiers.schema.ts
│   ├── pagination.schema.ts
│   ├── sorting.schema.ts
│   ├── locale.schema.ts
│   ├── money.schema.ts
│   ├── api-error.schema.ts
│   └── timestamps.schema.ts
├── product/
│   ├── product.enums.ts
│   ├── product.entity.schema.ts
│   ├── product-admin.dto.schema.ts
│   ├── product-public.dto.schema.ts
│   ├── product-command.schema.ts
│   └── product-query.schema.ts
├── category/
├── attributes/
├── content/
├── media/
├── inventory/
├── commerce/
├── finance/
├── hr/
├── customer/
├── supplier/
├── site/
├── tenant/
└── index.ts
```

Chỉ tạo domain folder khi có model/contract thật. Không dựng schema placeholder không có consumer.

### 3.2. Bốn khái niệm phải tách biệt

| Khái niệm | Ý nghĩa | Ví dụ |
|---|---|---|
| Persistence model | Cấu trúc lưu trong database | Mongoose `Item` document |
| Domain entity/type | Khái niệm nghiệp vụ trong code | `Product` |
| Input/Command schema | Payload client được phép gửi | `CreateProductInput` |
| Output DTO | Payload app được phép nhận | `AdminProductDTO`, `PublicProductDTO` |

Không trả nguyên Mongoose document ra API. Không dùng schema create/update để validate output DTO.

### 3.3. Naming conventions

- `ProductStatusSchema`, `CreateProductInputSchema`, `UpdateProductInputSchema`.
- `AdminProductDTOSchema`, `PublicProductDTOSchema`.
- `AdminProductQuerySchema`, `PublicProductQuerySchema`.
- Type names lấy từ `z.infer`, `z.input`, `z.output` khi phù hợp.
- Các DTO admin/public phải tách rõ. Public DTO tuyệt đối không có cost, margin, vendor private data, internal notes, finance/HR fields hoặc secret.

### 3.4. Example

```ts
import { z } from 'zod'

export const ProductStatusSchema = z.enum([
  'draft',
  'published',
  'archived',
])

export const CreateProductInputSchema = z.object({
  sku: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(1).max(180),
  name: z.string().trim().min(1).max(240),
  description: z.string().optional(),
  categoryIds: z.array(z.string()).default([]),
})

export const UpdateProductInputSchema = CreateProductInputSchema.partial()

export const PublicProductDTOSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  excerpt: z.string().optional(),
  images: z.array(z.object({
    url: z.string().url(),
    alt: z.string().optional(),
  })),
  status: z.literal('published'),
})

export type CreateProductInput = z.input<typeof CreateProductInputSchema>
export type UpdateProductInput = z.input<typeof UpdateProductInputSchema>
export type PublicProductDTO = z.output<typeof PublicProductDTOSchema>
```

Đây là ví dụ shape, không phải chỉ thị thay schema `Item` legacy. Trước migration phải đọc model/schema đang tồn tại và giữ tương thích dữ liệu.

### 3.5. Không ép API giống nhau

Contracts có thể chia sẻ phần entity và data primitives, nhưng query schemas/DTOs phải phản ánh use case:

- CMS: `AdminProductQuery`, `AdminProductDTO`, command input, bulk action input.
- Web: `PublicCatalogQuery`, `PublicProductDTO`, `PublicCategoryDTO`, homepage projection.
- Cùng một collection Product/Item không có nghĩa CMS và Website phải trả cùng response payload.

## 4. Config package

### 4.1. Config domains

```text
@tm/flow-config
├── customer.config.ts
├── app-installation.config.ts
├── cms.config.ts
├── site.config.ts
├── brand.config.ts
├── module-entitlements.config.ts
├── pwa.config.ts
├── seo.config.ts
├── feature-flags.config.ts
└── public-projection.ts
```

### 4.2. Customer vs app vs site

- `tenantId`: khách hàng/tổ chức sở hữu dữ liệu.
- `appId`: app installation đã đăng ký trong TM Hub (CMS của customer hoặc Web của customer).
- `appKind`: `cms`, `web`, `service`, hoặc loại app đã thống nhất.
- `siteId`: website/channel trong tenant.
- `customerConfigId`: ID cấu hình build/deployment, không thay thế security identity.

Một customer có thể có CMS và nhiều website. Một CMS-only customer không cần site config.

### 4.3. Public/private split

- `parseCustomerConfig()` chỉ parse trusted server/build config.
- `toPublicSiteConfig()` tạo allow-listed projection.
- Không serialize DB URI, Hub secrets, provider credentials, signing keys, cache revalidation secret hoặc private integration settings.
- Browser chỉ nhận public fields.

## 5. Domain utilities

Chỉ đặt pure deterministic helpers vào package này:

- Money arithmetic/format primitives (không thay thế business accounting service).
- Slug normalization.
- Locale fallback.
- Date display/serialization helpers (timezone explicit).
- Pagination normalization.
- Safe string/number parsing.
- Media metadata normalization.

Không đưa vào:

- `useFetch`, `useAsyncData`, Pinia, Vue composables.
- Direct MongoDB access.
- Nuxt `useRuntimeConfig`.
- CMS API calls.
- Website cache handlers.
- Customer-specific constants.

Composable dành riêng Nuxt có thể nằm trong Nuxt layer tương ứng.

## 6. Shared domain rules

Chỉ chia sẻ rule nếu cả CMS và Website thực sự cần cùng một invariant hoặc calculation. Ví dụ:

- Product publish eligibility predicate (không thay query lấy dữ liệu).
- Money value normalization.
- Shared enum transitions nếu nghiệp vụ thực sự giống.
- Slug/locale invariant.

Không chia sẻ `ProductService` chứa toàn bộ CMS CRUD và Website read query. Repository và application use cases nằm ở mỗi app.

## 7. Database models (server-only, optional)

### 7.1. Khi nào nên dùng

Chỉ publish `@tm/flow-db-models` khi:

- CMS API và Website API phải đọc cùng collection schemas.
- Cần ngăn schema drift giữa 2 source.
- Mongoose model definitions có thể được dùng độc lập với connection.
- Đã có tests cho indexes, serialization, strict mode và model registration.

### 7.2. Không đưa repository vào shared DB package

`flow-db-models` có thể chứa:

- Mongoose schema/model factory.
- Index definitions.
- Persistence-level types.
- Model registration helper không giữ global connection assumptions.

Không chứa:

- `findPublishedCatalog()`.
- `findForAdmin()`.
- Site resolver query.
- CMS report aggregation.
- Website cache/query policy.

Hai API có repositories riêng.

### 7.3. Runtime safety

- Package phải có server-only entrypoint (`./server`) hoặc package độc lập.
- Không export models từ browser-safe root entry.
- Test build client để bảo đảm Mongoose không bị bundle vào client.
- Model registry phải xử lý hot reload / model already compiled theo convention Mongoose hiện dùng.

## 8. Design system package

### 8.1. Single CSS entrypoint

```text
@tm/design-system/
├── css/
│   ├── index.css
│   ├── tokens.css
│   ├── semantic-colors.css
│   ├── themes.css
│   ├── surfaces.css
│   ├── effects-aurora.css
│   ├── effects-glass.css
│   ├── effects-grid.css
│   ├── motion.css
│   └── accessibility.css
├── presets/
│   ├── tm-default.ts
│   └── compact-admin.ts
└── package.json
```

Consumer chỉ import `@tm/design-system/css/index.css` một lần. Các file nội bộ trong package có thể được chia để dễ bảo trì; không tạo CSS theo từng module nghiệp vụ ở consumer app.

### 8.2. Token categories

- Brand colors: primary, secondary, accent, focus.
- Semantic: success, warning, danger, info.
- Surface: app, panel, elevated, glass, overlay.
- Text: primary, secondary, muted, inverse.
- Border: subtle, default, strong, focus.
- Radius: 0, 2, 4, 6, 8, 10px compact scale.
- Spacing/density.
- Typography.
- Shadows/glow.
- Blur.
- Motion/easing/duration.
- Z-index.
- Breakpoints/container.

### 8.3. Runtime brand values

Brand color values phải được validate (hex/rgb/hsl allow-list phù hợp) trước khi set CSS custom properties. Không tạo Tailwind class bằng cách nối chuỗi dynamic. Runtime brand colors dùng CSS variable, Tailwind CSS v4 `@theme` map sang semantic token.

### 8.4. Visual direction

- Linear Flat: layout phẳng, thông tin rõ, ít decoration.
- Bento UI: nhóm nội dung có cấu trúc; không biến mọi block thành card.
- Glassmorphism: surface translucent, border mảnh, refractive highlight có kiểm soát.
- Aurora mesh: ambient backdrop, không đặt lớp tương phản thấp phía sau vùng chữ dày.
- Glowing 3D orbs: rất tiết chế, `pointer-events:none`, `aria-hidden`.
- Isometric grid: dùng ở hero/overview/background lớn, không phủ lên table/form.
- Motion: tôn trọng `prefers-reduced-motion`, không gây layout shift.

### 8.5. Governance

Không tạo `products.css`, `inventory.css`, `hr.css` chỉ để lặp lại màu/radius/shadow/glass. Nếu module cần style domain-specific, component có thể có scoped style nhưng phải dùng tokens và không khai báo lại hệ theme. Một variant được dùng lặp lại phải đưa vào design-system/component theme.

## 9. Vue UI primitives and Nuxt Layers

### 9.1. UI primitives

Có thể chia sẻ:

- Button/input primitives nếu muốn cùng interaction language.
- Modal/tooltip/popover primitives.
- Image/media display primitive.
- Status indicator.
- Empty/loading/error state primitive.

Không ép shared:

- CMS sidebar/dashboard/data table.
- Public site navbar/footer/hero/product page.
- CMS BasePage và Website BasePage implementation.

### 9.2. Nuxt Layer packages

- `@tm/nuxt-layer-core`: app setup conventions, shared composables cơ bản, error handling, base plugins, design system integration.
- `@tm/nuxt-layer-api-base`: server utilities, API error conventions, request IDs, schema validation helpers, security headers adapters; không có endpoint nghiệp vụ.
- `@tm/nuxt-layer-config-base`: trusted config parsing, brand/site public projection, runtime config mapping.
- `@tm/nuxt-layer-cms-base`: admin shell, CMS BasePage, action dock, navigation shell.
- `@tm/nuxt-layer-cms-modules`: optional reusable CMS module UI/features; bật theo entitlement/build.
- `@tm/nuxt-layer-web-base`: site context, SEO helpers, public API base, cache/revalidation abstractions; không áp đặt storefront UI.
- `@tm/nuxt-layer-storefront-starter`: optional starter UI, không bắt buộc website custom kế thừa.

### 9.3. Nuxt Layer rules

- Mỗi package layer có `nuxt.config.ts`, package metadata và explicit dependencies.
- Kiểm thử `extends` order, component auto-import, CSS import, aliases, module registration.
- App source có quyền override layers theo Nuxt resolution behavior; phải kiểm thử thực tế trước release.
- Không để hai layer tự động register trùng component/page/API mà không có policy.
- Layer chỉ cung cấp extension point/abstract primitives; không tạo coupling tới customer repo.

## 10. API client strategy

Không bắt buộc có API-client package chung cho business operations. CMS và Web có thể dùng wrappers riêng vì endpoint và auth/cache semantics khác nhau.

Nếu sau này có package HTTP helper chung, chỉ chứa:

- Typed transport abstraction.
- Timeout/abort.
- Standard error parsing.
- Request ID propagation.
- Zod response validation helper.

Không chứa endpoint `admin/products` hay `public/products` chung. Không chia sẻ token handling giữa public website và CMS nếu security boundary khác nhau.

## 11. Publishing and versioning

### 11.1. Registry

Dùng private registry được chọn trong repository setup. Không publish package chứa customer code/brand assets/secret. CI token có read/write scope tối thiểu.

### 11.2. SemVer

- Patch: backward-compatible bug fix.
- Minor: backward-compatible feature/optional field.
- Major: breaking exports/schema/type/runtime behavior.

Mọi thay đổi Zod schema phải được phân loại compatibility. Optional field thêm vào thường là minor; đổi requiredness, enum values, transform output hoặc field meaning có thể là breaking.

### 11.3. Changesets

Mỗi PR thay package behavior phải có changeset. CI:

1. Install frozen lockfile.
2. Lint/typecheck.
3. Unit tests.
4. Package build.
5. Exports smoke test.
6. Consumer playground build.
7. Changeset validation.
8. Publish từ protected branch/tag qua CI.

### 11.4. Consumer pinning

- Consumer package.json khai báo compatible range; lockfile pin exact resolved version.
- Production build sử dụng frozen lockfile.
- Không dùng `latest` tag làm dependency policy.
- Nâng cấp package qua PR riêng, chạy integration tests rồi mới deploy.
- Có rollback bằng lockfile/package version cũ.

## 12. Test strategy

- Zod unit tests cho valid/invalid payloads.
- DTO projection tests xác nhận private fields không thể leak public.
- Contract tests giữa CMS API và shared contracts.
- Compatibility tests cho Mongo documents legacy.
- Browser bundle tests xác nhận không bundle Mongoose/secret module.
- Nuxt layer playground build.
- SSR rendering smoke tests cho shared Vue components.
- Dependency boundary tests.
- Consumer compatibility matrix.

## 13. Rollout phases

### Phase 0 — Audit

- Audit `nuxt4-cms.md`, `nuxt4-website.md` đối chiếu source thực tế.
- Inventory 29 Zod schemas, 28 type files, 45 CMS models và 39 Website models được mô tả trong tài liệu tham chiếu; xác minh source thật vì hai inventory có thể lệch.
- Inventory utils, service types, shared model fields, consumer imports.
- Chọn registry và package names dựa trên manifests/namespace thực tế.
- Không di chuyển code trong phase này.

### Phase 1 — Workspace and release foundation

- Tạo pnpm monorepo.
- Setup Changesets, CI, package build, test runner, tsconfig.
- Tạo playground.
- Publish package thử nghiệm private.

### Phase 2 — Contracts extraction

- Tách schemas/types theo domain.
- Tạo entity/input/output DTO rõ ràng.
- Giữ legacy aliases khi cần.
- Unit tests và compatibility report.

### Phase 3 — Config and utils

- Tách config schemas và pure utils.
- Bổ sung public projection.
- Cấm secret serialization.

### Phase 4 — Design system

- Xây CSS entrypoint duy nhất.
- Token/semantic variables/theme presets.
- Storybook hoặc playground page (optional).
- Visual tests cho primitives.

### Phase 5 — Nuxt Layers

- Core, API base, config base.
- CMS base và Web base tách riêng.
- Optional storefront starter.
- Build test với cả SPA consumer lẫn SSR consumer.

### Phase 6 — DB models (conditional)

- Chỉ tách model thực sự trùng.
- Giữ repositories/services trong từng app.
- Verify models và index compatibility.

### Phase 7 — Consumer migration

- `tm-cms`: nâng package theo từng domain.
- `tm-web`: chỉ cài public/shared packages và Web Layers cần thiết.
- Custom website: chỉ kế thừa Web Core/Base.

## 14. Definition of Done

- [ ] Mọi package có owner, purpose, entrypoints, dependencies và tests.
- [ ] Contracts dùng Zod làm nguồn định nghĩa hợp lệ.
- [ ] CMS admin DTO và Web public DTO được tách.
- [ ] Public projection không thể trả private fields.
- [ ] No DB or secret imports in browser-safe packages.
- [ ] Database models package (nếu có) server-only.
- [ ] CMS/Web APIs không bị ép dùng chung query/service.
- [ ] Design tokens có một CSS entrypoint.
- [ ] Nuxt layers build được trong consumer playground.
- [ ] SemVer/Changesets và private registry hoạt động.
- [ ] Consumer có lockfile và version pinning.
- [ ] Rollback package version được kiểm thử.

## 15. Chỉ thị cho AI coding agent

1. Audit source/repositories và package registry trước khi code.
2. Không hỏi lại các quyết định đã ghi trong tài liệu này.
3. Nếu package name hoặc registry chưa tồn tại, dùng tên/registry đề xuất trong bản local implementation và ghi rõ bước publish cần credential; không giả lập đã publish.
4. Không sửa hai frozen reference projects trực tiếp.
5. Không đổi collection/schema phá dữ liệu để làm package extraction dễ hơn.
6. Không tạo API chung cho CMS và Web.
7. Không import database package vào browser.
8. Làm từng phase; mỗi phase phải có report file-level, tests và risks.
9. Nếu source implementation khác tài liệu tham chiếu, ghi discrepancy và chọn phương án ít breaking nhất.
10. Không tuyên bố test/build/release thành công nếu chưa chạy.

## 16. Official references

- Nuxt Layers: https://nuxt.com/docs/4.x/getting-started/layers
- Nuxt Authoring Layers: https://nuxt.com/docs/4.x/guide/going-further/layers
- Nuxt UI v4 design system: https://ui.nuxt.com/docs/getting-started/theme
- Zod: https://zod.dev/
- pnpm workspaces: https://pnpm.io/workspaces
- Changesets: https://github.com/changesets/changesets
- Tailwind CSS v4: https://tailwindcss.com/docs/theme
