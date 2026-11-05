# TM Platform — Vercel Multi-Customer Build & Nuxt Layers Architecture

> **Tài liệu triển khai dành cho AI coding agent**  
> **Mục tiêu:** Một Git repository chính chứa `tm-cms`, `tm-web`, `tm-shared` và Customer Layers. Nhiều Vercel Projects cùng kết nối repository này. Mỗi Vercel Project khai báo một `TM_CUSTOMER_ID`, tự chọn đúng Customer Layer khi build và tạo ra production artifact độc lập cho đúng khách hàng.  
> **CMS:** Nuxt 4 SPA (`ssr: false`).  
> **Website:** Nuxt 4 SSR (có thể dùng ISR/cache theo route).  
> **Nguyên tắc:** Không sửa `extends` thủ công cho từng khách hàng; không copy source code; không để build của khách hàng này làm thay đổi artifact hoặc branding của khách hàng khác.

---

## 0. Chỉ thị quan trọng cho AI coding agent

Đây là tài liệu yêu cầu triển khai. Trước khi sửa bất kỳ file nào, phải đọc repository thực tế và đối chiếu tài liệu này với cấu trúc đang có.

### 0.1 Không được tự suy diễn

1. Không giả định thư mục hiện tại khớp hoàn toàn với cấu trúc ví dụ trong tài liệu.
2. Không tự đổi tên hàng loạt thư mục, package, app hoặc customer ID nếu chưa có lý do kỹ thuật và báo cáo tác động.
3. Không di chuyển hoặc xóa `tm-cms`, `tm-web`, `tm-shared`, Customer Layers, API, models, schemas hay assets trước khi lập inventory.
4. Không ghi `TM_CUSTOMER_ID` cố định vào source code của một khách hàng.
5. Không thêm Customer Layer bằng cách sửa `extends` mỗi lần tạo Vercel Project.
6. Không cho phép giá trị environment tùy ý tạo đường dẫn file bằng nối chuỗi trực tiếp.
7. Không đặt database URI, Hub secret, provider secret hoặc bất kỳ credential nào trong Customer Layer, `app.config.ts`, `NUXT_PUBLIC_*`, Git hoặc browser bundle.
8. Không coi `TM_CUSTOMER_ID`, `appId` hoặc domain là bằng chứng authorization. Backend phải xác thực trusted context và quyền truy cập.
9. Không dùng chung `.nuxt`, `.output`, generated public assets hoặc file tạm giữa các customer builds.
10. Không bật build skipping tối ưu trước khi chứng minh dependency/path tracking không bỏ sót thay đổi của Customer Layer.
11. Không tự thay đổi các project Vercel đang chạy hoặc production domains. AI phải cung cấp cấu hình, lệnh và checklist; thao tác dashboard cần được người vận hành thực hiện hoặc được cấp quyền rõ ràng.
12. Không tự tuyên bố build/deploy thành công nếu chưa chạy lệnh và xem kết quả thật.

### 0.2 Quy trình bắt buộc

**Phase 0 — Audit only, không sửa code:**

- Kiểm tra Git root, nhánh, package manager, `package.json`, `pnpm-workspace.yaml`, lockfile và `turbo.json` nếu có.
- Kiểm tra `tm-cms/nuxt.config.ts`, `tm-web/nuxt.config.ts`, package scripts và Nuxt version thực tế.
- Kiểm tra toàn bộ Base Layers và Customer Layers hiện có.
- Kiểm tra `extends`, thứ tự layer, config merge, app config merge, CSS imports, components/pages/layouts auto-discovery, server routes và static assets.
- Kiểm tra Vercel settings hiện tại nếu repository có config hoặc CLI access; không đoán Root Directory, build command hay env variables.
- Kiểm tra cách Shared Packages đang được import: `workspace:*`, private npm registry, `file:` hay path alias.
- Lập danh sách customer hiện có và mapping CMS/Web.
- Xác định `TM_CUSTOMER_ID`, `TM_APP_KIND`, `HUB_APP_ID`, `TENANT_ID` (nếu dùng) hiện đang được đặt ở đâu.
- Kiểm tra `spa-loading-template.html`, favicon, PWA manifest/icons và các file SEO/robots/sitemap.

Deliverable Phase 0:

1. Sơ đồ repository hiện tại.
2. Bảng Vercel Project → Root Directory → app kind → customer ID hiện tại.
3. Bảng Base Layer / Customer Layer hiện có.
4. Sai khác giữa implementation và tài liệu này.
5. Danh sách lỗi/risks về layer precedence, host override, build path, env và asset collision.
6. Danh sách file dự kiến thêm/sửa.
7. Test plan trước khi thực hiện.

**Không chỉnh sửa code trong Phase 0.** Sau báo cáo, triển khai các phase tiếp theo theo thứ tự; không dừng để hỏi lại những quyết định đã được quy định rõ trong tài liệu này. Nếu phát hiện xung đột không thể giải quyết an toàn (ví dụ migration phá hủy hoặc secret đang bị lộ), dừng đúng phần đó, ghi rõ blocker và tiếp tục các phần độc lập an toàn.

---

## 1. Mục tiêu và mô hình vận hành đã chốt

### 1.1 Một repository, nhiều Vercel Projects

Chỉ duy trì **một Git repository chính** chứa code nền tảng và Customer Layers. Không tạo một repository source code riêng cho mỗi khách hàng.

Mỗi Vercel Project đại diện cho **một ứng dụng của một khách hàng** và có deployment riêng:

- `tm-cms-sentuan`: CMS SPA của khách hàng Sen Tuấn.
- `tm-web-sentuan`: Website SSR của khách hàng Sen Tuấn.
- `tm-cms-bagpost`: CMS SPA của khách hàng Bag Post.
- `tm-web-bagpost`: Website SSR của khách hàng Bag Post.
- `tm-cms-customer-c`: CMS SPA của Customer C.

Một khách hàng chỉ cần CMS thì chỉ tạo `tm-cms-{customer}`; không cần tạo Vercel Project cho Website.

### 1.2 Mô hình build

Mỗi Vercel Project khai báo các biến build-time tương ứng, tối thiểu:

```env
TM_CUSTOMER_ID=sentuan
```

Ứng dụng tự xác định app kind từ host application:

- Host `tm-cms` luôn là `cms` và luôn build SPA.
- Host `tm-web` luôn là `web` và luôn build SSR.

Không cho phép Vercel environment variable đổi CMS thành Web hoặc ngược lại. App kind là thuộc tính cố định của host app; script chỉ xác minh sự nhất quán.

Build process:

```text
Vercel Project
   │
   ├── Git repository: tm-platform (same repository)
   ├── Root Directory: tm-cms OR tm-web
   └── Environment: TM_CUSTOMER_ID=sentuan
              │
              ▼
      Customer Build Resolver
              │
              ├── Validate host app kind
              ├── Validate customer ID against allowlist registry
              ├── Resolve exact Customer Layer path
              ├── Validate required customer assets/config
              └── Resolve Base Layers
              │
              ▼
        Nuxt build for this app/customer
              │
              ▼
     Independent Vercel deployment artifact
```

### 1.3 Không phải runtime multi-brand trên cùng một deployment

Mô hình mục tiêu hiện tại là **one customer + one app kind per Vercel Project build**.

