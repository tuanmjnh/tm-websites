# Báo cáo: Customer Layers, Branding & Vercel Build Verification

**Ngày:** 2026-11-04  
**Phạm vi:** `D:\Applications\tm-websites` (`tm-shared`, `tm-cms`, `tm-web`)  
**Tài liệu nguồn:** `YÊU CẦU ĐIỀU CHỈNH KIẾN TRÚC CUSTOMER LAYERS & VERCEL BUILD`, `TM-Hub-Tenant-App-Installation-Upgrade.md`, scaffolding plan/spec.

---

## 1. Kết luận

Kiến trúc multi-customer đã hoạt động end-to-end ở mức build:

- Customer được chọn tự động bằng `TM_CUSTOMER_ID`; không sửa `extends` thủ công.
- Customer Layer luôn đứng đầu `extends`, nên override được Base Layer; Host App không chứa branding/pages/layouts để tránh che khuất.
- Mỗi customer có branding, manifest PWA (CMS), SEO metadata (Web) riêng trong layer của mình.
- Đã build production thành công 4 tổ hợp: CMS/Web × sentuan/bagpost.
- Build của customer này không chứa branding của customer khác.
- `tm-cms` là SPA (`ssr: false`), `tm-web` là SSR (`ssr: true`), đã kiểm chứng bằng output runtime.
- Typecheck, lint, registry/scaffold/layer validators đều PASS.
- Phase 7 (Hub foundation): `useHub` dùng chung ở `api-base` với header `X-App-Id`/`X-Tenant-Id`/`Bearer`, refresh một lần khi 401; contracts Hub (`AuthTokens`, `Tenant`, `AppInstallation`, `Site`) có test tự động.
- CMS có luồng đăng nhập thật: `/login` + middleware chặn route; login → dashboard → logout và chặn truy cập trực tiếp đã kiểm chứng trên trình duyệt.
- Phase 8 (real Hub): CMS BFF gọi TM Hub thật tại `https://tm-hub-app.vercel.app`; access/refresh token chỉ nằm trong cookie HttpOnly `tm_access_token`/`tm_refresh_token`, trình duyệt không nhận token. Có `/api/auth/refresh` và proxy `/api/hub/[...path]` (chỉ `/api/v1/`, chặn `..`, absolute URL, query smuggling).
- Lỗi Hub được map thành mã ổn định (`INVALID_APP`, `INVALID_CREDENTIALS`, `NO_APP_ACCESS`, `RATE_LIMITED`, `TOTP_REQUIRED`, `HUB_UNAVAILABLE`) và dịch vi/en trên login UI.
- Phase 16 (TOTP 2 bước): login trả 409 `TOTP_REQUIRED` thì UI chuyển sang bước nhập mã; BFF giữ challenge token trong cookie HttpOnly `tm_totp_pending` (5 phút, khớp TTL Hub) và hoàn tất qua `/api/auth/totp` → `/api/v1/auth/totp/login`; sai mã giữ nguyên cookie để thử lại, challenge hết hạn/hết lượt thì xóa cookie và yêu cầu đăng nhập lại.
- `pnpm hub:check` xác nhận real Hub healthy (`/api/health`, `/api/v1/health`).
- Phase 9 (provisioning): `tm-hub` có seed mới `pnpm seed:websites` tạo tenant/site/app/role/user cho toàn bộ registry `tm-websites`; real Hub login bằng `sentuan-admin@example.com` qua BFF đã trả 200, session/proxy/refresh/logout hoạt động đúng trên Hub production.
- Phase 10 (live CMS admin): Dashboard, Users, Roles, App Configuration, Audit Log và Settings đọc dữ liệu thật từ TM Hub qua BFF; quyền truy cập theo capability (`apps.read`, `users.read`, `roles.read`, `configs.read`, `apps.logs.read`). Icon động (nav, KPI, trạng thái) hiển thị đúng sau khi chuyển toàn bộ icon class thủ công sang `<UIcon>` và bật icon provider cục bộ.
- Phase 11 (content module): trang Content đọc dữ liệu thật từ Hub qua endpoint `/api/v1/content?appId=...` (list + detail modal, filter trạng thái, search debounce, copy payload). Endpoint nội dung chỉ yêu cầu xác thực (không có capability `content.read` trong Hub RBAC) nên UI không gate theo quyền; nav Content hiển thị cho mọi phiên hợp lệ — đồng bộ đúng hành vi Hub.
- Phase 12 (media integration): Media Library nối cổng media thật của TM Hub (`/media/folders`, `/media/resources`), duyệt thư mục + phân trang cursor, thumbnail Cloudinary. Khi app chưa cấu hình Cloudinary, Hub trả 400 `error.cloudinaryNotConfigured` và CMS hiển thị callout "cổng media chưa cấu hình" kèm đúng 3 khóa cần thiết — không còn dữ liệu mẫu bịa. Sửa thêm `CmsBasePage`: icon empty-state chuyển sang `<UIcon>` (hết icon trống) và chuỗi hardcode tiếng Việt ("Đã xảy ra lỗi") chuyển sang i18n.
- Phase 13 (notifications): trang Notifications đọc dữ liệu thật (`/apps/:id/notifications`, cursor paging), đánh dấu đã đọc từng cái / tất cả, lọc all/unread; thêm hành động soạn thông báo (`POST /notifications/send`) gate theo `notifications.send`, form `UForm` + zod (title/body/url).
- Phase 14 (mail center): trang Mail Center nối cổng mail thật — templates (`/mail/templates`, có phân trang + lọc trạng thái), analytics summary (`/mail/analytics/summary`, đủ 14 trường), hàng đợi gửi (`/mail/queue`). Mỗi khối gate theo capability riêng (`mail.manage` / `mail.analytics.read` / `mail.send`); trang chỉ hiển thị khi có ít nhất một quyền, các khối thiếu quyền hiện thông báo thay vì 403 toàn trang.
- Phase 15 (routes & connections): trang App Routes (`/routes`, cây tuyến + phân trang cursor, lọc visible/hidden/gated) và trang Integrations (`/connections`, 7 provider từ code-registry + trạng thái kết nối). Cả hai là **Hub resource page gate theo capability** — không thêm vào entitlement nghiệp vụ vì không thuộc nhóm module có `dataSource`.
- **Đồng bộ seed RBAC (tm-hub):** vai trò `admin` của tm-websites được cấp thêm `connections.read`, `mail.manage`, `mail.analytics.read`, `notifications.send` để khớp với bề mặt CMS đã ship; `seedRole` cập nhật permissions tại chỗ nên `pnpm seed:websites` đồng bộ được, không cần reset.

---

## 2. Cấu trúc hiện tại