Ví dụ `tm-web-sentuan` chỉ build Website Sen Tuấn. Nó không nhận request từ nhiều customer domain rồi tự đổi theme theo hostname trong cùng một deployment.

Không triển khai mô hình multi-domain runtime tenant resolver trừ khi có yêu cầu kiến trúc riêng trong tương lai.

---

## 2. Repository structure mục tiêu

Đây là cấu trúc chuẩn định hướng. AI phải adapt theo repository thực tế, nhưng phải giữ các ranh giới trách nhiệm sau:

```text
tm-platform/
│
├── tm-cms/                              # Host Nuxt 4 SPA
│   ├── app/                              # Bootstrap tối thiểu; không chứa brand theo tenant
│   ├── server/                           # CMS API riêng
│   ├── nuxt.config.ts                    # Dynamic CMS layer resolver
│   ├── package.json
│   └── ...
│
├── tm-web/                              # Host Nuxt 4 SSR
│   ├── app/                              # Bootstrap tối thiểu; không chứa brand theo tenant
│   ├── server/                           # Public Website API riêng
│   ├── nuxt.config.ts                    # Dynamic Web layer resolver
│   ├── package.json
│   └── ...
│
├── tm-shared/
│   │
│   ├── packages/                         # Shared packages / workspace packages
│   │   ├── contracts/
│   │   ├── types/
│   │   ├── utils/
│   │   ├── config-schema/
│   │   ├── design-tokens/
│   │   └── ...
│   │
│   ├── nuxt-layers/
│   │   ├── core-base/                    # Nuxt foundation
│   │   ├── config-base/                  # Runtime/build config helpers
│   │   ├── api-base/                     # Shared server infrastructure/helpers
│   │   ├── cms-base/                     # CMS Admin Shell and reusable admin features
│   │   └── web-base/                     # SSR/public foundation, SEO base
│   │
│   └── customer-layers/
│       ├── registry/
│       │   ├── customers.ts              # Allowlisted customer registry
│       │   ├── schema.ts                 # Registry schema/types
│       │   └── resolver.ts               # Build-time resolver (Node-only)
│       │
│       ├── cms/
│       │   ├── default-cms/
│       │   ├── sentuan-cms/
│       │   └── bag-post-cms/
│       │
│       └── web/
│           ├── default-web/
│           ├── sentuan-web/
│           └── bag-post-web/
│
├── scripts/
│   ├── build/
│   │   ├── validate-build.ts             # Validate environment + registry
│   │   ├── customer-registry.ts           # If registry is not in tm-shared
│   │   ├── inspect-build.ts               # Inspect output for correct customer
│   │   └── ...
│   └── deployment/
│       ├── check-vercel-project.ts
│       └── ...
│
├── pnpm-workspace.yaml
├── package.json
├── pnpm-lock.yaml
├── turbo.json                            # Optional workspace task orchestration
└── README.md
```

### 2.1 Quy tắc Host Application

`tm-cms` và `tm-web` là hai host độc lập, chịu trách nhiệm:

- Khai báo Nuxt app type và Nuxt config entry point.
- Đăng ký build resolver đúng loại ứng dụng.
- Chứa API riêng của ứng dụng.
- Chứa dependencies trực tiếp mà ứng dụng cần.
- Chứa bootstrap tối thiểu cần thiết để Nuxt khởi động.

Host **không** nên chứa file mặc định có cùng đường dẫn với file mà Base Layer hoặc Customer Layer cần ghi đè, nếu không có chủ ý rõ ràng.

Ví dụ không nên đặt logo, `app.config.ts`, default layout, default pages, favicon hoặc customer loading template vào host khi những file này phải được cung cấp bởi layer. File tại Host có thể có ưu tiên cao nhất và làm Customer Layer không override được.

Không xóa các file host đang có một cách máy móc. Audit từng file, xác định file nào là bootstrap bắt buộc và file nào cần chuyển vào Base Layer.

### 2.2 Quy tắc Base Layers

- `core-base`: cấu hình Nuxt nền tảng, plugins/composables/utils dùng chung, global conventions.
- `config-base`: chuẩn hóa app config, public runtime config schema, customer config access.
- `api-base`: helper phía server, error envelope, request context adapter, validation helper; không ép CMS và Web dùng chung query implementation.
- `cms-base`: Admin Shell, CMS layout, navigation shell, BasePage, reusable admin components.
- `web-base`: SSR foundation, SEO metadata, sitemap/robots conventions, base public layout/composables.

`cms-base` không được đưa vào Web. `web-base` không được đưa vào CMS.

### 2.3 Quy tắc Customer Layers

Customer Layer chỉ chứa phần khác biệt của khách hàng:

- Branding và app identity.
- Design token overrides.
- Logo/favicon/PWA assets/loading screen theo app kind.
- Customer navigation/menu defaults.
- Customer-specific feature configuration.
- Custom CMS layout/components/pages nếu cần.
- Custom Website pages/layouts/components/server resolver nếu Website được custom sâu.

Không copy nguyên Base Layer vào Customer Layer. Không copy business modules nếu chỉ cần override vài components/config.

---

## 3. Nuxt Layers: inheritance, precedence và override

### 3.1 Thứ tự `extends`

Theo quy tắc Nuxt Layers, layer đứng **đầu danh sách `extends` có độ ưu tiên cao hơn layer phía sau**. File thuộc Host Application có thể có ưu tiên cao hơn tất cả layers.

Thứ tự mục tiêu cho CMS:

```ts
extends: [
  customerCmsLayer,   // Highest layer priority among extends
  cmsBaseLayer,
  apiBaseLayer,
  configBaseLayer,
  coreBaseLayer,      // Lowest layer priority among extends
]
```

Thứ tự mục tiêu cho Web:

```ts
extends: [
  customerWebLayer,
  webBaseLayer,
  apiBaseLayer,
  configBaseLayer,
  coreBaseLayer,
]
```

Không đảo thứ tự này mà không kiểm tra bằng fixture/test override.

### 3.2 Không nhầm Nuxt Layer precedence với CSS cascade precedence

Hai hệ thống độc lập:

- Nuxt Layer precedence: quyết định file/config nào được resolve/merge khi nhiều layers có cùng đường dẫn.
- CSS cascade layers (`@layer`): quyết định độ ưu tiên CSS rules.

Không suy luận CSS order từ thứ tự Nuxt `extends`. Design System phải tự khai báo CSS cascade order rõ ràng.

### 3.3 Host phải minimal để Customer Layer có thể override

Ví dụ:

```text
Không lý tưởng:
tm-cms/app/app.config.ts
 tm-cms/app/layouts/default.vue
 tm-cms/app/assets/css/brand.css

Khuyến nghị:
tm-cms/nuxt.config.ts
 tm-cms/package.json
 tm-cms/app/app.vue                 # Chỉ giữ nếu là bootstrap thực sự cần thiết
```

Các file mặc định của CMS nằm trong `cms-base`. Branding mặc định nằm trong `default-cms`. Customer overrides nằm trong `sentuan-cms` hoặc `bag-post-cms`.

Nếu Host có `app.vue` bắt buộc, thiết kế nó thành bootstrap wrapper trung tính và không chứa customer-specific markup/config.

### 3.4 Layer override test bắt buộc

Tạo fixture/test có cùng một file (ví dụ component `LayerPriorityProbe.vue` hoặc app config key) trong:

- `core-base`
- `cms-base` / `web-base`
- Customer Layer
- Host app (chỉ khi kiểm tra Host precedence)

Build/dev inspect kết quả để chứng minh:

1. Customer Layer override Base Layer.
2. CMS Base không ảnh hưởng Web.
3. Web Base không ảnh hưởng CMS.
4. Host file chỉ override khi được chủ ý đặt ở Host.
5. Không có duplicate route/component do merge sai.

---

## 4. Customer Registry — một nguồn sự thật cho build selection

### 4.1 Mục tiêu

Không dùng `TM_CUSTOMER_ID` để tạo đường dẫn thư mục tùy ý. Resolver phải tra giá trị trong allowlist registry, sau đó trả về các đường dẫn tuyệt đối được khai báo rõ ràng.

Registry là **build-time configuration**, không phải dữ liệu bí mật và không phải authorization policy.

### 4.2 Registry contract đề xuất

```ts
export type AppKind = 'cms' | 'web'

export interface CustomerAppLayerEntry {
  enabled: boolean
  layerPath: string
  displayName: string
  brandConfigPath?: string
  requiredAssets?: string[]
}

export interface CustomerRegistryEntry {
  customerId: string
  displayName: string
  status: 'active' | 'inactive'
  apps: {
    cms?: CustomerAppLayerEntry
    web?: CustomerAppLayerEntry
  }
}
```

Ví dụ dữ liệu (chỉ là cấu trúc minh họa, phải map với customer thật):

```ts
export const customers = {
  sentuan: {
    customerId: 'sentuan',
    displayName: 'Sen Tuan',
    status: 'active',
    apps: {
      cms: {
        enabled: true,
        layerPath: 'tm-shared/customer-layers/cms/sentuan-cms',
        displayName: 'Sen Tuan CMS',
      },
      web: {
        enabled: true,
        layerPath: 'tm-shared/customer-layers/web/sentuan-web',
        displayName: 'Sen Tuan Website',
      },
    },
  },

  bagpost: {
    customerId: 'bagpost',
    displayName: 'Bag Post',
    status: 'active',
    apps: {
      cms: {
        enabled: true,
        layerPath: 'tm-shared/customer-layers/cms/bag-post-cms',
        displayName: 'Bag Post CMS',
      },
      web: {
        enabled: true,
        layerPath: 'tm-shared/customer-layers/web/bag-post-web',
        displayName: 'Bag Post Website',
      },
    },
  },

  cms_only_customer: {
    customerId: 'cms_only_customer',
    displayName: 'CMS Only Customer',
    status: 'active',
    apps: {
      cms: {
        enabled: true,
        layerPath: 'tm-shared/customer-layers/cms/cms-only-customer',
        displayName: 'CMS Only Customer',
      },
      // No web entry means no Web Vercel Project should be created.
    },
  },
} as const
```

Do not create fake customer entries in production. Replace examples with existing approved customer IDs.

### 4.3 Validation rules

Resolver must fail the build when:

- `TM_CUSTOMER_ID` is missing or empty.
- Customer ID is not present in registry.
- Customer status is inactive.
- Requested app kind is not enabled for customer.
- Layer path does not exist.
- Layer path resolves outside repository root.
- Layer lacks required `nuxt.config.ts` or another required entry file.
- Required branding/config assets are missing.
- A customer app has accidental reference to another customer's layer or assets.

Do not silently fall back to `default`, `sentuan`, or another customer in Production. A deliberate `default` customer may be used only when explicitly configured and allowed for that deployment.

### 4.4 `appKind` must be determined by host

- `tm-cms/nuxt.config.ts` calls resolver with `appKind: 'cms'`.
- `tm-web/nuxt.config.ts` calls resolver with `appKind: 'web'`.

Do not read `TM_APP_KIND` to choose the Nuxt host. An optional `TM_APP_KIND` variable can be used only as an assertion; if it conflicts with host kind, fail build.

---

## 5. Dynamic Layer Resolver

### 5.1 Design requirements

Implement one shared Node-only resolver function used by both host apps.

It must:

1. Receive fixed `appKind` from host config (`cms` or `web`).
2. Read `TM_CUSTOMER_ID` from process environment at Nuxt config evaluation/build time.
3. Look up the registry entry.
4. Validate customer and app availability.
5. Resolve absolute paths relative to monorepo root, not current shell working directory.
6. Confirm resolved path remains inside monorepo root.
7. Confirm layer entry files exist.
8. Return a stable, ordered `extends` array.
9. Print only non-secret build identity (app kind/customer ID/layer name) for diagnostics.
10. Never print environment variables wholesale or log secrets.

### 5.2 Pseudocode

Adapt this to the real TS module format and path structure:

```ts
// tm-shared/customer-layers/registry/resolver.ts
import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { customers } from './customers'

export type AppKind = 'cms' | 'web'

export function resolveCustomerLayers(input: {
  appKind: AppKind
  customerId: string | undefined
  repoRoot: string
}) {
  const customerId = input.customerId?.trim().toLowerCase()

  if (!customerId) {
    throw new Error('TM_CUSTOMER_ID is required for production build')
  }

  const customer = customers[customerId as keyof typeof customers]
  if (!customer || customer.status !== 'active') {
    throw new Error(`Unknown or inactive TM_CUSTOMER_ID: ${customerId}`)
  }

  const appEntry = customer.apps[input.appKind]
  if (!appEntry?.enabled) {
    throw new Error(`Customer ${customerId} does not have ${input.appKind} enabled`)
  }

  const repoRoot = realpathSync(input.repoRoot)
  const unresolved = resolve(repoRoot, appEntry.layerPath)
  if (!existsSync(unresolved)) {
    throw new Error(`Customer layer not found for ${customerId}/${input.appKind}`)
  }

  const layerPath = realpathSync(unresolved)
  const rel = relative(repoRoot, layerPath)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Customer layer path escapes repository root')
  }

  if (!existsSync(resolve(layerPath, 'nuxt.config.ts'))) {
    throw new Error('Customer layer is missing nuxt.config.ts')
  }

  const baseDir = input.appKind === 'cms' ? 'cms-base' : 'web-base'
  const appBase = resolve(repoRoot, 'tm-shared/nuxt-layers', baseDir)
  const apiBase = resolve(repoRoot, 'tm-shared/nuxt-layers/api-base')
  const configBase = resolve(repoRoot, 'tm-shared/nuxt-layers/config-base')
  const coreBase = resolve(repoRoot, 'tm-shared/nuxt-layers/core-base')

  for (const base of [appBase, apiBase, configBase, coreBase]) {
    if (!existsSync(resolve(base, 'nuxt.config.ts'))) {
      throw new Error(`Required base layer is missing: ${base}`)
    }
  }

  return {
    customerId,
    appKind: input.appKind,
    customerLayer: layerPath,
    extends: [layerPath, appBase, apiBase, configBase, coreBase],
  }
}
```

This is a reference implementation pattern. Adapt registry type imports and paths to the actual repository, then add tests. Do not leave unresolved identifiers; the registry object must be imported from the real source file. The returned `extends` array must use the resolved `layerPath` variable.

### 5.3 Host CMS Nuxt config pattern