```text
tm-websites/
├── scripts/
│   ├── build/
│   │   ├── validate-build.ts        # gate bắt buộc trước nuxt build
│   │   ├── validate-registry.ts     # kiểm registry + identity + assets
│   │   ├── test-layer-priority.ts   # kiểm thứ tự extends + override
│   │   ├── test-hub-contracts.ts    # kiểm contracts + helper Hub
│   │   └── check-hub.ts             # health probe real TM Hub
│   ├── generate-customer.ts         # scaffold customer layer mới + cập nhật registry
│   └── verify-scaffold.ts           # kiểm toàn bộ workspace (136 checks)
├── tm-shared/
│   ├── packages/                    # flow-contracts, flow-config, flow-utils, design-system
│   ├── nuxt-layers/                 # core-base, api-base, config-base, cms-base, web-base
│   └── customer-layers/
│       ├── registry/
│       │   ├── schema.ts            # kiểu registry
│       │   ├── customers.ts         # nguồn chuẩn: customerId, tenantId, appId, assets
│       │   └── resolver.ts          # resolve layer + kiểm path, chống thoát repo root
│       ├── cms/{default-cms,sentuan-cms,bag-post-cms,thanh-tung,hoang-vi}
│       └── web/{default-web,sentuan-web,bag-post-web}
├── tm-cms/                          # host SPA, không có app/pages hoặc app/layouts
└── tm-web/                          # host SSR, không có app/pages hoặc app/layouts
```

Mỗi customer layer có:

```text
<layer>/
├── nuxt.config.ts        # app.head: favicon, manifest (CMS), description/OG (Web), theme-color
├── app/app.config.ts     # customerId, tenantId, cmsAppId/webAppId, theme, entitlements
├── app/pages/            # (tuỳ chọn) page override, ví dụ sentuan-web
├── public/branding/      # logo.svg, favicon.svg, icon-192/512.png (CMS), og-cover.png (Web)
└── public/manifest.webmanifest  # CMS only
```

---

## 3. File đã tạo / sửa trong phiên này

### Registry & resolver
- `tm-shared/customer-layers/registry/schema.ts`: thêm `tenantId`, `companyName`, `appId`, `requiredAssets`, `domains`.
- `tm-shared/customer-layers/registry/customers.ts`: khai báo identity + asset bắt buộc cho 5 customer; thêm marker `// __TM_REGISTRY_ENTRIES__` cho generator.
- `tm-shared/customer-layers/registry/resolver.ts`: trả về `tenantId`, `appId`, `companyName`, `domains`, `requiredAssets`; kiểm thiếu identity.
- Chuẩn hóa `customerId` trong `app.config.ts` về đúng key registry (`bagpost`, `thanhtung`, `hoangvi`).

### Host applications
- `tm-cms/nuxt.config.ts`: `hubAppId`/`tenantId` lấy từ registry; fail-closed khi `VERCEL` mà thiếu `TM_CUSTOMER_ID`.
- `tm-web/nuxt.config.ts`: `siteId=main`, `appId`/`tenantId` lấy từ registry; fail-closed tương tự.
- `tm-cms/server/api/auth/session.get.ts`, `login.post.ts`: bỏ hard-code `tenant_sentuan`/`app_sentuan_cms`; dùng `runtimeConfig`.
- `tm-shared/nuxt-layers/web-base/app/pages/index.vue`, `layouts/default.vue`: bỏ nội dung trang sức đặc thù Sen Tuấn, dùng nội dung generic.
- `tm-shared/customer-layers/web/sentuan-web/app/pages/index.vue`: page override giữ nội dung storefront Sen Tuấn.

### Hub auth & contracts (Phase 7)
- `tm-shared/packages/flow-contracts/src/auth.ts`: thêm `AuthTokens`, `HubAuthResponse`, `Tenant`, `AppInstallation`, `Site`; `LoginResponse` nhận thêm `tokens` mà vẫn giữ `token`/`expiresAt` cũ.
- `tm-shared/packages/flow-utils/src/hub.ts`: `resolveHubUrl`, `buildHubHeaders`, `shouldAttemptTokenRefresh`, `extractHubTokens`, `getErrorStatus` (thuần TS, test bằng `tsx`).
- `tm-shared/nuxt-layers/api-base/app/composables/useHub.ts`: composable dùng chung cho cả CMS và Web; tự gắn header, refresh một lần khi gặp 401 ngoài endpoint auth, giữ session qua `useState`, login/logout qua BFF.
- Xóa `tm-cms/app/composables/useHub.ts` để tránh bản trùng trong host.
- `tm-shared/nuxt-layers/cms-base/app/pages/login.vue`: trang đăng nhập Nuxt UI + zod, i18n vi/en, branding lấy từ customer config.
- `tm-shared/nuxt-layers/cms-base/app/middleware/auth.global.ts`: chặn route khi chưa có session, chuyển `/login`; đã đăng nhập thì vào thẳng dashboard.
- `tm-cms/i18n/locales/{vi,en}.json`: thêm nhóm key `auth.*` (lưu ý escape `{'@'}` cho placeholder email để tránh lỗi linked-message của Vue I18n).
- `tm-cms/nuxt.config.ts`, `tm-web/nuxt.config.ts`: bổ sung `hubUrl`/`hubAppId`/`appId` trong `runtimeConfig.public` để composable dùng chung typecheck được ở cả hai host.
- `scripts/build/test-hub-contracts.ts` + script `pnpm test:hub`: 18 checks.
- `tm-shared/nuxt-layers/api-base/package.json`, `cms-base/package.json`: khai báo `@tm/flow-contracts`, `@tm/flow-utils`, `zod` để layer tự resolve trong pnpm workspace.

### Real Hub integration (Phase 8)
- `tm-cms/.env`, `tm-cms/.env.example`, `tm-web/.env`, `tm-web/.env.example`: `TM_HUB_URL=https://tm-hub-app.vercel.app`, `TM_AUTH_MODE=hub`, `TM_CUSTOMER_ID`; chỗ trống cho `TM_CMS_APP_ID`/`TM_WEB_APP_ID`/`TM_TENANT_ID`/`TM_SITE_ID` để fallback registry. File `.env` bị gitignore, `.env.example` được track.
- `tm-cms/server/utils/hubClient.ts`: login/me/refresh/logout Hub, map `userId`→`id`, giữ role id/capabilities, inject `tenantId` từ registry; `HubRequestError` + `translateHubAuthError`.
- `tm-cms/server/utils/authSession.ts`: cookie HttpOnly `tm_access_token`/`tm_refresh_token` (SameSite=Lax, secure ở production), `isMockAuth` theo `TM_AUTH_MODE`.
- `tm-cms/server/api/auth/{login.post,session.get,refresh.post,logout.post}.ts`: BFF thật; session tự refresh khi access token hết hạn; logout revoke refresh token rồi xóa cookie.
- `tm-cms/server/api/hub/[...path].ts`: proxy xác thực tới Hub, chỉ cho `/api/v1/`, gắn `X-App-Id`/`X-Tenant-Id`/`Bearer`, refresh + retry một lần khi 401, `Cache-Control: no-store`.
- `tm-shared/nuxt-layers/api-base/app/composables/useHub.ts`: bỏ token khỏi client state; `hubFetch` đi qua BFF, refresh qua `/api/auth/refresh`, expose `loginError`.
- `tm-shared/packages/flow-contracts/src/auth.ts`: `UserSession` nhận `roles: string[]` (Hub role id), `username`, `allowedRoutes`, `totpEnabled`.
- `tm-shared/packages/flow-utils/src/hub.ts`: thêm `sanitizeHubProxyPath` (test path traversal/absolute URL/query smuggling).
- `tm-shared/nuxt-layers/cms-base/app/pages/login.vue` + i18n: hiển thị lỗi Hub theo mã; bước TOTP 2 giai đoạn (nhập mã 6 chữ số hoặc recovery code, nút quay lại) — chi tiết Phase 16.
- `scripts/build/check-hub.ts` + `pnpm hub:check`: probe health real Hub.
- `scripts/build/validate-build.ts`: Vercel bắt buộc `TM_HUB_URL` https, cấm `TM_AUTH_MODE=mock`; `TM_HUB_SECRET` không còn bắt buộc.