```ts
// tm-cms/nuxt.config.ts
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { resolveCustomerLayers } from '../tm-shared/customer-layers/registry/resolver'

const appDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(appDir, '..')

const selected = resolveCustomerLayers({
  appKind: 'cms',
  customerId: process.env.TM_CUSTOMER_ID,
  repoRoot,
})

if (process.env.TM_APP_KIND && process.env.TM_APP_KIND !== 'cms') {
  throw new Error('TM_APP_KIND must be cms for tm-cms host')
}

console.info(`[TM Build] app=cms customer=${selected.customerId}`)

export default defineNuxtConfig({
  ssr: false,
  extends: selected.extends,
})
```

### 5.4 Host Web Nuxt config pattern

```ts
// tm-web/nuxt.config.ts
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { resolveCustomerLayers } from '../tm-shared/customer-layers/registry/resolver'

const appDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(appDir, '..')

const selected = resolveCustomerLayers({
  appKind: 'web',
  customerId: process.env.TM_CUSTOMER_ID,
  repoRoot,
})

if (process.env.TM_APP_KIND && process.env.TM_APP_KIND !== 'web') {
  throw new Error('TM_APP_KIND must be web for tm-web host')
}

console.info(`[TM Build] app=web customer=${selected.customerId}`)

export default defineNuxtConfig({
  ssr: true,
  extends: selected.extends,
})
```

Nuxt config code runs at build/dev startup. Do not expose `selected` or internal path information to browser runtime config unless there is a deliberate non-sensitive diagnostic use.

### 5.5 Nuxt config merge rules

Do not assume all config keys merge in the way desired. Audit and test:

- `modules` arrays.
- `css` arrays.
- `runtimeConfig` nested values.
- `appConfig` values.
- `routeRules`.
- `nitro` settings.
- `vite`/build aliases.
- component and composable directories.
- auto imports.
- server handlers and middleware.
- i18n locales/domains.
- PWA plugin configuration.

If two layers need to extend an array or nested object, use the supported Nuxt config mechanism/hook and test the final resolved config. Avoid accidentally replacing required base modules/config with a Customer Layer override.

---

## 6. Customer Layer authoring standards

### 6.1 Customer CMS layer

A CMS customer layer may contain:

```text
sentuan-cms/
├── nuxt.config.ts
├── app/
│   ├── app.config.ts
│   ├── layouts/
│   ├── pages/                    # Only custom pages/overrides
│   ├── components/               # Only customer-specific overrides
│   └── assets/css/
│       └── customer-overrides.css
├── public/                       # Only if verified Nuxt layer public merge works
├── branding/
│   ├── logo.svg
│   ├── favicon.svg
│   ├── favicon.ico
│   ├── pwa-192.png
│   └── pwa-512.png
└── customer.config.ts
```

CMS-specific concerns:

- Keep `ssr: false` at host level.
- Brand application title, logo, favicon, app icon, PWA identity and SPA loader per customer.
- Use shared `CmsBasePage` and Admin Shell unless an explicit customer override is required.
- Customer module enablement config must not replace backend permission checks.
- Do not put database credentials or Hub app secrets in `customer.config.ts`.

### 6.2 Customer Web layer

```text
sentuan-web/
├── nuxt.config.ts
├── app/
│   ├── app.config.ts
│   ├── pages/                     # Can replace homepage/routes
│   ├── layouts/                   # Can replace public layout
│   ├── components/                # Customer-specific presentation
│   └── assets/css/
│       └── customer-overrides.css
├── server/                        # Only when this customer's Web needs custom server behavior
├── public/                        # Verify layer asset behavior or use isolated asset staging
├── branding/
│   ├── logo.svg
│   ├── favicon.svg
│   └── og-default.png
└── customer.config.ts
```

Web-specific concerns:

- Keep SSR enabled at host level.
- Preserve SEO, metadata, sitemap, robots, canonical URL, Open Graph and structured data requirements.
- Base Web Layer provides only foundations and reusable generic functionality.
- Customer Web Layer may replace visual design extensively, including homepage, navigation, product detail and article layouts.
- Custom presentation must still consume standardized DTOs/API contracts unless the customer explicitly requires a different data contract.
- Avoid importing CMS-only components or stores into public Web bundles.

### 6.3 Base Layer vs Customer Layer ownership

| Concern | Base Layer | Customer Layer |
|---|---|---|
| Nuxt baseline | Owns | Does not replace casually |
| CMS/Web mode | Host owns | Cannot change host kind |
| Shared contracts | NPM/workspace package | Consumes |
| Generic API helpers | Owns | Uses/extends carefully |
| Generic CMS shell | CMS Base | Overrides only if needed |
| Generic Web SEO base | Web Base | Adds customer-specific metadata |
| Brand name/logo/colors | Defaults only | Owns customer values |
| Customer domain | Config/env per deployment | May declare non-secret expected site identity |
| DB credential | Vercel secret env/server only | Never stored here |
| Hub secret | Vercel secret env/server only | Never stored here |
| Custom UI pages | Generic starter pages | Can replace deeply |

---

## 7. Branding assets, favicon, PWA and SPA loading template

### 7.1 Build-time branding

These assets/configurations belong to the selected customer build:

- App/site name and short name.
- Logo and brand marks.
- Favicon SVG/ICO/PNG.
- Apple touch icon.
- PWA 192/512/maskable icons and manifest fields for CMS if PWA is enabled.
- `spa-loading-template.html` (CMS only, subject to the actual Nuxt configuration mechanism in the project).
- Theme color and background color.
- Default Open Graph image.
- Browser theme color and SEO defaults.

### 7.2 Do not assume `public/` merging behavior

Before implementation, verify whether the currently used Nuxt version and layer strategy correctly incorporates each Customer Layer `public/` directory. Test the built `.output/public` or final deployment output.

If layer public assets do not merge as expected, use a deterministic build asset staging step that copies only the selected customer's assets into a customer-specific generated public directory or into the app's isolated build input. Do not overwrite tracked generic source files, and do not stage assets in a shared directory concurrently used by another build.

The staging method must:

1. Clean only its own generated directory.
2. Copy only from the selected registry-approved Customer Layer.
3. Reject paths outside that Customer Layer.
4. Detect missing required files and duplicate destination names.
5. Never copy secret/config files.
6. Be deterministic and idempotent.
7. Run before Nuxt build.
8. Be covered by output inspection tests.

### 7.3 PWA isolation

If CMS uses PWA:

- Give each customer/app a unique manifest identity/name/short name.
- Give each production scope/start URL the correct customer app identity.
- Ensure service worker and cache names do not collide across customer deployments (domains are usually separate, but explicit unique identity is still required).
- Check install/update behavior after a branding change.
- Do not enable PWA for Web unless explicitly required.

### 7.4 SPA loading template

For each CMS Customer Layer, verify the actual Nuxt option/path used by this repository. The file name `spa-loading-template.html` alone does not prove Nuxt is loading it. Test the pre-hydration experience in a production build. Do not use a runtime component as a substitute if the target is pre-hydration loading.

---

## 8. Central Design System and customer theme overrides

### 8.1 One centralized token system

Maintain centralized design tokens in Shared Design System/Base Layers, not separate CSS values scattered across modules.

Token groups should cover:

- Brand colors and semantic colors.
- Typography, font families, font sizes and weights.
- Spacing and layout density.
- Small border-radius scale (the requested visual direction uses compact/small radius, not oversized pill cards everywhere).
- Border colors/opacity.
- Surface/background opacity.
- Glass blur and saturation.
- Shadows and elevation.
- Focus/hover/active states.
- Motion duration/easing and reduced-motion behavior.
- Aurora mesh colors/intensity.
- Glowing orb opacity/blur/position.
- Isometric grid opacity/perspective.
- Refraction/highlight parameters.

### 8.2 Visual direction

Default design direction:

**Linear Flat Glassmorphism & Bento UI**

- Flat, disciplined information hierarchy.
- Bento cards and modular content regions.
- Compact/small border radius.
- Restrained glass surfaces; avoid making every element translucent.
- Aurora mesh gradients as atmospheric background, not a competing content layer.
- Glowing 3D orbs used sparingly as visual accents.
- Isometric grid perspective used subtly in decorative backgrounds.
- Refraction/highlight edge lighting for glass surfaces.
- High text contrast and accessibility in light/dark themes.
- Responsive density for desktop/tablet/mobile.

### 8.3 CSS architecture

Recommended central files (adapt names to existing system):

```text
tm-shared/nuxt-layers/core-base/app/assets/css/
├── tokens.css                 # CSS custom properties / design tokens
├── theme-light.css            # Light theme semantic mapping
├── theme-dark.css             # Dark theme semantic mapping
├── typography.css
├── surfaces.css               # Surface/border/glass foundations
├── backgrounds.css            # Aurora/orbs/isometric decorative layers
├── motion.css
└── utilities.css
```

App-specific layers:

```text
cms-base/app/assets/css/cms-theme.css
web-base/app/assets/css/web-theme.css
customer-layer/app/assets/css/customer-overrides.css
```

Rules:

1. Modules must consume semantic tokens/components; do not hardcode their own brand palettes, radius, blur, shadow or backgrounds.
2. Customer Layer overrides tokens, not 40 module stylesheets.
3. Avoid global selectors that unexpectedly affect editors, third-party widgets or embedded content.
4. Decorative backgrounds must be pointer-events none and must not cover interactive elements.
5. Support `prefers-reduced-motion` and maintain text contrast.
6. Use CSS cascade layers with an explicitly declared order if appropriate; do not confuse CSS cascade ordering with Nuxt `extends` ordering.
7. Include visual regression or screenshot review for representative desktop/mobile pages.

---

## 9. Customer configuration vs Vercel environment variables

### 9.1 Build-time non-secret customer config

Customer Layer `customer.config.ts` or registry may contain:

- Customer ID/display name.
- Brand name/short name.
- Theme token overrides.
- Enabled application features for UI composition.
- Public site metadata defaults.
- PWA display settings.
- Required assets list.
- CMS navigation defaults.

It must not contain:

- MongoDB URI/password.
- TM Hub secret or client secret.
- JWT signing key.
- AI provider keys.
- Cloudinary API secret.
- Firebase private key/VAPID private key.
- SMTP passwords.
- Any credentials or tenant database connection secrets.

### 9.2 Environment variables per Vercel Project

Each Vercel Project must define values for Production, Preview and Development as appropriate. Do not assume the values from one project or environment are inherited by another.

Common non-secret build identity:

```env
TM_CUSTOMER_ID=sentuan
```

Optional assertion:

```env
TM_APP_KIND=cms
```

For CMS:

```env
TM_CUSTOMER_ID=sentuan
TM_APP_KIND=cms
HUB_URL=https://hub.example.com
HUB_APP_ID=customer-a-cms
TENANT_ID=customer-a
MONGODB_URI=<CMS_DATABASE_CREDENTIAL>
MONGODB_NAME=customer_a
```

For Web:

```env
TM_CUSTOMER_ID=sentuan
TM_APP_KIND=web
HUB_URL=https://hub.example.com
HUB_APP_ID=customer-a-web
TENANT_ID=customer-a
MONGODB_URI=<READ_ONLY_DATABASE_CREDENTIAL>
MONGODB_NAME=customer_a
NUXT_PUBLIC_SITE_URL=https://sentuan.vn
```

These names are proposed conventions. AI must map them to the actual runtime config/environment contract in TM Hub and the applications. Do not add duplicate aliases if the repository already has a stable naming standard.

### 9.3 Preview safety

- Preview deployment must use staging/test database credentials, not production write credentials.
- Preview domain/site URL must not accidentally publish production canonical URLs or production sitemap.
- Verify robots/noindex policy for preview deployments.
- Do not send production email/notifications from preview unless explicitly approved.
- Hub credentials for Preview must be scoped to the correct app/tenant/environment.

### 9.4 Public vs private Nuxt runtime config

- Anything under `runtimeConfig.public` is browser-visible.
- Never place database URI, service secrets, app secret, provider secret or private credentials in public runtime config.
- Public `siteUrl`, public brand label and public API base may be exposed when needed.
- On Web SSR, database access must occur only in server-side code.

---

## 10. Build Engine and package scripts

### 10.1 Design

Use one build command per host app, not one command per customer.

- CMS: `pnpm run build:vercel` from the `tm-cms` Vercel project root.
- Web: `pnpm run build:vercel` from the `tm-web` Vercel project root.

The customer is selected from `TM_CUSTOMER_ID`.

### 10.2 CMS package script

```json
{
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt build",
    "build:vercel": "tsx ../scripts/build/validate-build.ts cms && nuxt build",
    "typecheck": "nuxt typecheck",
    "test": "vitest run"
  }
}
```

### 10.3 Web package script

```json
{
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt build",
    "build:vercel": "tsx ../scripts/build/validate-build.ts web && nuxt build",
    "typecheck": "nuxt typecheck",
    "test": "vitest run"
  }
}
```

The command syntax is a proposal. Use a runner already in the repository (`tsx`, `jiti`, built JS, or another supported mechanism). Do not add a new runner without justification.

If the Vercel build runs from a different cwd than expected, use explicit `--cwd`/path handling or a root-level build orchestrator. Test the exact Vercel command locally from the same working directory.

### 10.4 Root package scripts

Example only:

```json
{
  "name": "tm-platform",
  "private": true,
  "packageManager": "pnpm@10.x",
  "scripts": {
    "build:cms": "pnpm --dir tm-cms run build:vercel",
    "build:web": "pnpm --dir tm-web run build:vercel",
    "validate:registry": "tsx scripts/build/validate-registry.ts",
    "test:layers": "tsx scripts/build/test-layer-priority.ts"
  }
}
```

Use the actual pnpm version from the root `package.json` / lockfile. Do not change package manager version as part of this task unless required.

### 10.5 Validation script responsibilities

The prebuild validation must:

- Determine expected app kind from argument/host.
- Validate optional `TM_APP_KIND` matches it.
- Require valid `TM_CUSTOMER_ID`.
- Resolve exact customer registry record.
- Check customer is active and that app is enabled.
- Check selected layer exists and contains `nuxt.config.ts`.
- Check required Base Layers exist.
- Check required branding assets and expected config files.
- Check mandatory Vercel env variables for the selected app.
- Check no known secret is stored inside customer layer files (static checks only; secret scanning remains a separate control).
- Print a concise build summary without secret values.
- Exit non-zero on any invalid condition.

It must not create or mutate production data, register applications in TM Hub or change credentials during build.

---

## 11. PNPM Workspace and shared source resolution

### 11.1 Workspace root

`pnpm-workspace.yaml` must be at the Git repository root if the repository uses pnpm workspaces.