### Live CMS admin (Phase 10)
- `tm-shared/packages/flow-contracts/src/hub-admin.ts`: thêm `HubAppConfigMetaSchema`, `HubAuditActorSchema`, `HubAuditLogSchema`, `HubConfigListPayloadSchema`.
- `tm-shared/nuxt-layers/cms-base/app/composables/useHubAdmin.ts`: thêm `fetchAuditLogs` (`/audit-logs`) và `fetchConfigs` (`/configs`) ngoài `fetchAppDetail`/`fetchUsers`/`fetchRoles`.
- `tm-shared/nuxt-layers/cms-base/app/pages/index.vue`: Dashboard viết lại theo dữ liệu thật (trạng thái bản cài đặt, số thành viên, vai trò, phân hệ được cấp, hồ sơ app/tenant, hoạt động gần đây); bỏ toàn bộ KPI đơn hàng giả.
- `tm-shared/nuxt-layers/cms-base/app/pages/configs.vue`: trang App Configuration (read-only, secrets do Hub che), tìm kiếm, thống kê public/secret/category, đủ loading/empty/error.
- `tm-shared/nuxt-layers/cms-base/app/pages/audit.vue`: trang Audit Log (action/model/actor/field/thời gian), thống kê entries/actors/records/latest, đủ loading/empty/error/refresh.
- `tm-shared/nuxt-layers/cms-base/app/layouts/default.vue`: nav thêm App Configuration (`configs.read`) và Audit Log (`apps.logs.read`); nav icon dùng `<UIcon>`.
- `tm-cms/i18n/locales/{en,vi}.json`: thêm `dashboard.*`, `admin.configs.*`, `admin.audit.*`, `nav.configs`, `nav.audit`.
- `tm-shared/nuxt-layers/core-base/nuxt.config.ts`: icon provider cục bộ (`provider: 'server'`, `serverBundle: { collections: ['lucide'] }`, `clientBundle.icons` liệt kê toàn bộ icon dùng trong app) — sửa lỗi icon trống khi SPA dùng CDN iconify và class động không được sinh CSS.
- Thay toàn bộ `<span class="i-lucide-*">`/`<span :class="[icon]">` bằng `<UIcon>` ở `cms-base`, `web-base` và `sentuan-web` (nav, KPI, logo, empty/error state, badge phụ).
- `scripts/build/test-hub-contracts.ts`: thêm check parse config/audit contracts (21 checks).

### Content module (Phase 11)
- `tm-shared/packages/flow-contracts/src/hub-admin.ts`: thêm `HubContentEntrySchema` (`_id`, `appId`, `key`, `title`, `description?`, `category?`, `contentType` mặc định `json`, `isPublished`/`isDeleted` mặc định `false`, `updatedBy?`, `updatedAt?`, `metadata?`, `data?`).
- `tm-shared/nuxt-layers/cms-base/app/composables/useHubAdmin.ts`: thêm `fetchContent` gọi `api/v1/content` (không app-scoped), truyền `appId`, `status`, `search`, `includeUnpublished`.
- `tm-shared/nuxt-layers/cms-base/app/pages/content.vue`: trang Content (list + `UModal` detail), filter trạng thái (`all`/`published`/`hidden`), search debounce 400ms, stats total/published/hidden/categories, copy payload qua clipboard + toast, đủ loading/empty/error/refresh. Không gate theo capability vì Hub không có `content.read`.
- `tm-shared/nuxt-layers/cms-base/app/layouts/default.vue`: nav item Content (`/content`, icon `i-lucide-file-pen`) không gate quyền.
- `tm-cms/i18n/locales/{en,vi}.json`: thêm `nav.content` và nhóm `admin.content.*`.
- `scripts/build/test-hub-contracts.ts`: thêm check parse content contracts (22 checks).

### Media integration (Phase 12)
- `tm-shared/packages/flow-contracts/src/hub-admin.ts`: thêm `HubMediaFolderSchema` (`name`, `path`), `HubMediaResourceSchema` (Cloudinary search shape: `public_id`, `filename?`, `format?`, `resource_type` mặc định `image`, `type?`, `folder?`, `bytes` mặc định 0, `width?`/`height?`, `created_at?`, `secure_url?`), `HubMediaFoldersPayloadSchema` và `HubMediaResourcesPayloadSchema`.
- `tm-shared/nuxt-layers/cms-base/app/composables/useHubAdmin.ts`: thêm `fetchMediaFolders(folder?)` → `api/v1/apps/:id/media/folders`, `fetchMediaResources({ folder, limit, cursor })` → `api/v1/apps/:id/media/resources`; expose `getHubErrorCode` để trang phân biệt lỗi cấu hình.
- `tm-shared/nuxt-layers/cms-base/app/pages/media.vue`: viết lại theo cổng media thật — stats (tài nguyên/thư mục/ảnh/dung lượng đang xem), breadcrumb thư mục (Gốc → thư mục), danh sách thư mục drill-down, grid asset với thumbnail Cloudinary + kích thước + thời gian, nút "tải thêm" theo cursor, đủ loading/error/refresh; 400 `error.cloudinaryNotConfigured` hiển thị callout cấu hình thay vì lỗi chung; giữ gate entitlement `media`.
- `tm-shared/nuxt-layers/cms-base/app/components/CmsBasePage.vue`: empty-state icon `<span :class>` → `<UIcon :name>`; tiêu đề lỗi và empty-text mặc định chuyển sang i18n (`common.error`, `common.noData`).
- `tm-shared/nuxt-layers/core-base/nuxt.config.ts`: thêm icon bundle `chevron-right`, `cloud-off`, `house` (111 icons).
- `tm-cms/i18n/locales/{en,vi}.json`: thêm nhóm `admin.media.*` (title, description, disabled, root, upload, folders/resources, empty, stats, cloudinary callout).
- `scripts/build/test-hub-contracts.ts`: thêm check parse folders/resources contracts (23 checks).

### Notifications, Mail Center, Routes & Connections (Phase 13–15)
- `tm-shared/packages/flow-contracts/src/hub-admin.ts`: thêm `HubMailTemplateSchema`/`HubMailTemplateListPayloadSchema`, `HubMailAnalyticsSummarySchema`, `HubMailQueuePayloadSchema`, `HubRouteSchema`/`HubRouteListPayloadSchema`, `HubConnectionSchema`/`HubConnectionProviderSchema`/`HubConnectionsPayloadSchema`.
- `tm-shared/nuxt-layers/cms-base/app/composables/useHubAdmin.ts`: thêm `sendNotification`, `markNotificationRead`/`markAllNotificationsRead`, `fetchMailTemplates`/`fetchMailAnalyticsSummary`/`fetchMailQueue`, `fetchRoutes`, `fetchConnections`.
- `tm-shared/nuxt-layers/cms-base/app/pages/notifications.vue`: viết lại theo API thật — cursor paging, mark read/read-all (optimistic), filter all/unread, stats, modal soạn thông báo (`UForm` + zod).
- `tm-shared/nuxt-layers/cms-base/app/pages/mail.vue`: trang mới — templates + analytics rates + queue, gate theo từng capability (`canViewTemplates`/`canReadAnalytics`/`canReadQueue`), filter trạng thái.
- `tm-shared/nuxt-layers/cms-base/app/pages/routes.vue`: trang mới — thống kê total/visible/gated/groups, lọc, danh sách tuyến (label qua `te()` để hỗ trợ i18n key), gated badge.
- `tm-shared/nuxt-layers/cms-base/app/pages/connections.vue`: trang mới — provider registry (media/storage/OAuth), badge trạng thái (connected/disabled/error/notConnected), không trộn AI providers.
- `tm-shared/nuxt-layers/cms-base/app/layouts/default.vue`: nav gate `routes.read` → `/routes`, `connections.read` → `/connections`, `mail.manage` → `/mail`.
- `tm-shared/nuxt-layers/core-base/nuxt.config.ts`: bundle icon bổ sung (`bell-ring`, `check`, `check-check`, `circle-check`, `circle-dashed`, `cable`, `plug`, `plug-zap`, `mail-check`, `mouse-pointer-click`, `send`, `eye-off`, `external-link`) → 122 icons.
- `tm-cms/i18n/locales/{en,vi}.json`: thêm nhóm `admin.mail.*`, `admin.routes.*`, `admin.connections.*`, `nav.mail/routes/connections`, và key bổ sung cho notifications (`form.*`, `compose`, `markAll`).
- `tm-hub/scripts/seed/apps/tm-websites.ts`: vai trò `admin` thêm `connections: ['read']`, `mail: ['read','send','manage','analytics.read']`, `notifications: ['read','send']`; đồng bộ bằng `pnpm seed:websites` (incremental).
- `scripts/build/test-hub-contracts.ts`: thêm check parse mail/route/connection contracts (28 checks tổng).

### TOTP hai bước (Phase 16)
- `tm-cms/server/utils/hubClient.ts`: `hubLogin` trả union `{ totpRequired: true, pendingTotpToken } | { totpRequired: false, user, tokens }` (không còn ném lỗi 409); thêm `hubTotpLogin(event, { pendingTotpToken, code })` gọi `/api/v1/auth/totp/login` và `translateHubTotpError` (400 → `TOTP_INVALID_CODE`, 401 → `TOTP_CHALLENGE_EXPIRED`, 429 → `RATE_LIMITED`, 503 → `HUB_UNAVAILABLE`, còn lại 502).
- `tm-cms/server/utils/authSession.ts`: cookie HttpOnly `tm_totp_pending` (maxAge 300s, khớp TTL challenge 5 phút của Hub) + `setPendingTotpCookie`/`getPendingTotpCookie`/`clearPendingTotpCookie`; `clearAuthCookies` dọn luôn cookie này.
- `tm-cms/server/api/auth/login.post.ts`: khi `result.totpRequired` thì set cookie challenge và trả `errorResponse(409, 'TOTP_REQUIRED')`; ngược lại set cookie phiên như cũ.
- `tm-cms/server/api/auth/totp.post.ts` (mới): đọc `{ code }`, thiếu mã → 400 `TOTP_CODE_REQUIRED`; thiếu/hết hạn cookie → 401 `TOTP_CHALLENGE_EXPIRED`; gọi `hubTotpLogin`, thành công thì xóa cookie challenge + set cookie phiên; sai mã (Hub 400) **giữ** cookie để thử lại trong TTL.
- `tm-shared/nuxt-layers/api-base/app/composables/useHub.ts`: thêm state `totpRequired`, `verifyTotp(code)`, `cancelTotp()`, helper `readErrorCode`; `login()` bật cờ khi mã lỗi là `TOTP_REQUIRED`; `logout` reset cờ.
- `tm-shared/nuxt-layers/cms-base/app/pages/login.vue`: hai `UForm` (thông tin đăng nhập ↔ mã xác thực) theo `totpRequired`; schema zod riêng cho mã (`min(6)`/`max(32)` chấp nhận cả mã khôi phục `XXXXX-XXXXX`); ẩn alert khi lỗi là `TOTP_REQUIRED`; nút "Quay lại đăng nhập" gọi `cancelTotp()`.
- `tm-shared/nuxt-layers/core-base/nuxt.config.ts`: thêm icon `arrow-left` vào `clientBundle.icons`.
- `tm-cms/i18n/locales/{en,vi}.json`: thêm nhóm `auth.totp.*` (description, code, codePlaceholder, recoveryHint, submit, submitting, back, codeRequired, codeInvalid) và mã lỗi `TOTP_CODE_REQUIRED`/`TOTP_INVALID_CODE`/`TOTP_CHALLENGE_EXPIRED`/`TOTP_FAILED`.

### Provisioning in tm-hub (Phase 9)
- `tm-hub/scripts/seed/apps/tm-websites.ts`: seed tenant (`tenant_default`, `tenant_sentuan`, `tenant_bag_post`, `tenant_thanh_tung`, `tenant_hoang_vi`), site `main` cho customer có web, 8 app `app_<customer>_cms/web`, role root/admin và user `<customer>-root/admin@example.com`.
- `tm-hub/scripts/seed/index.ts`, `tm-hub/package.json`: target `websites` + script `pnpm seed:websites` / `seed:websites:reset`.
- Seed idempotent (chỉ tạo khi thiếu, không ghi đè tenant/site/app đã có); không dùng `--reset` trong phiên này.

### Branding / PWA / SEO
- Thêm bộ asset cho 8 layer (5 CMS, 3 Web) gồm logo, favicon, PWA icons 192/512, manifest (CMS), OG cover (Web).
- Cập nhật `nuxt.config.ts` của từng customer layer với `app.head` (favicon, manifest, theme-color, description, OG).
- Placeholder art hiện là mark hình học theo màu thương hiệu; cần thay bằng asset thật khi có.

### Scripts & gates
- `scripts/build/validate-build.ts`: yêu cầu `TM_CUSTOMER_ID` tuyệt đối; kiểm identity trong app.config, branding assets, manifest PWA + file icon, SEO/domain của Web, env production trên Vercel, secret scan toàn layer.
- `scripts/build/validate-registry.ts`: kiểm registry ↔ app.config ↔ assets ↔ manifest.
- `scripts/verify-scaffold.ts`: viết lại theo kiến trúc registry hiện tại (136 checks).
- `scripts/generate-customer.ts`: viết lại đúng đường dẫn, hỗ trợ `--web`, copy branding mẫu, tự chèn entry registry.
- `package.json`: thêm `validate:build:cms`, `validate:build:web`, `verify:scaffold`.
- `tm-shared/tsconfig.json`: chỉ typecheck phần thuần TS (packages + registry); layer được typecheck trong host app qua `.nuxt`.

---

## 4. Thứ tự kế thừa layer

Ví dụ CMS sentuan (`extends[0]` ưu tiên cao nhất, sau đó Host App vẫn cao nhất tuyệt đối):