Example (adapt to actual package layout):

```yaml
packages:
  - 'tm-cms'
  - 'tm-web'
  - 'tm-shared/packages/*'
  - 'tm-shared/nuxt-layers/*'
  - 'tm-shared/customer-layers/cms/*'
  - 'tm-shared/customer-layers/web/*'
```

Each workspace package must have a unique `name` in `package.json`.

Do not include ordinary folders as workspaces unless they are actual Node packages with package metadata. If Nuxt Layers are not packages, do not add their directories as workspaces just to satisfy a glob.

### 11.2 Internal dependency declarations

- Every package imported by another workspace package/app must be declared in its `package.json`.
- Use `workspace:*` for workspace packages.
- Avoid relying only on TypeScript path aliases that are invisible to package manager/build dependency analysis.
- Keep the root lockfile at repository root.
- Build and install must work with frozen lockfile in CI.

### 11.3 Shared NPM packages vs local Nuxt Layers

The project may use both:

- Shared contracts/utils/design tokens can be workspace packages and optionally published to a private npm-compatible registry.
- Nuxt Layers and customer-specific layer source can remain inside this main repository so each Vercel build can resolve them directly.

Do not force every Customer Layer to be published as an npm package if it is intentionally versioned and built from the same main repository.

If a package is published externally, pin a semver version in consuming apps and update through normal dependency/release workflow. Do not use `latest` for production builds.

---

## 12. Vercel setup — project-by-project configuration

### 12.1 One Git repository, multiple Vercel Projects

Import the same Git repository into Vercel for each deployed application/customer combination.

Examples:

| Vercel Project | Root Directory | `TM_CUSTOMER_ID` | App kind | Required? |
|---|---|---|---|---|
| `tm-cms-sentuan` | `tm-cms` | `sentuan` | CMS | Yes if customer uses CMS |
| `tm-web-sentuan` | `tm-web` | `sentuan` | Web | Only if customer has website |
| `tm-cms-bagpost` | `tm-cms` | `bagpost` | CMS | Yes if customer uses CMS |
| `tm-web-bagpost` | `tm-web` | `bagpost` | Web | Only if customer has website |

All projects point to the same Git repository and branch strategy, but each has independent:

- Project ID/name.
- Root Directory.
- Build configuration.
- Production domain(s).
- Environment Variables.
- Deployment history and rollback.
- Runtime environment/secret values.

A customer with CMS-only deployment must not have a Web project created just to satisfy the monorepo structure.

### 12.2 Vercel Settings for CMS Project

Example: `tm-cms-sentuan`.

| Setting | Value |
|---|---|
| Git Repository | Main `tm-platform` repository |
| Framework Preset | Nuxt (auto-detect or explicit Nuxt) |
| Root Directory | `tm-cms` |
| Include source files outside Root Directory | Enabled |
| Build Command | `pnpm run build:vercel` |
| Install Command | Use Vercel workspace detection initially; if overriding, run the root workspace install with frozen lockfile from the repository root |
| Output Directory | Auto-detect Nuxt/Nitro output; do not hardcode `.output` unless the Vercel Nuxt integration requires it |
| Development Command | `pnpm run dev` (if used) |
| Environment | Customer-specific |

Environment Variables for Production/Preview/Development must be configured per project. Use different database credentials for Preview and Production.

### 12.3 Vercel Settings for Web Project

Example: `tm-web-sentuan`.

| Setting | Value |
|---|---|
| Git Repository | Same main repository |
| Framework Preset | Nuxt (auto-detect or explicit Nuxt) |
| Root Directory | `tm-web` |
| Include source files outside Root Directory | Enabled |
| Build Command | `pnpm run build:vercel` |
| Install Command | Use workspace-aware install; frozen lockfile |
| Output Directory | Auto-detect Nuxt/Nitro output |
| Environment | Customer-specific |

Do not set Web to static export unless the architecture intentionally changes. The target is SSR, with route-specific ISR/cache where supported and verified.

### 12.4 Root Directory and files outside it

Because `tm-shared` and the root lockfile are outside `tm-cms` / `tm-web`, enable the Vercel setting:

**Include source files outside of the Root Directory in the Build Step.**

Verify this setting on every Vercel Project. Do not assume the setting is enabled; inspect the Project Dashboard.

### 12.5 Install command / workspace install

The repository root owns `pnpm-workspace.yaml` and `pnpm-lock.yaml`. Vercel must install the workspace in a way that can resolve:

- The host app package.
- Shared workspace packages.
- Dependencies imported by Base Layers.
- Dependencies imported by selected Customer Layers.

Prefer Vercel's workspace-aware install detection initially. If a custom install command is required, verify its current working directory and use a root-aware install such as `pnpm install --frozen-lockfile` from repository root, or a correctly filtered install that includes every transitive workspace dependency.

Do not use `pnpm install` from inside `tm-cms` or `tm-web` if it causes the root workspace lockfile/packages to be ignored.

Run a clean CI-like install locally and a real Preview Deployment before standardizing the command.

### 12.6 Domains

Example mapping:

| Vercel Project | Example domain |
|---|---|
| `tm-cms-sentuan` | `cms.sentuan.vn` |
| `tm-web-sentuan` | `sentuan.vn` |
| `tm-cms-bagpost` | `cms.bagpost.vn` |
| `tm-web-bagpost` | `bagpost.vn` |

Domain values are examples only. Use the customer's confirmed domain.

### 12.7 Environment isolation

Each project must hold its own environment values. Do not share a single environment variable group if the values contain customer-specific DB credentials or app credentials unless the group is explicitly scoped to one customer/app.

Recommended separation:

- Production: production DB and production Hub App Installation.
- Preview: staging DB and non-production Hub App Installation or restricted preview credentials.
- Development: local DB/test DB and development Hub configuration.

---

## 13. Vercel deployments when shared source changes

### 13.1 Default behavior first

Initially, allow Vercel to build every connected project on commits until correctness is demonstrated. This is safer than incorrectly skipping a customer build after its layer or a shared dependency changed.

Vercel documents that a commit to one repository connected to multiple Vercel Projects can trigger deployments for all connected Projects by default.

### 13.2 Selective build optimization later

Once the architecture is stable, optimize build selection.

Potential affected paths:

| Changed path | Projects that may need build |
|---|---|
| `tm-shared/nuxt-layers/core-base/**` | All CMS and Web |
| `tm-shared/nuxt-layers/config-base/**` | All CMS and Web |
| `tm-shared/nuxt-layers/api-base/**` | All app kinds that consume it |
| `tm-shared/nuxt-layers/cms-base/**` | All CMS |
| `tm-shared/nuxt-layers/web-base/**` | All Web |
| `tm-shared/packages/contracts/**` | Apps that depend on the changed contract package |
| `tm-shared/customer-layers/cms/sentuan-cms/**` | CMS Sen Tuấn only |
| `tm-shared/customer-layers/web/sentuan-web/**` | Web Sen Tuấn only |
| `tm-cms/**` | All CMS |
| `tm-web/**` | All Web |
| root lockfile/workspace/build scripts | Projects affected by the dependency/build change; conservatively all if unclear |

Vercel automatic monorepo skipping depends on workspace detection and explicit package dependency graph. A local file path in Nuxt `extends` may not automatically describe the same dependency edge to Vercel/Turborepo.