1. `tm-shared/customer-layers/cms/sentuan-cms`
2. `tm-shared/nuxt-layers/cms-base`
3. `tm-shared/nuxt-layers/api-base`
4. `tm-shared/nuxt-layers/config-base`
5. `tm-shared/nuxt-layers/core-base`

Web bagpost:

1. `tm-shared/customer-layers/web/bag-post-web`
2. `tm-shared/nuxt-layers/web-base`
3. `tm-shared/nuxt-layers/api-base`
4. `tm-shared/nuxt-layers/config-base`
5. `tm-shared/nuxt-layers/core-base`

Host App không có `app/pages`, `app/layouts`, `app.config.ts` nên không che override của customer layer.

---

## 5. Cách chọn customer

- Vercel Project đặt `TM_CUSTOMER_ID` (`sentuan`, `bagpost`, ...).
- `nuxt.config.ts` gọi `resolveCustomerLayers({ appKind, customerId, repoRoot })`.
- Resolver kiểm: ID tồn tại, customer active, app kind được bật, `appId`/`tenantId` có khai báo, path layer tồn tại và không thoát repo root.
- Thiếu/sai ID hoặc layer → throw, build dừng. Trên Vercel, thiếu `TM_CUSTOMER_ID` không fallback về `default`.
- `validate-build.ts` chạy trước `nuxt build` trong `build:vercel`.

---

## 6. Cấu hình Vercel Project

Mỗi project kết nối cùng repository, không tạo repo riêng.

| Project | Root Directory | Build Command | Env bắt buộc | Domain |
|---|---|---|---|---|
| `tm-cms-sentuan` | `tm-cms` | `pnpm run build:vercel` | `TM_CUSTOMER_ID=sentuan`, `TM_HUB_URL=https://tm-hub-app.vercel.app`, `TM_AUTH_MODE=hub`, `TM_CMS_APP_ID` | admin domain của Sen Tuấn |
| `tm-web-sentuan` | `tm-web` | `pnpm run build:vercel` | `TM_CUSTOMER_ID=sentuan`, `TM_HUB_URL`, `TM_WEB_APP_ID` | `sentuan.vn`, `www.sentuan.vn` |
| `tm-cms-bagpost` | `tm-cms` | `pnpm run build:vercel` | `TM_CUSTOMER_ID=bagpost`, `TM_HUB_URL`, `TM_AUTH_MODE=hub`, `TM_CMS_APP_ID` | admin domain của Bag Post |
| `tm-web-bagpost` | `tm-web` | `pnpm run build:vercel` | `TM_CUSTOMER_ID=bagpost`, `TM_HUB_URL`, `TM_WEB_APP_ID` | `bagpost.vn`, `www.bagpost.vn` |

Bắt buộc trên cả 4 project:

- Framework Preset: Nuxt.
- Node.js: 24.
- **Include source files outside of the Root Directory in the Build Step: bật** (để truy cập `tm-shared` và `scripts`).
- pnpm workspace được nhận diện từ `pnpm-lock.yaml` ở repo root.
- Environment Variables đặt riêng cho Production/Preview/Development.
- `TM_APP_KIND=cms|web` là tuỳ chọn; nếu đặt sai, validator dừng build.
- `TM_HUB_URL` bắt buộc với CMS trên Vercel và phải là `https://`; `TM_AUTH_MODE=mock` bị chặn trên Vercel.
- **Provisioning:** mỗi `TM_CMS_APP_ID`/`TM_WEB_APP_ID` phải tồn tại trong TM Hub (`apps` + role/user của tenant). Giá trị registry hiện tại (`app_<customer>_cms|web`) chỉ dùng làm fallback; nếu chưa provision, login trả `INVALID_APP`.
- Có thể override `TM_TENANT_ID`, `TM_CMS_APP_ID`, `TM_WEB_APP_ID`, `TM_SITE_ID` khi cần, nhưng mặc định lấy từ registry.
- `TM_HUB_SECRET` là tuỳ chọn (server-only) nếu Hub app yêu cầu `X-Api-Key`.

---

## 7. Kết quả kiểm thử

### 7.1 Static gates

| Gate | Lệnh | Kết quả |
|---|---|---|
| Registry | `pnpm validate:registry` | PASS |
| Scaffold | `pnpm verify:scaffold` | PASS — 136/136 |
| Layer precedence | `pnpm test:layers` | PASS |
| Hub contracts/helpers | `pnpm test:hub` | PASS — 28/28 |
| Public content/SEO helpers | `pnpm test:web-content` | PASS — 21/21 |
| Hub health (real) | `pnpm hub:check` | PASS — 2/2 (`/api/health`, `/api/v1/health`) |
| Shared TS | `pnpm --dir tm-shared run typecheck` | PASS |
| App typecheck | `pnpm typecheck` | PASS |
| Lint | `pnpm lint` | PASS |

Chạy lại toàn bộ static suite sau Phase 16 (TOTP): `validate:registry`, `verify:scaffold`, `test:layers`, `test:hub` (28/28), `test:web-content` (21/21), `typecheck`, `lint` đều PASS; `TM_CUSTOMER_ID=sentuan pnpm build:cms` PASS (~27.4s, có chunk `routes/api/auth/totp.post.mjs` trong output).

### 7.2 Production builds

| Tổ hợp | Lệnh | Kết quả |
|---|---|---|
| CMS sentuan | `TM_CUSTOMER_ID=sentuan pnpm --dir tm-cms run build:vercel` | PASS (~26.4s) |
| CMS bagpost | `TM_CUSTOMER_ID=bagpost pnpm --dir tm-cms run build:vercel` | PASS (~25.9s) |
| Web sentuan | `TM_CUSTOMER_ID=sentuan pnpm --dir tm-web run build:vercel` | PASS (~37.6s) |
| Web bagpost | `TM_CUSTOMER_ID=bagpost pnpm --dir tm-web run build:vercel` | PASS (~37.9s) |

### 7.3 Runtime checks (chạy `node .output/server/index.mjs` + curl)

| Kiểm tra | Kết quả |
|---|---|
| CMS sentuan title / theme | `Sen Tuấn CMS` / `#f59e0b` |
| CMS bagpost title / theme | `Bag Post CMS` / `#10b981` |
| CMS manifest + icon 192/512 | HTTP 200 |
| CMS là SPA | HTML shell không chứa nội dung dashboard (0 match) |
| Web sentuan meta | title, description, `og:image=/branding/og-cover.png` |
| Web sentuan SSR | Hero "Đẳng Cấp Tinh Hoa" có trong HTML server-render |
| Web bagpost SSR | Nội dung generic "Sản phẩm Cao cấp A" có trong HTML |
| Isolation CMS bagpost | Không có `Sen Tuấn`, `sentuan`, `f59e0b` trong `.output` |
| Isolation Web bagpost | Không có `Sen Tuấn`, `kim cương`, `hoàng gia` trong build + HTML |
| Override base | `test:layers` xác nhận amber (customer) thắng violet (base); theme-color runtime đúng theo customer |
| Host không che layer | Host không có `app/pages`, `app/layouts`; page/layout lấy từ layer |
| Build tuần tự | sentuan → bagpost ghi đè sạch; output cuối không còn dấu vết customer trước |

### 7.4 Hub BFF runtime (dev server `TM_CUSTOMER_ID=sentuan`, `TM_AUTH_MODE=hub`)

| Kiểm tra | Lệnh / thao tác | Kết quả |
|---|---|---|
| Real Hub health | `pnpm hub:check` | 200/200; `/api/health` database connected, `/api/v1/health` status healthy |
| Anonymous session | `GET /api/auth/session` không cookie | 401 `UNAUTHENTICATED` |
| Refresh không cookie | `POST /api/auth/refresh` | 401 `NO_REFRESH_TOKEN` |
| Proxy path guard | `GET /api/hub/secret` | 400 `INVALID_PROXY_PATH` |
| Proxy chưa đăng nhập | `GET /api/hub/api/v1/auth/me` | 401 `UNAUTHENTICATED` |
| Real Hub login (trước provisioning) | `POST /api/auth/login` với app chưa tồn tại | 400 `INVALID_APP` — chứng minh BFF gọi Hub production |
| Token exposure | Kiểm cookie sau login | Chỉ cookie HttpOnly `tm_access_token`/`tm_refresh_token`; không có token trong JS state |
| Mock regression | `TM_AUTH_MODE=mock` login → session → refresh → logout | 200/200/200/200; cookie HttpOnly, session đúng tenant/app; logout xóa cookie |
| Route guard | Mở `/` và `/catalog` khi chưa đăng nhập | Chuyển `/login` |
| Vercel env guards | `VERCEL=1` thiếu URL / URL http / mock mode / hợp lệ | FAIL / FAIL / FAIL / PASS đúng thiết kế |

### 7.5 Provisioning & real Hub login (Phase 9)

Seed mới trong `tm-hub`: `scripts/seed/apps/tm-websites.ts`, chạy bằng `pnpm seed:websites` (incremental, không `--reset`).

| Kiểm tra | Lệnh / thao tác | Kết quả |
|---|---|---|
| Seed typecheck | `pnpm typecheck:seed` (tm-hub) | PASS |
| Seed chạy | `pnpm seed:websites` (tm-hub) | PASS — 5 tenant, 3 site, 8 app, 16 role, 10 user |
| Tenant | `tenants` | `tenant_default`, `tenant_sentuan`, `tenant_bag_post`, `tenant_thanh_tung`, `tenant_hoang_vi` active |
| Site | `sites` | `tenant_sentuan/main` (sentuan.vn), `tenant_default/main` (tm-web.vercel.app), `tenant_bag_post/main` (bagpost.vn) |
| Apps | `apps` | 8 app `app_<customer>_cms/web` gắn đúng `tenant_id`, `app_kind`, `installation_status=active` |
| Roles | `roles` | `root` (full) + `admin` cho từng app |
| Role assignment | `user_app_roles` | `<customer>-root` → root, `<customer>-admin` → admin |
| Real Hub login | `POST /api/auth/login` (`sentuan-admin@example.com`, app `app_sentuan_cms`) | 200; `roles:[admin]`, `tenantId=tenant_sentuan`, `appId=app_sentuan_cms` |
| Real Hub login (web app) | `POST https://tm-hub-app.vercel.app/api/v1/auth/login` app `app_sentuan_web` rồi logout | 200/200; token cấp đủ, logout revoke thành công |
| Cookie | Response headers sau login | `tm_access_token`, `tm_refresh_token`; `HttpOnly; SameSite=Lax; Path=/` (giá trị đã che) |
| Session | `GET /api/auth/session` | 200, đúng user/tenant/app, `totpEnabled=false` |
| Hub proxy | `GET /api/hub/api/v1/auth/me` | 200; Hub trả `features.passkey/totp` |
| Refresh | `POST /api/auth/refresh` → session | 200 → session vẫn 200 |
| Logout | `POST /api/auth/logout` → session | 200 → session 401 `UNAUTHENTICATED` |
| Sai mật khẩu | `POST /api/auth/login` | 401 `INVALID_CREDENTIALS` (map đúng, message vi) |

Tài khoản seed dùng mật khẩu mặc định trong `tm-hub/scripts/seed/shared.ts` (`BUILTIN_USER_PASSWORDS`); phải đổi trước khi dùng thật. Seed không in ra secret.

### 7.6 Live CMS admin verification (Phase 10)

Trình duyệt headless (Edge + CDP), đăng nhập thật qua BFF với `sentuan-admin@example.com`; không in credential/token.

| Trang | Dữ liệu thật | Kết quả |
|---|---|---|
| `/` Dashboard | App `app_sentuan_cms` Active; 2 members; 2 roles; 7 licensed modules; 26 capabilities; recent activity từ audit log | PASS — không lỗi |
| `/users` | 2 users (admin/root), 2 active, 2 distinct roles | PASS — không lỗi |
| `/roles` | 2 system roles (root/admin), 14 permission modules | PASS — không lỗi |
| `/configs` | 0 config keys (đúng dữ liệu Hub), empty state + search | PASS — không lỗi |
| `/audit` | 17 audit entries, 2 actors, 1 model (`Auth`), `auth.login` realtime | PASS — không lỗi |
| `/content` | 1 record `system_docs` (Published, `docs`, `json`, app `global`); detail modal mở đúng payload JSON | PASS — không lỗi |
| `/media` | Hub trả 400 `error.cloudinaryNotConfigured`; UI hiển thị callout cấu hình + 3 khóa `CLOUDINARY_*`, không còn dữ liệu mẫu | PASS — không lỗi |
| `/settings` | Registry + live Hub app record; session tenant/app | PASS — không lỗi |
| Icons | Nav/KPI/empty-state render SVG mask (không còn span trống) | PASS |
| Mobile nav | 4 link đầu + menu More chứa phần còn lại | PASS |

Endpoint detail cho `/content`: `GET /api/hub/api/v1/content?appId=app_sentuan_cms&status=all&includeUnpublished=true` trả 200 với 1 bản ghi `system_docs`; probe DOM xác nhận `content_diag` có 1 dòng và `content_modal` hiển thị key/payload (không còn thông báo thiếu quyền `content.read`).

Media/Notifications/Permissions/Routes probe trong cùng phiên: Media trả 400 `error.cloudinaryNotConfigured` (chưa cấu hình Cloudinary cho app); Notifications/Permissions/Routes trả 200 với mảng rỗng (đúng dữ liệu Hub hiện tại).

Gate cuối Phase 12: `pnpm test:hub` 23/23, `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm validate:registry` PASS, `pnpm verify:scaffold` 136/136, `pnpm test:layers` PASS, `TM_CUSTOMER_ID=sentuan pnpm validate:build:cms` PASS, `TM_CUSTOMER_ID=sentuan pnpm build:cms` PASS (~27s), `TM_CUSTOMER_ID=sentuan pnpm validate:build:web` PASS, `TM_CUSTOMER_ID=sentuan pnpm build:web` PASS (~37s). Probe live: `page=media errors=[]`, `media_diag` hiển thị callout "Media gateway not configured" + 3 khóa Cloudinary.

### 7.7 Live BFF probe cho Phase 13–15 (real Hub)