Therefore:

- Do not assume customer layer file changes are tracked as a dependency of the selected Vercel Project.
- Ensure workspace package dependencies are declared where package-based dependency tracking is used.
- If the dynamic local layer path is not represented in dependency graph, use a tested Ignored Build Step/path-aware script or keep full builds.
- Fail open: if the script cannot determine changed paths because of shallow Git history, missing base SHA, merge commit, force push or any unexpected condition, build rather than skip.
- Remember Vercel Ignored Build Step can count against deployment/concurrency limits; prefer native monorepo skipping only when dependency graph is accurate.

Do not write a custom ignore script until test cases prove that every relevant base/customer/shared change triggers the appropriate Project.

---

## 14. Build artifacts, generated files and cache isolation

Each Vercel Project build runs in its own build environment. Preserve this isolation.

Never commit or share:

- `.nuxt/`
- `.output/`
- temporary generated config that contains secrets.
- customer-specific staged public assets from another customer.
- stale manifest/service-worker files.

Add appropriate ignore rules after auditing existing repo conventions.

Build output validation should inspect, where practical:

- Correct customer brand name.
- Correct favicon and PWA manifest values.
- Correct `app.config` theme.
- Correct SPA/SSR mode.
- Correct public site URL/canonical base.
- No assets from another customer.
- No secret strings in client bundles or generated public files.
- No path to another customer's Customer Layer in runtime output.

Do not rely only on logs. Add deterministic tests for config resolution and output metadata.

---

## 15. Security and tenant isolation

Build-time customer selection is not a security control.

Backend API must independently establish:

1. Authenticated user context for protected CMS endpoints.
2. Trusted Hub App Installation context.
3. Trusted `tenantId` associated with the installation/credential.
4. Resource ownership and database connection scope.
5. Permission/entitlement for the requested action.

### 15.1 CMS

- User authentication through TM Hub according to the configured CMS app installation.
- CMS API validates tenant/app context on every protected request.
- Database URI remains server-only.
- CMS writes only to its assigned customer database.

### 15.2 Web

- Public visitor does not need a TM Hub user account.
- Web SSR server uses server-side credentials/read-only database access or an approved internal API path.
- Web can read only the public/published fields for its assigned customer/site.
- Do not expose database URI or Hub client secret to browser.
- Public site cannot switch tenant by changing query/header/body.

### 15.3 Secret validation

- Never print `process.env` as a complete object.
- Never output secrets in build logs.
- Never put secrets in `app.config.ts`, Customer Layer files, generated JS or public runtime config.
- Use Vercel Environment Variables with appropriate sensitive settings.
- Rotate credentials if a secret was committed or emitted into build output.

---

## 16. Testing matrix — mandatory before production

### 16.1 Configuration resolution

| Test | Expected result |
|---|---|
| `TM_CUSTOMER_ID=sentuan`, host CMS | Resolve `sentuan-cms` |
| `TM_CUSTOMER_ID=sentuan`, host Web | Resolve `sentuan-web` |
| `TM_CUSTOMER_ID=bagpost`, host CMS | Resolve `bag-post-cms` |
| `TM_CUSTOMER_ID=bagpost`, host Web | Resolve `bag-post-web` |
| Missing customer ID | Build fails clearly |
| Unknown customer ID | Build fails clearly |
| Inactive customer | Build fails clearly |
| Customer CMS disabled | CMS build fails |
| Customer Web disabled | Web build fails |
| Invalid path/traversal | Build fails |
| Missing Base Layer | Build fails |
| Missing required branding asset | Build fails |
| `TM_APP_KIND` conflicts with host | Build fails |

### 16.2 Layer precedence

- Customer Layer overrides CMS/Web Base Layer when same target file is intentionally provided.
- CMS Base Layer is not loaded into Web.
- Web Base Layer is not loaded into CMS.
- Host bootstrap does not unexpectedly override Customer Layer.
- Required Nuxt modules/config remain present after config merging.
- There are no duplicate/ambiguous routes.

### 16.3 Four representative production builds

At minimum run:

1. CMS Sen Tuấn.
2. Web Sen Tuấn.
3. CMS Bag Post.
4. Web Bag Post.

Also test one CMS-only customer if such configuration exists.

### 16.4 Build mode checks

CMS:

- `ssr: false` confirmed from resolved Nuxt config/build behavior.
- Correct SPA loader is included and shown before hydration.
- Correct favicon and PWA manifest/icons.

Web:

- SSR is active.
- A public route returns server-rendered HTML.
- Canonical/meta/OG tags match selected customer.
- Sitemap/robots use the correct production domain.
- ISR/cache configuration behaves as designed.

### 16.5 Cross-customer contamination checks

- Build customer A and inspect output.
- Build customer B and inspect output.
- Confirm neither output contains the other's brand name/logo/favicon/SEO defaults.
- Confirm asset staging does not reuse another customer's file.
- Confirm customer A credentials are not present in customer B deployment and vice versa.
- Confirm preview deployment uses preview credentials.

### 16.6 Quality gates

Run actual repository scripts for:

- Install with frozen lockfile.
- Typecheck CMS.
- Typecheck Web.
- Lint.
- Unit tests for registry and resolver.
- Layer precedence tests.
- CMS production build.
- Web production build.
- Build output inspection.

Record exact commands and results. If a command is unavailable, report it rather than inventing a pass.

---

## 17. Implementation phases

### Phase 0 — Audit only

Deliver current architecture map, registry, paths, scripts, Vercel and risk analysis. No code changes.

### Phase 1 — Normalize repository/workspace

- Confirm root workspace and package manager.
- Confirm app directories.
- Confirm shared source paths.
- Ensure workspace dependency declarations are accurate.
- Preserve current lockfile behavior.

### Phase 2 — Customer registry and resolver

- Add typed Customer Registry.
- Add schema validation.
- Add fixed app kind per host.
- Add safe path resolution and path containment.
- Add build identity logging.
- Add unit tests for all invalid cases.

### Phase 3 — Base Layer cleanup

- Ensure Core/Config/API/CMS/Web Base Layers are clearly separated.
- Remove accidental customer-specific values from Base Layers.
- Move generic defaults into explicit default Customer Layers where appropriate.
- Ensure host app remains minimal.
- Confirm Nuxt layer precedence with tests.

### Phase 4 — Customer Layer normalization

- Normalize folder names and registry mapping.
- Separate CMS and Web Customer Layers.
- Move branding/assets to the correct layer.
- Allow deep Web customization without changing Core/API contracts.
- Add asset staging only if Nuxt layer asset merging needs it.

### Phase 5 — Build scripts

- Add `build:vercel` for CMS and Web.
- Add prebuild validation.
- Ensure commands run from Vercel's Root Directory and resolve repository root robustly.
- Ensure no shared output directories.
- Add build output inspection.

### Phase 6 — Local verification

- Clean install with frozen lockfile.
- Build all representative customer/app combinations.
- Check mode, branding, assets, config and output isolation.
- Fix all discovered issues before Vercel deployment.

### Phase 7 — Vercel Project setup

Create/import one Vercel Project per customer/app deployment.

For each Project:

- Connect same Git repository.
- Set Root Directory (`tm-cms` or `tm-web`).
- Enable source outside Root Directory.
- Set build command.
- Verify workspace installation.
- Add environment variables for Production/Preview/Development.
- Add correct domains.
- Deploy Preview first.