Đăng nhập thật qua BFF (`sentuan-admin@example.com`, `app_sentuan_cms`) bằng script đọc mật khẩu seed từ file nguồn **không in ra**; sau đó gọi proxy `/api/hub/api/v1/...` bằng cookie HttpOnly và chỉ ghi nhận status + cấu trúc payload (không in giá trị).

| Endpoint (qua BFF) | Trước khi vá seed | Sau khi vá seed | Shape trả về |
|---|---|---|---|
| `/apps/:id/notifications?limit=5` | 200 | 200 | `data:array(0)`, `nextCursor:null` |
| `/apps/:id/mail/templates?limit=5` | 403 (thiếu `mail.manage`) | 200 | `data:array(0)`, `pagination:{page,limit,total}` |
| `/apps/:id/mail/analytics/summary` | 403 (thiếu `mail.analytics.read`) | 200 | `data:{totalSent,…,period}` (14 trường, khớp schema) |
| `/apps/:id/mail/queue` | 200 | 200 | `data:{enabled,stats,jobs}` |
| `/apps/:id/routes?limit=100` | 200 | 200 | `data:{routes,tree}`, `nextCursor:null` |
| `/apps/:id/connections` | 403 (thiếu `connections.read`) | 200 | `data:array(7)` (7 provider) |

Guard bổ sung: gọi 4 endpoint trên khi **chưa** đăng nhập đều trả 401; `/api/hub/secret` trả 400 `INVALID_PROXY_PATH`; SPA `/mail` trả 200. Đối chiếu source `tm-hub` xác nhận response shape khớp hợp đồng zod và capability gate đúng (`mail.manage`, `mail.analytics.read`, `mail.send`, `routes.read`, `connections.read`, `notifications.read/send`).

Ghi chú: hành động ghi `POST /notifications/send` chưa chạy live để tránh tạo dữ liệu test trên Hub production — vai trò hiện tại không có `notifications.manage` để dọn dẹp; đường ghi được xác minh ở mức hợp đồng endpoint + quyền đã cấp.

### 7.8 Browser render của Phase 13–15 (Chrome DevTools MCP)

Xác minh render bằng `TM_AUTH_MODE=mock` (không dùng credential thật; tài khoản/khóa giả `ui-verify@example.com`) để kiểm tra mount + nav + i18n + icon mà không lộ mật khẩu seed.

| Kiểm tra | Kết quả |
|---|---|
| Nav sidebar | Hiện đủ item mới: **App Routes** (`/routes`), **Integrations** (`/connections`), **Email Center** (`/mail`) với nhãn i18n đúng |
| `/mail` | Tiêu đề "Email Center" + mô tả + nút Refresh + filter "All templates" render; không lỗi Vue |
| `/routes` | Tiêu đề "App Routes" + mô tả + filter "All routes" render |
| `/connections` | Tiêu đề "Integrations" + mô tả + Refresh render |
| `/notifications` | Tiêu đề + nút "Send notification" (compose) + "Mark all read" (disabled) + filter render |
| Console | Chỉ có 401 mong đợi từ mock token; **không** warning thiếu i18n key, không lỗi runtime Vue |

Dữ liệu thật đã được xác minh riêng ở 7.7 (probe BFF với phiên thật). Trong mock mode các call Hub trả 401 nên các trang hiển thị error-state — đúng thiết kế, không phải lỗi.

### 7.9 Content CRUD live trên Hub production (BFF, app `app_sentuan_web`)

Chủ sở hữu phê duyệt ghi thử vào app `sentuan`; bản ghi test đặt tên `ui_verify_20261105_<ts>` (category `ui-verify`) và đã **xóa cứng** để dọn sạch. Không in credential/token.

| Bước | Lệnh (qua BFF `/api/hub/api/v1/...`) | Kết quả |
|---|---|---|
| 1 Tạo | `POST /content` `{appId, key, title, data, isPublished:true}` | 200, trả `id` |
| 2 Chi tiết | `GET /content/:id` | 200, `isPublished=true` |
| 3 Danh sách | `GET /content?appId&includeUnpublished=true&includeDeleted=true&search=<key>` | 200, đúng 1 bản ghi |
| 4 Unpublish | `PATCH /content/:id` `{isPublished:false}` | 200, `isPublished=false` |
| 5 Xóa mềm | `PATCH /content/:id` `{isDeleted:true}` | 200, `isDeleted=true` |
| 6 Danh sách đã xóa | `GET /content?appId&includeDeleted=true&status=deleted&search=<key>` | 200, có mặt |
| 7 Khôi phục | `PATCH /content/:id` `{action:'restore'}` | 200, `isDeleted=false` |
| 8 Xóa cứng | `DELETE /content/:id?hard=true` | 200, `hard=true` |
| 9 Kiểm tra sạch | `GET /content?appId&includeDeleted=true&search=<key>` | 0 bản ghi còn lại |

Toàn bộ vòng create → publish → unpublish → soft-delete → restore → delete chạy đúng trên Hub production qua BFF HttpOnly session; capability `content.read`/`content.write` đã được cấp cho vai trò admin. Vòng nối sang Web (public endpoint) **chưa kiểm chứng live** vì `content/public.get.ts` chưa deploy (xem mục 8.16).

### 7.10 TOTP hai bước (Phase 16)

Kiểm chứng bằng **Hub giả cục bộ** (stub HTTP ở `localhost:4599`, không chạm Hub production) + dev server `TM_CUSTOMER_ID=sentuan TM_AUTH_MODE=hub TM_HUB_URL=http://localhost:4599`; stub trả `totpRequired` cho login, `123456` là mã đúng, còn lại 400. Stub + cookie jar đã xóa sau kiểm thử.

**BFF probe (curl, cookie jar):**

| Bước | Lệnh | Kết quả |
|---|---|---|
| 1 Login có TOTP | `POST /api/auth/login` | 409 `TOTP_REQUIRED`; set cookie HttpOnly `tm_totp_pending`, KHÔNG có cookie phiên |
| 2 TOTP thiếu challenge | `POST /api/auth/totp` (không cookie) | 401 `TOTP_CHALLENGE_EXPIRED` |
| 3 TOTP sai mã | `POST /api/auth/totp` + cookie, `code=000000` | 400 `TOTP_INVALID_CODE`; cookie challenge **được giữ** |
| 4 TOTP đúng mã | `POST /api/auth/totp` + cookie, `code=123456` | 200, set `tm_access_token`/`tm_refresh_token`, xóa `tm_totp_pending` |

**Browser render (browser-use, SPA `:4005`) — cả `en` và `vi`:**

| Kiểm tra | `en` | `vi` |
|---|---|---|
| Bước 1: form thông tin đăng nhập | "Sign in" / "Email" / "Password" | "Đăng nhập" / "Email" / "Mật khẩu" |
| Submit → chuyển bước TOTP | "Enter the 6-digit code…" + "Authentication code" | "Nhập mã 6 chữ số…" + "Mã xác thực" |
| Sai mã → alert | "The authentication code is incorrect or has expired." | "Mã xác thực không đúng hoặc đã hết hiệu lực." |
| Nút quay lại | "Back to sign in" → về form thông tin đăng nhập | "Quay lại đăng nhập" → về form thông tin đăng nhập |
| Đúng mã → điều hướng | 200 → `/` (Control Center) | (chung luồng) |
| Console | Chỉ 2 lỗi mạng dự kiến (409 login, 400 mã sai), không có lỗi bất ngờ | — |

Lưu ý: happy path được kiểm chứng bằng stub (Hub production chưa có tài khoản nào bật TOTP nên **không** kiểm chứng được với Hub thật trong phiên này — xem mục 8.2).

---

## 8. Vấn đề chưa giải quyết / giới hạn

> **Cập nhật 2026-11-06:** mục 4 và 12 đã lỗi thời — Web đã có service worker/offline shell (Task 16, đã kiểm chứng offline thật) và 6 module CMS đã bỏ dữ liệu mẫu; AI Workspace có nguồn dữ liệu trong tm-hub nhưng chưa nối UI. Trạng thái hiện tại: [`tasks/todo.md`](../../../tasks/todo.md).

1. **Tài khoản seed dùng mật khẩu mặc định**: các user `<customer>-root/admin@example.com` được tạo bởi seed tm-hub và dùng chung mật khẩu mẫu; phải đổi mật khẩu (hoặc thay bằng tài khoản thật) trước khi mở cho khách hàng.
2. **TOTP hai bước đã triển khai (Phase 16)**: login → 409 `TOTP_REQUIRED` → UI chuyển bước nhập mã → `/api/auth/totp` → Hub `/api/v1/auth/totp/login`. Challenge token nằm trong cookie HttpOnly `tm_totp_pending` (5 phút); sai mã giữ cookie để thử lại, 401/429 xóa cookie. Đã kiểm chứng end-to-end bằng Hub giả cục bộ (BFF probe + render `en`/`vi`, xem 7.10). **Chưa** kiểm chứng happy path với Hub production vì chưa có tài khoản nào bật TOTP; muốn xác nhận cần bật TOTP cho một tài khoản thật (ngoài phạm vi được cấp phép của phiên này). BFF chưa có endpoint đăng ký/khôi phục TOTP — đó là việc của Hub/tm-hub.
3. **Hub tenant/app phases 1–8** thuộc repo TM Hub, chưa triển khai trong `tm-websites`; contracts mới chỉ là kiểu dữ liệu dùng chung.
4. **PWA mới ở mức manifest**: chưa có service worker/offline cache (`@vite-pwa/nuxt` chưa cài).
5. **Branding là placeholder**: logo/favicon/icon/OG là mark hình học; cần thay asset thật.
6. **Chưa deploy thật lên Vercel** trong phiên này (không có credential); mới xác minh production build local. Deploy do người dùng thực hiện.
7. **`thanhtung`, `hoangvi` chỉ có CMS**: build Web cho hai customer này sẽ dừng có chủ đích vì registry không bật app `web`.
8. **Multi-site chưa triển khai**: `TM_SITE_ID` mặc định `main`; Site registry/domain mapping thuộc Hub.
9. **DB binding/secrets**: chưa có metadata DB binding; credentials phải nằm trong env server-only của từng Vercel Project.
10. **App Configuration read-only**: trang chỉ đọc; chưa có form ghi/xóa vì thao tác này thay đổi Hub production và chưa được yêu cầu.
11. **Audit Log phụ thuộc MongoDB của Hub**: nếu tenant chưa bật Mongo/audit, danh sách rỗng (UI hiển thị empty state, không lỗi).
12. **Module nghiệp vụ vẫn là placeholder**: Catalog, Orders, Inventory, Finance, Reports, AI còn dữ liệu mẫu hardcode và chưa nối dữ liệu tenant (chờ customer DB/API thuộc Phase 5 blueprint). Media đã nối cổng thật nhưng chưa có asset vì app chưa cấu hình Cloudinary (`error.cloudinaryNotConfigured`); Notifications/Mail/Routes/Connections đã nối dữ liệu thật (xem 7.7) nhưng hiện trả rỗng (chưa có bản ghi/route/provider được tạo cho app này).
13. **Content CRUD đã hoạt động**: `/api/v1/content` (auth + `content.read`/`content.write`) đã kiểm chứng live đủ vòng create → publish → unpublish → soft-delete → restore → hard-delete trên `app_sentuan_web` (xem 7.9), dữ liệu test đã dọn. Lưu ý `appId` content là app Web ghép cặp (`contentAppId`), không phải app CMS.
14. **Media/Mail/Routes/Connections chủ yếu chỉ đọc**: các trang duyệt dữ liệu thật qua Hub; Media chưa có upload/rename/delete (app chưa cấu hình Cloudinary, nút upload disable); Mail/Routes/Connections chưa có form ghi vì thao tác đó đổi dữ liệu Hub production và chưa được yêu cầu.
15. **Capability seed phải khớp bề mặt CMS**: các trang Hub resource (Mail, Connections) chỉ truy cập được khi vai trò có capability tương ứng (`mail.manage`/`mail.analytics.read`/`connections.read`). Vai trò `admin` của tm-websites đã được cấp các quyền này trong seed; nếu provision app mới ngoài seed, phải cấp capability thủ công, nếu không nav/khối sẽ bị ẩn hoặc 403 (đúng thiết kế gate an toàn).
16. **Endpoint public content của Hub chưa deploy**: `tm-hub/server/api/v1/content/public.get.ts` còn là WIP chưa commit, nên Hub production trả 401 cho `GET /api/v1/content/public` (rơi vào `content/[id].get.ts` yêu cầu auth). Phía Web đã sẵn sàng (BFF `server/api/public/content/[...slug].get.ts`, `[...slug].vue`, sitemap, robots) và `test:web-content` 21/21 PASS, nhưng vòng CMS → Web **chỉ chạy được sau khi commit + deploy tm-hub** (việc deploy do người dùng thực hiện).

---

## 9. Chạy lại toàn bộ gate

```bash
cd D:/Applications/tm-websites
pnpm validate:registry
pnpm verify:scaffold
pnpm test:layers
pnpm test:hub
pnpm test:web-content
pnpm hub:check
pnpm --dir tm-shared run typecheck
pnpm typecheck
pnpm lint

TM_CUSTOMER_ID=sentuan pnpm --dir tm-cms run build:vercel
TM_CUSTOMER_ID=sentuan pnpm --dir tm-web run build:vercel
TM_CUSTOMER_ID=bagpost pnpm --dir tm-cms run build:vercel
TM_CUSTOMER_ID=bagpost pnpm --dir tm-web run build:vercel
```

Provision dữ liệu Hub (tm-hub, incremental):

```bash
cd D:/Applications/tm-hub
pnpm typecheck:seed
pnpm seed:websites
```

Kiểm chứng TOTP (Phase 16) không cần Hub thật: chạy một stub HTTP trả `totpRequired` cho `POST /api/v1/auth/login` và `123456` cho `POST /api/v1/auth/totp/login`, rồi trỏ dev server vào đó:

```bash
cd D:/Applications/tm-websites/tm-cms
TM_HUB_URL=http://localhost:4599 TM_AUTH_MODE=hub pnpm dev
# rồi probe: curl -c cj.txt -X POST http://localhost:4005/api/auth/login -d '{"email":"a@b.c","password":"secret1"}'
# 409 TOTP_REQUIRED → curl -b cj.txt -X POST http://localhost:4005/api/auth/totp -d '{"code":"123456"}'
```