Do not change the Production domain until Preview checks pass.

### Phase 8 — CI/deployment optimization

Only after stable builds:

- Evaluate Vercel native monorepo affected-project skipping.
- Verify workspace package graph is explicit.
- Add path-aware Ignored Build Step only if native dependency tracking is insufficient.
- Add tests proving each path causes correct project rebuilds.
- Prefer fail-open (build) when change detection is uncertain.

### Phase 9 — Operational documentation

Create/update:

- `docs/deployment/vercel-project-matrix.md`
- `docs/deployment/add-customer.md`
- `docs/deployment/customer-env-template.md`
- `docs/architecture/nuxt-layer-inheritance.md`
- `docs/architecture/customer-build-engine.md`

Document how to add one CMS-only customer and one CMS+Web customer.

---

## 18. Adding a new customer — future operating procedure

Once the platform is implemented, adding a customer should require no change to the host Nuxt config or build command.

### Step 1: Register Customer Layers

Create:

```text
tm-shared/customer-layers/cms/new-customer-cms/
tm-shared/customer-layers/web/new-customer-web/   # Only if website is required
```

Each must contain a valid `nuxt.config.ts` and customer-specific files only.

### Step 2: Register customer

Add one allowlisted entry in the Customer Registry:

```ts
newcustomer: {
  customerId: 'newcustomer',
  displayName: 'New Customer',
  status: 'active',
  apps: {
    cms: {
      enabled: true,
      layerPath: 'tm-shared/customer-layers/cms/new-customer-cms',
      displayName: 'New Customer CMS',
    },
    web: {
      enabled: true,
      layerPath: 'tm-shared/customer-layers/web/new-customer-web',
      displayName: 'New Customer Website',
    },
  },
}
```

For CMS-only customer, omit/disable `web` and do not create a Web Vercel Project.

### Step 3: Configure TM Hub and database

- Register/verify the customer's tenant and CMS app installation in TM Hub.
- Register Web installation only if website is used.
- Ensure CMS and Web app installations map to the same tenant.
- Assign separate CMS and Web credentials.
- Provision one customer database or approved database namespace.
- Give CMS the required read/write access.
- Give Web read-only access to required public/published data only.
- Configure controlled media sharing for the same tenant if Web needs to display media uploaded by CMS.

Do not put any credentials in the Git repository.

### Step 4: Create Vercel Projects

For CMS:

- Import same Git repository.
- Project name `tm-cms-newcustomer`.
- Root Directory `tm-cms`.
- Enable outside-root source inclusion.
- Build Command `pnpm run build:vercel`.
- Set `TM_CUSTOMER_ID=newcustomer`.
- Set CMS Hub/database environment variables.

For Web (if required):

- Import same Git repository.
- Project name `tm-web-newcustomer`.
- Root Directory `tm-web`.
- Enable outside-root source inclusion.
- Build Command `pnpm run build:vercel`.
- Set `TM_CUSTOMER_ID=newcustomer`.
- Set Web Hub/database/site environment variables.

### Step 5: Preview and promote

- Deploy Preview.
- Confirm correct selected layer.
- Confirm branding and public assets.
- Confirm API and database tenant mapping.
- Confirm no cross-customer access.
- Confirm SEO/site URL.
- Promote/deploy Production only after checks pass.

---

## 19. Definition of Done

The build architecture is complete only when all applicable items are proven:

- [ ] One Git repository contains CMS, Web, Shared source, Base Layers and Customer Layers.
- [ ] Multiple Vercel Projects can point to the same repository.
- [ ] CMS and Web use separate Root Directories.
- [ ] Vercel builds can include files outside Root Directory.
- [ ] CMS host always builds SPA.
- [ ] Web host always builds SSR.
- [ ] `TM_CUSTOMER_ID` selects the Customer Layer at build time.
- [ ] `extends` is not edited manually for each customer.
- [ ] Registry is allowlisted and schema-validated.
- [ ] Invalid/missing customer ID fails the build.
- [ ] Customer Layer has higher priority than Base Layers.
- [ ] Host app does not accidentally mask Customer Layer files.
- [ ] CMS Base and Web Base are isolated.
- [ ] CMS-only customer is supported.
- [ ] CMS+Web customer pair is supported.
- [ ] Branding assets are correct in build output.
- [ ] PWA/SPA loader is correct for CMS where enabled.
- [ ] SEO/site URL is correct for Web.
- [ ] No customer-specific secrets exist in source layers.
- [ ] DB and Hub credentials are configured per Vercel Project/environment.
- [ ] CMS and Web of one customer map to the same tenant/database as intended.
- [ ] Web uses appropriate read-only access.
- [ ] Customer A and Customer B artifacts do not leak each other's assets/config.
- [ ] Build/install works with frozen lockfile.
- [ ] At least two customers × CMS/Web build matrix passes, plus CMS-only case if applicable.
- [ ] Vercel Preview deployment has been checked before Production.
- [ ] Build skip optimization is either verified or intentionally left disabled.
- [ ] Documentation for adding a customer is complete.

---

## 20. Final instructions to AI coding agent

Implement this architecture as a controlled refactor of the existing repository, not as a blind rewrite.

Start with Phase 0 and report the current implementation. Then make the smallest safe set of changes to achieve:

**One main repository → two host apps (`tm-cms`, `tm-web`) → shared Base Layers → allowlisted Customer Layer selected by `TM_CUSTOMER_ID` → many independent Vercel Projects.**

The same generic build command must work for every customer. Customer-specific selection belongs in build-time registry/resolver and Vercel Environment Variables, not in manual edits to `extends`.

Do not claim production readiness until:

1. The exact CMS and Web commands pass locally.
2. Customer layer precedence is verified.
3. The selected customer branding is verified in build outputs.
4. A Vercel Preview deployment for each host type is verified.
5. Tenant/database/Hub credential mapping is reviewed for isolation.

If the actual repository layout differs from the examples, preserve the architectural requirements and adapt paths/scripts with an explicit report. Do not force the example folder layout at the expense of existing working code.

---

## 21. Official references

The following documentation should be checked again during implementation because platform details can evolve:

- Nuxt 4 Layers: https://nuxt.com/docs/4.x/getting-started/layers
- Nuxt Layers examples: https://nuxt.com/docs/examples/advanced
- Vercel Monorepos: https://vercel.com/docs/monorepos
- Vercel Monorepos FAQ: https://vercel.com/docs/monorepos/monorepo-faq
- Vercel Nuxt deployment: https://vercel.com/docs/frameworks/full-stack/nuxt
- Vercel Project Settings: https://vercel.com/docs/project-configuration/project-settings
- Vercel Environment Variables: https://vercel.com/docs/environment-variables

Implementation notes verified against Vercel's current monorepo documentation:

- Multiple Vercel Projects can connect to the same Git repository, each with its own Root Directory.
- A Vercel Project can include source files outside its Root Directory when the corresponding setting is enabled.
- By default, a commit can trigger builds for all connected Projects.
- Native skipping of unaffected monorepo projects depends on workspace configuration and explicitly declared package dependency relationships.
- If custom ignored-build logic is used, it must be tested and must fail open when changed-file detection is uncertain.

Do not hardcode assumptions about UI labels or plan limits; verify current Vercel account/project settings when creating deployments.
