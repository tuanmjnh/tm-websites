# TM Platform — Kế hoạch hoàn thiện `tm-websites` để thay thế `nuxt4-cms` và `nuxt4-website`

> **Loại tài liệu:** Master execution plan cho AI coding agent  
> **Ngày audit remote:** 2026-11-19  
> **Phạm vi:** `tm-websites`, `nuxt4-cms`, `nuxt4-website`, `tm-hub`, `tm-platform`  
> **Mục tiêu:** Hoàn thiện nền tảng CMS + Website + ERP theo hướng mới, có thể chạy local ổn định, migrate dữ liệu có kiểm soát và từng bước thay thế hai ứng dụng cũ.  
> **Nguyên tắc:** Audit → reconcile source → implement theo vertical slice → test → browser verify → migration rehearsal → owner-approved cutover. Không rewrite đồng loạt và không đưa dữ liệu production vào thử nghiệm.

---

## 0. Chỉ thị bắt buộc cho AI Agent

Đây là tài liệu thực thi, không phải đề xuất để dừng ở mức lập kế hoạch. Agent cần tự đọc repository, hoàn thành những phần có thể làm an toàn, chạy test và cập nhật bằng chứng. Chỉ dừng khi gặp một trong các trường hợp: cần quyết định mới của owner; thiếu credential/dữ liệu thật; cần ghi dữ liệu production; cần deploy/publish; hoặc có rủi ro phá hủy dữ liệu chưa được owner cho phép.

### 0.1 Các quyết định đã chốt, không được tự ý đảo ngược

1. **`tm-websites` là codebase đích** cho CMS SPA, Website SSR, business APIs và các domain nghiệp vụ.
2. **`tm-hub` là Control Plane/IAM**: identity, authentication, authorization, app registry, app membership, roles/permissions và session/token lifecycle theo contract thực tế. Không tiếp tục xây CMS/ERP business domain trên Hub.
3. **`tm-platform` là shared-library monorepo**. Chỉ dùng package có consumer và contract ổn định; không chuyển business domain vào `tm-platform` chỉ để giảm dòng code.
4. **MongoDB của `tm-websites` sở hữu business data**: content, catalog, customers, orders, inventory, finance, HR, site settings, media metadata, audit nghiệp vụ và migration state.
5. Không sao chép local `User`, `Role`, password hash, JWT authority, session store hay quyền kiểu legacy từ `nuxt4-cms` sang code mới. Các phần này do Hub quản lý.
6. Các quyết định trong ADR của `tm-websites` vẫn có hiệu lực. Muốn đổi phải có owner decision/ADR mới; không suy diễn từ yêu cầu “thay thế bộ cũ” để lén bật tính năng đã được hoãn.
7. **A1 đã CLOSED theo owner ngày 2026-11-19**: không chạy lại migration revoke anon, không thay đổi Supabase permissions, không kiểm tra bằng thao tác ghi khác.
8. **A2 đã được owner xác nhận đã kiểm thử thành công trên Supabase chính bằng tenant thử nghiệm độc lập**. Không chạy lại `--apply`, không tạo thêm tenant drill, không xóa dữ liệu nào ngoài dữ liệu test được owner chỉ định.
9. **A3, A5 hoãn đến khi local ổn định**. A3 vẫn OPEN; test cũ ngày 2026-11-18 không đủ để đóng. A5 vẫn DEFERRED; giữ nguyên inventory và các quyết định J1/J2.
10. **A6 BLOCKED / NOT AUTHORIZED**: không migrate production, không deploy, không cutover, không ghi production khi chưa có production Mongo URI, snapshot thật, quyền truy cập deploy và chấp thuận rõ ràng.
11. J1: giữ `legacy.format` và HTML body gốc; không bắt buộc renderer riêng cho `gallery/video/audio/quote/link` trong V2 hiện tại. Bản ghi thiếu body hoặc media bị bỏ qua phải có trạng thái `legacy.incomplete`/báo cáo thiếu dữ liệu, không giả định đã migrate hoàn chỉnh.
12. J2: không tạo redirect tự động cho category legacy có URL một segment `/<slug>` vì root path có thể là content URL. Tiếp tục skip; chỉ xử lý mapping riêng sau khi xác minh từng URL không xung đột.
13. J3: local rehearsal đã được thực hiện và ghi nhận. Không tuyên bố production cutover đã chạy.
14. J4: đã phát hiện 18 key credential plaintext trong legacy `system_configs` ở local copies. Phải xử lý rotation trước launch: inventory tên key/consumer → tạo secret mới → cập nhật secret store/env → verify consumer → revoke secret cũ. Tuyệt đối không in giá trị, copy sang tài liệu, log hoặc commit.

### 0.2 Local commits mới hơn remote

Owner đã báo các commit local chưa push:

- `tm-hub`: `ef54968` — A2 drill script và package command.
- `tm-websites`: `d5503a7` — cập nhật TODO/audit theo quyết định A1/A2/A3/A5/A6.

Tại thời điểm audit, các commit này **chưa có trên remote `main`**. Agent phải kiểm tra working tree và branch local trước khi làm, giữ nguyên các commit đó, không reset/rebase phá hủy hoặc `git push --force`. Tài liệu hiện tại trên remote vẫn có thể ghi trạng thái A1/A2 cũ; trạng thái owner mới ở trên có độ ưu tiên cao hơn.

---

## 1. Kết quả audit 5 repositories

### 1.1 Revisions đã kiểm tra

| Repository | Branch | Commit remote đã kiểm tra | Vai trò đích |
|---|---|---:|---|
| [tm-websites](https://github.com/tuanmjnh/tm-websites) | `main` | `7109a43784483a4c50bac93889f947fe7897b369` (`7109a43`) | Codebase thay thế; CMS + Website + business domains |
| [nuxt4-cms](https://github.com/tuanmjnh/nuxt4-cms) | `main` | `a73c61761b0eb7874617dbd8eff9b54b4a1e3dc6` (`a73c617`) | Legacy reference; CMS/ERP source of truth để audit behavior |
| [nuxt4-website](https://github.com/tuanmjnh/nuxt4-website) | `main` | `3b608894c5f2bf721f539f00aaf72317a148e4f6` (`3b60889`) | Legacy website reference; UX, SEO, public API flows |
| [tm-hub](https://github.com/tuanmjnh/tm-hub) | `main` | `a7c569cc8c997bee98d2cc46b8c641df886bd896` (`a7c569c`) | Control Plane / IAM / app registry / integration control |
| [tm-platform](https://github.com/tuanmjnh/tm-platform) | `main` | `5d18a04405325c8ff73e82b236563960e5b4a1fc` (`5d18a04`) | Shared packages and release lifecycle |

Audit chỉ đọc remote default branch, README, manifests, file tree và các tài liệu/implementation trọng yếu. Audit **không** có quyền xem local working tree của máy owner, không thay đổi source và không xác minh production runtime.

### 1.2 Tình trạng CI remote tại thời điểm kiểm tra

| Repository | Workflow gần nhất | Trạng thái | Ý nghĩa |
|---|---|---|---|
| `tm-websites` | [Quality Gates #44448243864](https://github.com/tuanmjnh/tm-websites/actions/runs/44448243864) | **38/39 pass, 1 fail** | `test:migrate-apply` đang có assertion phụ thuộc thứ tự JSON; phải sửa gate, không sửa dữ liệu output chỉ để khớp regex |
| `tm-platform` | [CI #44245218328](https://github.com/tuanmjnh/tm-platform/actions/runs/44245218328) | Pass | Shared packages build/typecheck/test đang có baseline CI tốt |
| `tm-hub` | [CI #44424115578](https://github.com/tuanmjnh/tm-hub/actions/runs/44424115578) | Pass | Hub CI đã hoạt động; commit mới nhất là UI modal fix |
| `nuxt4-cms` | Không có workflow Actions | Chưa có bằng chứng CI | Không dùng repo cũ làm deployment target; chỉ tham chiếu behavior và dữ liệu |
| `nuxt4-website` | Không có workflow Actions | Chưa có bằng chứng CI | Không dùng repo cũ làm deployment target; chỉ tham chiếu behavior và dữ liệu |

`tm-websites` hiện có một lỗi gate đã xác định: test đọc log JSON và kỳ vọng key `"(none)"` xuất hiện trước `"other-tenant"`, trong khi output thực tế có thể theo thứ tự ngược. Sửa test bằng cách parse JSON và so sánh key/value/map không phụ thuộc thứ tự. Không sort hay sửa kết quả migration nếu logic không yêu cầu.

### 1.3 Quy mô source và mức độ bao phủ

Số lượng dưới đây là thống kê từ Git tree remote, chỉ để hình dung độ rộng; không phải điểm số parity.

| Repository | Files | Pages / APIs / Models đáng chú ý |
|---|---:|---|
| `nuxt4-cms` | 1,062 | 94 pages; 345 API files dưới `server/api/v1`; 45 models; 29 services |
| `nuxt4-website` | 265 | 6 page routes; 21 API routes; 60 Vue components; 5 service files; 39 model files trong tree |
| `tm-websites` | 536 | 23 CMS base pages; 14 Web base pages; 58 CMS API files; 12 Web API files |
| `tm-platform` | 363 | 9 packages và 7 examples |
| `tm-hub` | 760 | 239 API files trong `/api/v1`, tập trung vào apps/auth và Control Plane |

Không được cố đạt “345 legacy API routes = 345 target API routes”. Cần map từng use case, domain, state transition, permission và data invariant. Nhiều legacy routes là duplicate, read-only scaffold hoặc chứa bug; chỉ port behavior đã xác minh và cần thiết.

---

## 2. Kiến trúc mục tiêu

### 2.1 Sơ đồ ownership

```text
                  ┌──────────────────────────────────────┐
                  │               TM Hub                 │
                  │ Identity · IAM · Apps · Tenants      │
                  │ Roles/Permissions · Session/Token    │
                  │ Approved integration/control APIs   │
                  └───────────────────┬──────────────────┘
                                      │ tm-hub-client
                       ┌──────────────┴──────────────┐
                       │                             │
             ┌─────────▼─────────┐        ┌──────────▼──────────┐
             │     tm-cms        │        │      tm-web         │
             │ Nuxt 4 SPA        │        │ Nuxt 4 SSR           │
             │ Nitro BFF         │        │ Public Nitro API     │
             │ Admin/ERP UI      │        │ Storefront/Portal     │
             └─────────┬─────────┘        └──────────┬──────────┘
                       │                             │
                       └──────────────┬──────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │ MongoDB per customer   │
                         │ site-scoped business   │
                         │ content/catalog/ERP    │
                         └─────────────────────────┘

              tm-platform: shared, versioned libraries
              tm-websites: domain implementation + Nuxt layers
```

Ownership cụ thể:

| Thành phần | Được sở hữu | Không được sở hữu |
|---|---|---|
| `tm-hub` | Account/subject, password/MFA/passkey, app, membership, role/grants, IAM, session/token, app configuration và các integration API đã được duyệt | Content, catalog, order, inventory, finance, HR hoặc các business record của customer |
| `tm-hub-client` | Typed SDK cho các Hub contracts thực sự tồn tại | Session authority, browser cookie/session store, business domain logic |
| `tm-websites/tm-cms` | Admin/ERP UI, BFF, protected mutations, business command APIs, Mongo write services | Local credentials, local role authority hoặc một bản sao IAM của Hub |
| `tm-websites/tm-web` | Public SSR pages, public read APIs, PWA, public projections, portal khi có BFF/authorization contract | Query trực tiếp secret/private fields, quyền sở hữu record suy ra từ URL hoặc tenantId do client gửi |
| MongoDB | Customer/site business records, schema versions, audit nghiệp vụ, idempotency, migration reports | Hub credentials, JWT signing keys, bí mật provider dạng plaintext |
| `tm-platform` | Pure TS contracts/utilities, shared UI/SDK packages, package release lifecycle | CMS/ERP domain riêng của `tm-websites` hoặc business database của customer |

**Chú ý ranh giới Hub:** tài liệu V2 của `tm-websites` chọn Hub làm IAM owner và Mongo làm business data owner. `tm-hub`/`tm-platform` có thêm capability về AI relay, connection vault, notification, Cloudinary media và Storage Gateway. Chỉ dùng các capability này qua contract được kiểm tra và quyết định rõ; không lấy việc Hub có endpoint làm lý do để đưa business records trở lại Hub. Storage Gateway và Cloudinary Media Gateway là hai loại capability khác nhau, không trộn quyền và credential.

### 2.2 Layout đã có trong `tm-websites`

| Path | Ý nghĩa |
|---|---|
| `tm-cms/` | App Nuxt 4 SPA riêng, dev port 4005, Nitro BFF và admin APIs |
| `tm-web/` | App Nuxt 4 SSR riêng, dev port 4006, public APIs và storefront |
| `tm-shared/nuxt-layers/core-base/` | Foundation |
| `tm-shared/nuxt-layers/config-base/` | Build/customer config và validation |
| `tm-shared/nuxt-layers/api-base/` | Shared API mechanics/contracts phía app |
| `tm-shared/nuxt-layers/cms-base/` | CMS shell, common admin pages/components |
| `tm-shared/nuxt-layers/web-base/` | Storefront shell và public pages/components |
| `tm-shared/customer-layers/registry/` | Registry duy nhất cho customer/app/domain/build identity |
| `tm-shared/customer-layers/cms/*` | Branding, assets, theme và CMS composition theo customer |
| `tm-shared/customer-layers/web/*` | Branding, assets, theme và Web composition theo customer |
| `tm-shared/packages/flow-contracts/` | Zod contracts, DTOs giữa CMS/Web |
| `tm-shared/packages/flow-config/` | Pure config types/validation |
| `tm-shared/packages/flow-utils/` | Pure utilities dùng chung |
| `tm-shared/packages/design-system/` | Tokens và design-system foundation |
| `scripts/ops/` | Import/export/backup/restore/migration operations |
| `scripts/build/` | Domain gates, regression tests, build matrix |
| `docs/v2/` | Canonical current architecture, parity, roadmap và AI execution |

Không tạo thêm repository cho CMS và Website. Hai app cần deployment lifecycle riêng, không nhất thiết cần source repositories riêng.

### 2.3 Quyết định kiến trúc đang mâu thuẫn cần xử lý trước Web private mutations

`docs/v2/02-architecture.md` có hướng đề xuất tương lai tạo server-only domain package dùng chung giữa CMS và Web. Tuy nhiên `tasks/questions.md` Q11/ADR owner decision đã chốt **không tạo `@tm/flow-server`**, giữ models/invariants/commands trong `tm-cms/server/`. Web auth BFF cũng chưa tồn tại.

Agent không được tự giải quyết mâu thuẫn bằng cách:

- Copy service/model từ `tm-cms/server` sang `tm-web/server`;
- Import trực tiếp file server của CMS từ Web host;
- Để browser gọi thẳng admin CMS endpoints;
- Cho public API sửa business data không có policy/command boundary;
- Bật checkout/portal chỉ vì legacy có route.

Trước khi triển khai Web-side customer/supplier portal hoặc public business writes, hãy chuẩn bị ADR decision note cho owner so sánh:

- **Option A:** owner cập nhật Q11/ADR và cho phép một private workspace package chứa server-only model factories, invariants và command services, có export map bảo đảm không bundle vào browser.
- **Option B:** duy trì một business API owner duy nhất trong CMS/Nitro hoặc service backend riêng; Web gọi server-to-server qua app identity/service authorization được duyệt, có site/customer scope và DTO public/private rõ ràng.

Không implement option nào trước khi owner xác nhận. Nếu không có owner decision thì chỉ tiếp tục public read-only work và giữ portal/write scope ở trạng thái BLOCKED.

---

## 3. Khác biệt giữa bộ cũ và bộ mới

### 3.1 `nuxt4-cms` — Legacy CMS/ERP

Repo cũ là một Nuxt 4 SPA + Nitro với Mongo/Mongoose, local JWT/bcrypt, Pinia persisted state, i18n en/vi, Nuxt UI, Cloudinary, Web Push/FCM, Google OAuth/Gmail. README ghi nhiều module CMS/ERP/Portal. Package hiện là 1.3.2, trong khi README còn ghi 1.2.10 và `docs/ARCHITECTURE.md` ghi 1.3.0/last verified 2026-10-19; cần ưu tiên source code và lockfile, không dùng con số docs làm bằng chứng implementation.

Domain hiện diện trong legacy:

- Content: posts/pages/categories/attributes/keywords, localized fields, editorial formats, SEO, publish/schedule/archive, redirect.
- Products/catalog: simple/variable, categories, variants, attributes/options, SKU/barcode/QR, base/sale price, supplier prices, stock, reserved, minStock, manageStock, hasImei, serial/IMEI.
- Commerce: orders, POS, quotations, cart, checkout, payments, status transitions, returns/refunds, shipping.
- CRM: customers, addresses, segments, loyalty/metrics.
- Inventory: warehouses, stock balances, transactions, reservations, transfer, adjustment, serials.
- Purchasing: suppliers, purchase orders, partial receiving/reconciliation, supplier price history.
- Finance: ledger, payment transactions, payment attempts/gateways, debts, reports.
- HR: staff, attendance, salary, payroll.
- Portals: customer portal and supplier portal.
- System/settings: company profile, dynamic config, system data, route/menu, import, root seed/recalc.
- Communications/integrations: media, mail, Google connections, notifications, Web Push/FCM, shipping providers.

Legacy code không phải behavior spec hoàn hảo. Audit source đã phát hiện nhiều vấn đề không được port:

1. Local user/password/JWT/refresh session và `Role.allowedRoutes` là legacy identity implementation; thay bằng Hub.
2. Development root bypass và demo account fallback phải bị loại hoàn toàn khỏi target; không copy tài khoản/mật khẩu demo.
3. Một số legacy API authorization không đồng nhất; có endpoint được đánh dấu TODO và thiếu warehouse scoping. Target phải enforce permission và record ownership tại server.
4. Catalog/order values do browser gửi lên không được tin cậy. Server phải load giá/variant/stock từ DB và tính lại.
5. `returnedQuantity` ở legacy Order không được schema khai báo nên strict mode có thể làm mất counter; repeated returns có nguy cơ vượt sold quantity.
6. POS flow có thể bỏ qua reservation; stock reservation không check available quantity trong một path.
7. Inventory transfer sử dụng reference IDs không có model phù hợp; không port transfer history thiếu aggregate.
8. `ItemSerial` có model nhưng legacy write path không hoàn chỉnh; một số trường IMEI ghi vào schema field không tồn tại.
9. HR chủ yếu read-only: thiếu write endpoint cho attendance/payroll, không có shift model và salary-to-payroll calculation.
10. Quotation expiry/discount segment và một số finance reversal/payment rules không được thực thi đầy đủ.
11. `Connect.credentials` có thể được lưu như object trong business collection. Target không lưu provider secrets plaintext trong `settings`/Mongo.
12. Legacy default config có các secret/credential fallback được đặt trực tiếp trong source. Coi tất cả committed credentials là compromised và rotation trước khi launch; không sao chép sang V2.

Nguồn tham chiếu: [nuxt4-cms README](https://github.com/tuanmjnh/nuxt4-cms/blob/main/README.md), [legacy architecture](https://github.com/tuanmjnh/nuxt4-cms/blob/main/docs/ARCHITECTURE.md), và [tm-websites legacy domain specs](https://github.com/tuanmjnh/tm-websites/blob/main/docs/v2/12-legacy-domain-specs.md).

### 3.2 `nuxt4-website` — Legacy Website

Repo này không còn là một kiến trúc website được mô tả đầy đủ trong README: README vẫn gần như Nuxt UI starter template. Package 1.2.0 dùng Nuxt 4.4.x, Nuxt UI 4.5.x, Mongoose, Nuxt Content, SQLite, Pinia, i18n, PWA, Turnstile và các SEO modules.

Các public pages chính:

- `/` — home, hero/slogan, trending/latest/sale products, featured/latest news, newsletter.
- Catch-all `/<slug>` — resolver kết hợp content, page, product, category, keyword, redirect.
- `/cart` — cart local state, quantity controls và subtotal.
- `/checkout` — thu thông tin người mua/địa chỉ, phương thức COD/bank/card, CAPTCHA; gọi API checkout.
- `/search` — search theo products/categories/posts/pages.
- `/tag/<slug>` — tag landing.

Public API có 21 endpoints bao gồm bootstrap/layout, home, posts, products, category items, discovery search/popular tags, resolver, public checkout, contact/newsletter form và internal cache purge.

Điểm phải mang sang target:

- Home composition theo cấu hình site và content/catalog.
- Catch-all resolution, category/tag/list/search, pagination, SEO, localized content.
- Product details/related products, variant-aware cart, quantity restrictions.
- Contact/newsletter nếu owner xác nhận destination, consent và spam handling.
- Checkout chỉ khi order/payment ownership và security contract được mở lại.
- SSR + sitemap + robots + canonical/OG + redirects; không làm mất URL SEO đang index.
- Customer branding, image origin và cache separation.

Không port nguyên trạng:

- Legacy Website dùng fallback database config và secrets trong Nuxt runtime config/config service. Không copy config defaults hoặc secret fallbacks.
- Checkout gửi `price`, product name, thumbnail và cart rows từ browser; target phải tự load sản phẩm/variant/price/stock và recompute total, browser price chỉ là display hint.
- Legacy checkout proxy gọi CMS public checkout endpoint qua `cms_url`; target không nên duy trì hard-coded CMS host dependency hoặc bypass central business service ownership.
- Contact email HTML interpolation nhận user input vào nội dung email; target cần escape/sanitize text và kiểm soát abuse/rate limit.
- Newsletter handler gửi mail trực tiếp nhưng không thể hiện durable subscription lifecycle/consent management trong route này; không coi là subscription management hoàn chỉnh.
- PWA cũ dùng `navigateFallback: '/'`; không bê nguyên chiến lược này sang SSR website vì có nguy cơ trả cùng một cached document cho nhiều URL. `tm-websites` đã có worker custom để không cache SSR documents; giữ và mở rộng test đó.

Nguồn: [nuxt4-website README](https://github.com/tuanmjnh/nuxt4-website/blob/main/README.md), [nuxt.config.ts](https://github.com/tuanmjnh/nuxt4-website/blob/main/nuxt.config.ts), [catch-all resolver page](https://github.com/tuanmjnh/nuxt4-website/blob/main/app/pages/%5B...slug%5D.vue), [checkout page](https://github.com/tuanmjnh/nuxt4-website/blob/main/app/pages/checkout.vue), [public APIs](https://github.com/tuanmjnh/nuxt4-website/tree/main/server/api/v1/public).

### 3.3 `tm-websites` — Target mới

Những phần nền tảng đã có remote evidence:

- 2 deployable apps: CMS SPA + Website SSR; customer-first Nuxt layer composition.
- Customer registry và build selection; `sentuan` dùng DB `sen-tuan`, `bagpost` dùng `bag-post`. `default`, `thanhtung`, `hoangvi` chưa có business Mongo DB binding được xác nhận.
- Hub-backed authentication/BFF trong CMS với `@tuanmjnh/tm-hub-client` 1.2.0, HttpOnly cookie và auth proxy path denial.
- Business DB binding, content/category/media/settings/menu models/services, migrations v1–v7, audit/idempotency, revisions, public projections.
- CMS content CRUD/editor, category tree/order, tag management, media library, menus/settings, catalog CRUD/variant editor/bulk stock-price/barcode.
- Storefront public content/catalog/search/category/tag/cart, redirects, sitemap/robots/SEO và PWA.
- Backup/restore DB + media, combined `backup:all`/`restore:all`, migration dry-run/apply scripts, parity checker và customer build matrix.
- Build and source gates rộng, nhưng không thay thế domain parity, authenticated Hub behavior hay provider test.

Phần chưa hoàn chỉnh quan trọng:

- P5–P8 business ERP domains hầu hết chưa được implement: CRM, Orders/POS, Quotations, Inventory, Purchasing, Finance, HR, supplier/customer portals, full communications.
- P1 vẫn chưa hoàn tất Web auth BFF, authoritative tenant/site membership contract và refresh cross-instance robustness. Hub introspection hiện không đọc refresh-session revocation; access JWT có thể còn hiệu lực đến hết TTL sau logout/revoke. Không được mô tả là immediate revocation.
- Hub-backed business screens vẫn tồn tại theo cơ chế proxy chuyển tiếp. Phải migrate domain từng phần sang Mongo, không để business ownership ở Hub vĩnh viễn.
- CMS local media storage chưa có shared public origin giữa hai deployment; public media projection/provider adapter chưa hoàn chỉnh.
- Migration content/catalog mapping còn field loss/legacy incomplete và cần kiểm tra parity. J1/J2 đã chốt cách xử lý; A5 tổng thể vẫn hoãn.
- Web checkout/forms đã được hoãn theo quyết định Q17/Q18; full replacement phải làm rõ đây là intentional scope exclusion hoặc owner mở lại quyết định.
- CDN/provider invalidation, scheduled jobs/cron/queue và provider integration thực tế chưa đầy đủ theo ADR hiện tại.
- `tm-websites` CI còn 1 failure trong run mới nhất; chưa được coi là green.

Nguồn: [tm-websites README](https://github.com/tuanmjnh/tm-websites/blob/main/README.md), [V2 index](https://github.com/tuanmjnh/tm-websites/blob/main/docs/v2/README.md), [feature parity matrix](https://github.com/tuanmjnh/tm-websites/blob/main/docs/v2/05-feature-parity.md), [roadmap](https://github.com/tuanmjnh/tm-websites/blob/main/docs/v2/07-delivery-roadmap.md), [current TODO](https://github.com/tuanmjnh/tm-websites/blob/main/tasks/todo.md).

---

## 4. Tích hợp `tm-hub` và `tm-platform`

### 4.1 TM Hub — phần cần dùng

`tm-websites` phải thống nhất các app identity theo registry:

- `tenantId`, `customerId`, `appId`, `siteId` là các định danh khác nhau, không thay thế qua lại.
- CMS app và Web app là hai app identity khác nhau trong một tenant/customer khi registry cấu hình như vậy.
- Hub subject/user ID là khóa liên kết từ business profiles `Customer`, `Supplier`, `Staff`; email không phải stable join key.
- Hub cung cấp login/TOTP/refresh/logout/session và permission information theo contract thật.
- Mỗi private operation kiểm tra capability + tenant/site/resource ownership. UI menu/route visibility không phải security boundary.
- Web portal auth cần BFF riêng. Không lưu token trong localStorage, Pinia persisted state, SSR payload hoặc JavaScript-readable cookie.
- SDK client nên được tạo per request hoặc theo mô hình an toàn đã test; không dùng mutable singleton mang token của nhiều user.
- Không tự chế `/verify`, JWKS validation, service introspection hay permission endpoint không có trong source contract.

**Hub limitation cần được thể hiện trong target:** hiện `introspect` verify token signature/expiry nhưng không tự chứng minh current session revoke, active membership hoặc tenant/site entitlement. Logout/revoke refresh token không lập tức revoke access JWT đã phát hành. Session DTO và token hiện không cung cấp đủ formal session/site claim theo target spec. Production private business routes cần policy được owner phê duyệt về stale authorization window và entitlement; không được dùng `tenantId` lấy từ browser làm bằng chứng.

**Hub proxy:** ADR 0002 D1 cho phép các business path `/api/v1/**` còn lại tiếp tục qua proxy trong giai đoạn chuyển tiếp cho đến khi từng domain migrate. Không thay generic proxy thành deny-by-default allowlist nếu chưa có ADR mới. Tuy nhiên, khi một domain đã chuyển hẳn, BFF cần bỏ dần consumer Hub tương ứng, không proxy business data vô thời hạn.

### 4.2 TM Platform — packages và chính sách sử dụng

| Package | Trạng thái / vai trò | Quyết định cho `tm-websites` |
|---|---|---|
| `@tuanmjnh/tm-hub-client` 1.2.0 | Typed Hub SDK; ESM/CJS/types exports | Đã là dependency của CMS. Kiểm tra contract/version thực tế và tiếp tục dùng ở server-side adapter |
| `@tuanmjnh/tm-ui` 0.2.0 | Shared Vue/Nuxt UI primitives | Đã tích hợp vào CMS layer qua registry dependency. Chỉ CMS SPA cho đến khi Web SSR/hydration được kiểm chứng riêng |
| `@tuanmjnh/tm-core` 0.1.2 | Framework-free runtime helpers | Chỉ dùng khi có function cụ thể cần dùng chung; không thay local flow utils một cách máy móc |
| `@tuanmjnh/tm-types` 0.1.0 | Generic TS contracts | Không ép dùng cho business DTO. Probe trước đã bị revert vì ApiResponse shape không phù hợp use case |
| `@tuanmjnh/tm-validators` 0.2.0 | Zod validators | Có thể tái sử dụng primitive/schema generic nếu thực sự có ≥2 consumers; `flow-contracts` vẫn là owner của CMS/Web business contracts |
| `@tuanmjnh/tm-utils` | Pure helpers | Chọn lọc, không duplicate `flow-utils` |
| `@tuanmjnh/tm-mongo` 0.1.0 | Mongo helper package | Audit export/topology/tenant binding trước. Không thay `tm-websites` DB binding đang có nếu chưa chứng minh compatibility |
| `@tuanmjnh/tm-ai-client` 0.4.1 | Provider-agnostic AI client | Optional; AI Workspace hiện out-of-scope theo owner decision, không thêm vào critical path |
| `@tuanmjnh/tm-cut-core` | TMCut engine | Không liên quan website/CMS migration |

Rule đưa package vào shared: có ít nhất hai consumer thật, contract ổn định, tests độc lập, version/release owner, không phụ thuộc hidden runtime. Không move domain model sang `tm-platform` chỉ để gom code.

Nguồn: [tm-platform README](https://github.com/tuanmjnh/tm-platform/blob/main/README.md), [package workspace](https://github.com/tuanmjnh/tm-platform/blob/main/pnpm-workspace.yaml), [tm-ui package](https://github.com/tuanmjnh/tm-platform/blob/main/packages/tm-ui/package.json), [tm-hub-client package](https://github.com/tuanmjnh/tm-platform/blob/main/packages/tm-hub-client/package.json), [security review](https://github.com/tuanmjnh/tm-platform/blob/main/docs/security-review.md).

### 4.3 Dependency/version policy

- Giữ Node 24 + pnpm 12 trong `tm-websites` theo root `package.json`/CI.
- Commit lockfile thay đổi đi kèm package changes.
- Dùng registry version đã publish khi cần dùng package ngoài `tm-websites`; tránh `link:../../tm-platform` ở clean CI và tránh hai bản Vue.
- Không upgrade Nuxt/Vue/Nuxt UI chỉ vì repo cũ đang có version khác. Upgrade phải có matrix build/test và browser check.
- Không dùng `npm install` trộn vào pnpm workspace.
- Với package UI precompiled, test `resolveComponent` registrations, `#components`, CSS/Tailwind scanning và SSR/hydration; một typecheck xanh không chứng minh component render đúng.

---

## 5. Gap analysis theo domain và điều kiện thay thế

Bảng này là acceptance scope của việc thay thế. `Target status` phải được cập nhật theo source/test mới, không dựa trên số route/page.

| Domain | Legacy capability | Target hiện tại | Việc còn thiếu để thay thế |
|---|---|---|---|
| Identity/IAM | local users, roles, sessions, permissions | Chuyển về Hub; CMS BFF partial | Web BFF; session freshness/revocation policy; tenant/site entitlement; negative tests trên real Hub test account |
| Dashboard/navigation | Dashboard, dynamic routes/menu | Shell/menu có sẵn, nhiều module placeholder | Dashboard aggregate thật lấy từ Mongo business services; module permission và loading/empty/error states |
| Site settings | Company/config/locales/theme/menu/SEO | Settings/menu/site projection đã có | Full legacy config mapping; public projection audit; cache/provider invalidation; per-site asset/domain/locale checks |
| Content | Pages/posts/categories/attributes/tags/7 formats/schedule/revisions | Content CRUD, revisions, categories, tags, redirect, basic formats | Full field mapping; `legacy.incomplete`; J1/J2 adherence; rich format rendering deferred/owner-approved; media public URL; full migration reconciliation |
| Media | Cloudinary library, folder, editor uploads | CMS library + local disk storage | External object storage/public origin, provider adapter, transforms, file lifecycle, signed upload, public projection và cross-host availability |
| Catalog | Items, variants, options, categories, supplier price, stock, serial/IMEI | Catalog CRUD, variants/attributes editor, bulk price/stock, barcode | Serial/IMEI, supplier prices, import/export, all legacy fields mapping, private cost projection, inventory integration |
| Search/discovery | Product/content/tag/category search | Public search and category/tag listing exists | Reconcile filters/sort/facets, performance and index, exact URL/query parity, all locale behavior |
| CRM | Customers, addresses, segments, loyalty | Planned | Customer profile linked by Hub subject; address management, segments and metrics; privacy and portal ownership |
| Commerce | Orders, POS, quotations, cart/checkout, payments | Cart quote exists; order workflows planned/out-of-scope | Order model/state machine, server repricing, idempotency, reservations, POS, quote lifecycle, return/refund, payment boundaries |
| Customer portal | Cart, checkout, orders, tracking, quotations | Web auth/BFF absent; legacy portal not parity-complete | Web auth BFF + verified owner context, customer profile, order list/detail/cancel/tracking, quotation; explicit owner scope/decision |
| Inventory | Warehouses, stock, reservations, transactions, transfer, serials | Planned | Stock ledger, availability, concurrency-safe reserve/release, atomic transfers, adjustment, stocktake, serial movement |
| Purchasing | Suppliers, POs, partial receive/reconcile | Planned | Supplier CRUD/portal, PO lifecycle, delta/idempotent receive, rejected/accepted quantities, supplier cost access |
| Finance | Payments, transaction ledger, debts, P&L/reports | Planned | Immutable postings, payment allocation, reversals, reconciliation, currency/timezone tests, gateway adapters only when chosen |
| HR | Staff, attendance, salary, payroll | Planned; legacy mostly read-only | Staff business profile linked Hub subject; shifts, attendance writes, payroll formula, approvals, audit, compensation permissions |
| Mail/notifications | Gmail, mail queue, in-app, Web Push, FCM | Some Hub-backed transitional UI | Decide owner for connection/secret vault; local business templates/outbox/delivery state; retry, unsubscribe/consent, provider test |
| Shipping/integrations | Carrier adapters, Google, Cloudinary, webhook | Partial/transitional | Adapter contracts, secret handling, webhook signature/idempotency, provider failure handling, sandbox/live separation |
| Import/export | XLSX/import templates, bulk jobs, seed/recalc | Migration scripts cover content/catalog/settings partly | CSV/XLSX per domain, preview/error rows, job state, retry/idempotency, audit and permission scope |
| Reports | Sales, stock, debts, finance, HR | Placeholders/planned | Aggregate from domain ledgers, reconcile with source facts, range/timezone, role-scoped data and export |
| PWA/SEO | PWA, sitemap, robots, OG, localized URLs | Good foundation, PWA/SEO checks | CDN media, customer-asset isolation, no SSR document caching, redirects/revalidation, URL parity and production smoke |
| Operations | backups, audit, retention, monitoring | DB/media backup restore and audit gates exist | off-site backup, schedule, alerting, restore drill per tenant, retention operations and runbook |

### 5.1 Specific legacy domain invariants cần bảo toàn

**Content**

- Locale maps for title, slug, fullPath, body, excerpt, SEO.
- Formats `standard`, `gallery`, `video`, `audio`, `quote`, `link`, `dynamic` and types `post`, `page`, `item`, `project`, `service` are present in legacy. New model currently narrower. J1 has decided preserve source format and HTML rather than build all renderers immediately.
- Legacy source has some empty body rows and media fields that importer cannot fully transform. Mark as incomplete and report; don't claim content fidelity.
- Preserve scheduled/publish windows, archive/soft-delete, revisions and slug redirect behavior. Legacy `scheduled`/`expiredAt` did not always have worker enforcement; do not port an unenforced field without a target scheduler decision.

**Catalog**

- Keep localized title/slug/fullPath, `simple|variable`, category, SKU, barcode, base/sale price, variants, attributes/options, stock availability, display/SEO, media references.
- Supplier price, minimum stock, reserved, hasImei, shipping info, serials and historical fields need an explicit mapping/deferral report.
- Never expose supplier price/cost/internal attributes in public Web DTOs.
- SKU/barcode uniqueness must be enforced at DB index level or by transactional/atomic logic, not only in pre-save validation.

**Commerce / Inventory**

- Order line/address/customer/product snapshots must be immutable after purchase (except audited correction flows).
- Server recalculates current prices, discounts, shipping and totals. Use idempotency key on create/checkout.
- State changes must be constrained; cancellation/return/refund/ship require explicit state transitions and actor audit.
- Reserve stock atomically only if available; reserve/release exactly once; never allow negative stock unintentionally.
- Inventory ledger must reconcile to balances. Transfers should have one real transfer aggregate and paired movement references; do not write dangling random IDs.
- Partial PO receive must apply only the unprocessed delta so retry doesn't double-add stock. Require replica set/transaction where atomic multi-document write is essential; otherwise fail closed or use an explicit tested compensation design.

**Finance**

- Store decimal/currency consistently; define rounding for VND and other currencies.
- Completed transaction ledger is source for paidAmount/paymentStatus; never trust browser totals.
- Corrections use reversal/adjustment entries, not silently editing a posted financial transaction.
- Reports must reconcile to known fixtures and transaction ledger, including date boundaries/timezone.

**HR / CRM**

- Hub subject links person identity; Mongo business profiles own address, supplier/customer/staff fields.
- Portal APIs must verify owner ID from trusted session; never accept arbitrary `customerId` in request as authorization.
- Compensation/payroll fields need dedicated permissions, audit and export restrictions.
- HR payroll calculations must be deterministic, repeatable and approved; don't infer from legacy read-only UI.

---

## 6. Ưu tiên triển khai theo phases

### Phase 0 — Repository reconciliation and execution safety (P0)

**Mục tiêu:** AI làm trên đúng source, không phá local commits, và có CI xanh trước khi mở rộng.

Tasks:

1. Read `AGENTS.md`, `README.md`, `docs/v2/README.md`, `docs/v2/01`–`09`, `docs/v2/12`, `tasks/todo.md`, `tasks/questions.md`, ADR 0001/0002. Không coi V1 archive là chỉ thị hiện hành.
2. In từng repo chạy kiểm tra read-only:
   ```bash
   git status --short --branch
   git remote -v
   git rev-parse HEAD
   git ls-remote origin refs/heads/main
   git fetch origin main
   git log --oneline --graph --left-right HEAD...FETCH_HEAD
   git rev-list --left-right --count HEAD...FETCH_HEAD
   ```
3. Xác nhận local `tm-hub` có `ef54968`, `tm-websites` có `d5503a7` hay commit descendants; tìm working tree modifications chưa commit; giữ nguyên.
4. Reconcile commit ancestry an toàn. Nếu local main có divergent remote, tạo backup branch trước, tạo feature branch và xử lý merge; không reset hard, force push hoặc cherry-pick mù.
5. Sửa `test:migrate-apply`: parse JSON output and compare semantic values independent of object key order. Giữ output logic đúng và test cả thứ tự đảo ngược.
6. Chạy riêng `pnpm test:migrate-apply`, sau đó `pnpm verify:all`, typecheck, lint và CI workflow local-equivalent. Kiểm tra CI log sau push branch (chỉ khi owner cho phép push).
7. Cập nhật TODO remote cũ về A1/A2/A3/A5/A6 theo local owner changes; không sửa A1 migration hoặc chạy lại A2.

**Acceptance:** no lost commits; local/remote divergence được giải thích bằng evidence; `test:migrate-apply` xanh; các quyết định mới ở TODO/audit không mâu thuẫn; không có deploy/production write.

### Phase 1 — IAM/BFF and trusted request context (P1)

**Mục tiêu:** mọi private business endpoint có trusted user/app/tenant/site identity và capability checks.

Tasks:

1. Audit SDK v1.2.0 exports và Hub current endpoints. Sửa docs đang ghi v1.0.9 nếu evidence current là v1.2.0; không thay contract theo suy đoán.
2. Chuẩn hóa request context server-side gồm Hub subject/user ID, `appId`, tenant/site deployment binding, capabilities/permissions và request ID. Không coi configured `tenantId` tự thân là membership proof.
3. Giữ auth cookies HttpOnly/Secure/SameSite và CSRF policy theo ADR hiện tại. Không đưa token vào browser state/SSR payload.
4. Kiểm tra every private route/command: capability + resource ownership + site scope; cross-tenant ID phải trả 404/403 theo policy, không leak record.
5. Duy trì explicit Hub BFF auth routes; auth APIs không được proxy raw về browser. D1 business proxy là transitional, migrate từng domain sau khi local API hoàn thành.
6. **A3 vẫn OPEN và DEFERRED:** khi local ổn định, test 2 CMS processes cùng dùng refresh token. Sau khi loser hoàn tất, refresh token mới của winner phải được dùng để refresh tiếp và thành công; kiểm token cũ revoked; kiểm session khác và behavior sau lỗi network/response loss. Chỉ kiểm access token không đủ vì access JWT đã phát hành có thể còn hiệu lực đến expiry. Không làm yếu Hub reuse detection.
7. Web auth BFF chỉ triển khai sau khi owner chốt portal scope và service/domain architecture. Trong lúc đó Web public read-only.
8. Hub contract limitation phải ghi trong runbook: no authoritative revoke check in introspect; no current tenant/site entitlement proof; access JWT is not immediately revoked. Đề xuất owner policy/stale window trước launch private ops.

**Tests:** wrong app, missing/mismatched tenant/site, no permission, foreign resource ID, revoked refresh, invalid/expired token, Hub outage, CSRF, proxy auth denial, refresh concurrency multi-process, token not in storage/network/SSR payload.

**Acceptance:** CMS protected business operations fail closed; app/site binding verified; no business endpoint exposes Hub secrets; Web private APIs remain disabled until BFF/entitlement and service contract are accepted.

### Phase 2 — Business foundation, Mongo, settings, audit (P2)

**Mục tiêu:** một data boundary nhất quán cho mỗi customer và site.

Tasks:

1. Xác minh registry là source of truth. Current mapping remote:
   - `sentuan` → `sen-tuan` (CMS + Web enabled)
   - `bagpost` → `bag-post` (CMS + Web enabled)
   - `default` hiện không có DB name
   - `thanhtung`, `hoangvi` currently CMS-only và không có DB name
2. Không tự tạo tên DB/tenant/app/domain cho các customer thiếu config. Chuẩn bị inventory và yêu cầu owner cung cấp DB binding trước khi bật business module.
3. Giữ DB name lấy từ registry/deployment, không nhận từ URL/header/body/query. Phân biệt `customerId`, `tenantId`, `appId`, `siteId`.
4. Connection pool keyed by trusted database binding; Mongoose models gắn vào connection cụ thể; không đổi global DB giữa requests. Thử two-customer concurrent isolation.
5. Migrations phải có stable id/version/checksum, dry-run, apply có kiểm soát, idempotent apply và không `syncIndexes()` phá dữ liệu production. Không dùng migration fixture tự tạo để đại diện snapshot production.
6. Chuẩn hóa audit fields: actor Hub ID, site/customer, requestId, action, entity, before/after fields, reason; redaction cho PII/secret.
7. Idempotency áp dụng mutation có retry; request digest mismatch phải conflict; TTL/retention bounds.
8. Settings public projection chỉ trả allowlisted keys; secrets chỉ tham chiếu secret store/env/approved Hub vault, không query cả secret values nếu chỉ cần keys metadata.
9. Rà soát `apps.site_ids` sau tenant unlink A2 bằng code search, xác định đó là live relation hay retained metadata; không re-run A2. Nếu stale link nguy hiểm, đề xuất code fix + test local, không thao tác trên Hub production tenant.
10. Backup/restore có DB + media manifest, verify trước write, checksum sau restore; bổ sung off-site backup và schedule chỉ khi owner cung cấp provider/retention target.

**Acceptance:** two customers cannot read/write across DB or site; migration repeatable; audit/idempotency tests green; no DB URI/secret in browser/log; A2 test history preserved without repeating operation.

### Phase 3 — Content, site configuration, media and public website (P3)

**Mục tiêu:** hoàn thiện vertical slice từ CMS đến SSR Web.

Tasks:

1. Complete content DTO/model parity: pages/posts, localized title/slug/body/excerpt, status, publish/unpublish windows, tags/categories/attributes, SEO fields, media references, author snapshot and redirects.
2. Enforce immutable content key, slug uniqueness `(site, locale, slug)`, optimistic revision, revision snapshot, audit, restore and deletion/reference checks.
3. J1 implementation exactly: preserve `legacy.format` and HTML; no forced renderer for gallery/video/audio/quote/link in this phase; mark `legacy.incomplete` where required body/media absent. Test public route response and admin warning/status.
4. J2 implementation exactly: skip single-segment category redirects. Keep report with URL and skip reason. No mass redirect guess.
5. Complete CMS editors for all fields that are in target scope. A field must be explicitly converted, preserved as legacy metadata, or reported unsupported. Never silently drop.
6. Media: current local disk storage is useful for local dev only. Define provider adapter contract (upload, delete, read URL, metadata, signed upload, checksum, transformations); keep binary separate from Mongo document. Cross-host CMS upload → Web SSR image must work via public object origin/CDN, not a private CMS disk path.
7. Security: MIME/extension sniffing, size caps, file name sanitization, path traversal, access checks, orphan cleanup, virus/EXIF policy where required. Public files use safe cache policy and no private metadata.
8. Web SSR renderers: static pages, news/posts, content categories, tags, products/categories, search, homepage, navigation, breadcrumbs, related content. Ensure unknown route 404 and gone route 410; resolver priority cannot let draft/hidden records steal a live slug.
9. Preserve old URL semantics and legacy redirect import. Verify all imported redirect targets exist and are published. Keep manual redirects higher priority than auto rows.
10. SEO: canonical, title/description, OG/Twitter image, sitemap per site, robots, structured data if needed. Locale URL policy is currently `no_prefix`; don't switch to prefixes/`hreflang` without a new decision.
11. Cache: use site/customer-scoped keys; purge only the scope changed; test that one customer's update cannot invalidate or expose another customer's cached page. Separate application cache invalidation from CDN cache purge.
12. PWA: preserve custom injectManifest strategy; do not cache SSR HTML/API responses or one homepage as fallback for all routes; test update across browser session and cross-customer build asset isolation.

**Acceptance:** CMS create/edit/publish → Web SSR shows correct content; drafts hidden; locale fallback correct; URL/redirect mapping verified; media accessible on independent Web deployment; content/settings/menu changes invalidate only expected site cache; browser test desktop/mobile and no cross-customer assets.

### Phase 4 — Catalog, categories, search and import parity (P4)

**Mục tiêu:** catalog mới đủ tin cậy cho commerce/inventory sau này.

Tasks:

1. Complete simple/variable item CRUD; category tree and locale metadata; variants; options/attributes; SKU/barcode; base/sale price; display/SEO; shipping and images.
2. Reconcile all local legacy inventory fields. Report converted/kept/unsupported with counts, including stock/reserved/minStock/manageStock/hasImei/salePrice/variants/options/supplierPrices/barcode/prices/attributes/history/deletedAt and category fields.
3. Do not discard supplier pricing or minStock silently. If supplier-price/warehouse behavior waits on P6, preserve source value in migration report or a reviewed legacy payload field, and document owner decision.
4. Add partial unique indexes for non-empty SKU/barcode/variant identifiers; handle concurrent duplicate creation with DB-level enforcement.
5. Public projection excludes private supplier cost, internal notes, reserved quantities and hidden stock data according to approved policy.
6. Search: check text/index behavior; support locale, category, tag/keyword, active/published status, price range, sort; protect against unbounded regex/expensive query; cursor ordering deterministic.
7. Migration must map legacy ObjectId references to new IDs; deleted flags/status/deletedAt carried; no category soft-deleted record should be reanimated.
8. Serial/IMEI is P6 dependent; do not fake a complete feature with catalog-only fields.
9. Test price edge cases: salePrice 0 treated as no sale if that is current invariant; variable product ranges derived from variant prices; never show 0 for missing variant values.

**Acceptance:** every catalog field classified; create/edit/bulk/public display parity proven; SKU/barcode conflict tests; private data redaction; migration dry-run and parity report clean or explicitly deferred.

### Phase 5 — CRM, Commerce, Checkout, POS and Customer Portal (P5)

**Mục tiêu:** order life cycle và customer ownership đúng business contract.

**Owner-decision gate:** current ADR decisions Q17 and Web-06 excluded checkout because no order storage/payment provider was approved; the full legacy replacement requires this capability or an explicit documented exclusion. Agent phải chuẩn bị decision record, không tự bật.

Tasks when authorized:

1. CRM Customer record linked to Hub subject; addresses and contact preferences, customer segment and metrics. Define guest checkout vs registered customer without creating a local credential user.
2. Cart lives client-side only as convenience; quote endpoint server loads products, variants, price, stock/availability, currency and discounts; returns authoritative line quote and total.
3. Order create idempotency key; snapshot customer address, item title/SKU/variant/price/qty/tax/discount/shipping; store source/channel (`web`, `admin`, `pos`, `portal`).
4. Order states explicit transitions: pending → processing → shipped → completed, cancellation/refund/return as explicit domain commands; no arbitrary status patch.
5. Price/quantity never trusted from client. Server re-quote at place order and reject changed/invalid price/stock with a clear response.
6. Reserve stock atomically with conditional available-quantity check; duplicate submit returns same order; failed payment releases reservations safely.
7. POS must use same pricing/stock/order service, not a separate bypass path.
8. Quotation has validity/expiry enforcement, edit/revision, customer acceptance, exactly-once convert to order.
9. Returns track returned quantity per order line with enforced upper bound; payments refunded proportionally and through reversal ledger entries.
10. Customer portal requires Web auth BFF and owner check on every read/write; a customer cannot access another order by guessing ID.
11. Payment providers only after owner selects and provides sandbox config; implement webhook signature verification, idempotency, status reconciliation, amount/currency verification and no secrets in logs.

**Acceptance:** two concurrent checkouts cannot oversell/create duplicate orders; client price tampering rejected; complete lifecycle tested; portal ownership tests; return cap; POS parity; payment webhook replay test.

### Phase 6 — Inventory, Purchasing and Supplier Portal (P6)

Tasks:

1. Warehouse model with per-user access scope if staff assignment is required.
2. Inventory balance keyed by item/variant/warehouse; transaction ledger as source of truth; reconcile computed balance vs stored balance.
3. Atomic reservation/commit/release; no negative stock unless explicit adjustment policy; concurrency stress test.
4. Transfers have real aggregate (source/destination/status/items/actor) and paired transaction rows with common reference. Support approve/receive/fail/cancel and compensate safely.
5. Adjustment and stocktake models with reason, approval, expected/actual/delta, immutable audit.
6. ItemSerial/IMEI create/import/assign/sell/return/transfer movement must be real writes, unique by serial, and tied to item/variant/order/warehouse.
7. Supplier records and supplier portal linked to Hub subject; scoped purchase orders; supplier cannot see other suppliers' cost/orders.
8. PO lifecycle draft→ordered→receiving→pending/completed/cancelled; partial receipt applies `received - processed` delta only once; accepted/rejected quantity caps validated.
9. Transaction/replica-set topology must be tested. If transaction unavailable, fail closed or build a reviewed compensation flow with idempotent operations; don't silently switch to partial writes.
10. Reconcile purchase payable, inventory asset, stock quantity and supplier cost changes.

**Acceptance:** movement ledger reconciles, concurrent reserve tests, duplicate partial receive safe, transfer atomic/compensated, serial uniqueness, supplier portal ownership.

### Phase 7 — Finance and reporting (P7)

Tasks:

1. `PaymentTransaction`/ledger immutable posting; payment attempts separate from settled ledger entries.
2. Payment allocations to orders/PO/returns; partial payments, overpayment policy, debt aging and currency support.
3. Reversal/refund entries reference the original posting; never erase or edit posted financial history.
4. Gateway abstraction with sandbox/real separation. Do not claim gateway supported until sandbox and webhook path verified.
5. Revenue, P&L, debt, inventory value, category/product and partner reports must aggregate from canonical business records and ledger.
6. Verify sums against fixed fixtures; date ranges include timezone boundary, rounding and pagination; restrict salary/cost/margin/export permissions.

**Acceptance:** all reports reconcile; idempotent webhooks; reversal/partial payment; timezone/currency tests; sensitive report permissions.

### Phase 8 — HR, Communications, Imports and Integrations (P8)

Tasks:

1. StaffProfile linked to Hub subject; do not store local credentials.
2. Attendance, shift/schedule and leave models/write APIs, unique user/day and explicit timezone.
3. Salary config, period calculations, payroll draft/approve/pay, double-pay prevention, immutable finance posting; role-restricted reads.
4. Local business notification inbox/task/delivery states where V2 ADR moves notification ownership out of Hub; preserve provider selection behind adapters.
5. Email templates/outbox/delivery with retry, idempotency, bounce/failure statuses; contact/newsletter forms only after owner approves recipient/storage/consent/anti-abuse policy (Q18 currently says defer).
6. Google/Cloudinary/shipping integrations use server-side provider adapter and secret handling; no raw credentials in Mongo settings or public API.
7. Imports/exports support preview → validate → apply with row-level errors, dry-run default, idempotency and audit. Export must have explicit permission and PII redaction.
8. Durable jobs/cron are currently deferred by Q12/Q21. Don't silently add Redis/BullMQ/cron; if required for publish scheduling, retention or email retry, request a new owner decision and architecture proposal.

**Acceptance:** payroll deterministic/approved, notification/email retry tested, forms abuse controls, provider sandbox and secret redaction, import row recovery, job behavior owner-approved.

### Phase 9 — Full hardening and parity closure (P9)

1. Iterate each row of `docs/v2/05-feature-parity.md`. Every legacy capability must be `VERIFIED`, `OWNER-APPROVED DEFERRED`, `UNSUPPORTED WITH MIGRATION REPORT`, or `NOT REQUIRED`. No unexplained blanks.
2. Security review: IAM, BFF, CSRF, cookies, SSRF/provider URL validation, XSS/content sanitization, upload paths/MIME, webhook signature, IDOR, tenant/site isolation, secret redaction, rate limiting.
3. Browser matrix for every enabled customer and both CMS/Web app. At least desktop/mobile; authenticated session with real Hub test account for Hub screens. Mock pass cannot certify Hub integration.
4. Build matrix for customer layers; verify selected customer assets, brand tokens, runtime env, base domain and no foreign logo/config in output.
5. SEO/crawl: sitemap, robots, canonical, metadata, redirect chain, 404/410, duplicate URLs, multilingual policy, structured data and page titles.
6. PWA: install, offline shell, update across closed session, cache isolation and no SSR document/API in precache.
7. Performance: DB pool, indexes, large lists, page TTFB/LCP, image transforms, cache TTL/invalidation and CDN behavior.
8. Observability: safe structured logs, request IDs, errors/metrics, health/readiness, alert on DB/provider/Hub outage. Don't put PII/credentials/tokens in logs.
9. Backup/restore drill database + media together; test failed restore and rollback path. Add off-site copy/schedule only after owner provides provider and approves.
10. Close all critical/high severity defects before go-live.

### Phase 10 — Migration and production cutover (P10, owner-gated)

**Never start automatically.** The owner must explicitly authorize a named customer, database and time window after local acceptance.

1. Obtain production Mongo URI through approved secret manager; never paste into chat/MD/issues. Verify database identity and least privilege.
2. Obtain immutable source snapshot from legacy DB and record snapshot timestamp/checksum; confirm read permission and source-of-truth freeze/copy plan.
3. Create a new target DB or approved staging database. Never run initial migration over the live source DB.
4. Run `backup:all`/restore verification first; ensure backup includes DB and media bytes.
5. Dry-run all importers in dependency order: content/categories → catalog/categories → settings/site/menu → redirects → other authorized domains. Use actual legacy tenant/customer selection; no implicit all-tenants fallback.
6. Reconcile counts, unique keys, locale records, missing refs, missing bodies/media, statuses/deletedAt, prices/variants, redirects, and not-carried fields. Produce a machine-readable report plus human summary.
7. Apply into target staging DB only; run parity checker and full browser/API smoke.
8. Rehearse rollback: restore pre-import backup into scratch target, verify hashes and indexes, and prove DNS/app version can revert.
9. Owner approves cutover explicitly. Freeze writes or plan dual-write only if approved; switch one customer at a time. Never perform a global all-customer cutover by default.
10. Monitor error rate, order/data consistency, images, search, auth, DB performance and cache after cutover; retain rollback window and evidence.
11. Keep old repos/data read-only until owner signs off. Archive later, do not delete legacy records as a shortcut.

**A6 prerequisites:** production Mongo URI, real snapshot, Vercel token/domains/environment mapping, named customer cutover authorization. Without all, status remains BLOCKED.

---

## 7. Migration/data parity details

### 7.1 Source datasets already measured (do not conflate them)

Existing local reports mention different source snapshots/copies. Do not add their counts together or assume they are the same database:

- Local legacy database copies: `sen-tuan` content around 8 docs and `bag-post` around 18 docs in one inventory pass; bodies mostly HTML, one `gallery` among those local examples, some missing bodies, and thumbnails in more than one shape.
- A separately recorded snapshot dry-run counted 123 content records across several formats (`standard`, `quote`, `link`, `gallery`, `audio`, `video`).
- Catalog inventory in local `sen-tuan`: 241 items; `variants/options` on 223, `salePrice` on 138, `supplierPrices` on 9, stock-related fields populated on all 241 in the reported copy. Some fields such as barcode/prices/attributes were null in that copy; not-carried catalog fields have already been inventoried in TODO/audit docs.

Before new import work, capture the exact DB name, snapshot source, collection counts and timestamp. Never assume the 123-content snapshot is identical to current local `sen-tuan`/`bag-post` databases.

### 7.2 Mapping matrix requirement

Create/update a `migration-mapping` table with columns:

| Source collection/field | Target collection/field | Transform | Count present | Count migrated | Count kept legacy | Count unsupported | Validation |
|---|---|---|---:|---:|---:|---:|---|

Every populated field in legacy source must have a row. Examples:

- `contents.format` → target `format` + `legacy.format` as decided; never silently convert to `standard`.
- `contents.content` HTML → target locale body `html`; sanitize when rendering, retain original in safe storage if required.
- gallery/media array → media IDs only when exact mapping exists; otherwise preserve/report and flag incomplete.
- `items.variants/options` → product variants/options with SKU/attribute mapping.
- `items.supplierPrices` → defer only with count/report and owner decision; no false success.
- `stock/reserved/minStock/hasImei` → inventory domain once P6 schemas exist; never convert into arbitrary catalog display field without design.
- category tags/banner/gallery/history → mapped or explicitly retained/unsupported.
- `isDeleted/deletedAt/status` → preserve. Deleted record must never reappear as published/live.
- author/user IDs → map to Hub subject only when there is verified identity mapping; unresolved actor remains historical reference, not a new login grant.

### 7.3 Migration engine requirements

- Dry-run default; `--apply` explicit and environment-checked.
- Require explicit target DB name and source DB identity; reject production target unless owner-authorized flag/context is supplied.
- Tenant/customer selection must be consistent between importer and `check:migration`. Do not let parity checker count untagged records the importer skipped.
- Use projection to avoid loading credential values. Settings migration should fetch key inventory first, then fetch only allowlisted site identity values. Exclude secret keys by default.
- Plan output must include source counts, included counts, skipped counts/reasons, conflicts, target counts, ID/reference resolution and checksum.
- Apply is idempotent; repeat apply must not duplicate data or overwrite manual edits/redirects. Record source ID/checksum/version.
- Do not delete/modify source rows. Do not emit secrets/PII to logs.
- `check:migration` must validate same tenant selection and exact target equivalence, not count rows the importer intentionally skipped.
- Preserve user-selected J1/J2 rules. J3 existing rehearsal should be documented as local evidence, not production result.

---

## 8. Security and secret handling — P0 before any launch

### 8.1 Legacy secrets

The legacy repositories contain hard-coded default/fallback secret material and/or provider credential values in source configuration. Additionally, an inventory in local `system_configs` found 18 plaintext credential keys. This file intentionally does not reproduce any credential value.

Required handling:

1. Treat all committed legacy secret values as compromised.
2. Audit deployment envs, `git` history, old Vercel projects, CI variables and external providers to discover each consumer.
3. Inventory key names only, provider, app/customer scope, last consumer and rotation status. Never dump values.
4. Create replacement credentials at provider/Hub vault.
5. Update approved secret manager/env with least privilege.
6. Verify actual consumer behavior with redacted logs.
7. Revoke old credentials only after dependent services use the replacements.
8. Remove fallback values from source code; missing required secret must fail startup/readiness or disable that integration explicitly. Never insert a fake-looking default secret.
9. Do not use `git filter-repo`/history rewrite without owner approval; rotation is mandatory even if the history is rewritten.

### 8.2 Target API security

- Hub is the only identity issuer/role authority.
- Browser only receives safe DTOs; no tokens, app secrets, provider keys, Mongo URIs or Hub service credentials.
- Verify permission at API layer for every read/write. Protect exports, uploads, bulk operations and jobs.
- Verify tenant, site, record ownership on server from trusted context; never trust `siteId`, `tenantId`, `customerId`, `ownerId` from request body.
- Sanitize/render HTML with explicit allowlist; do not execute legacy HTML or embeds. Escape contact form/user text in emails.
- Rate-limit public forms, newsletter, checkout, login, search, uploads and webhooks; use CAPTCHA where appropriate and consent/anti-spam controls.
- Validate provider destination URLs against SSRF (loopback/private/link-local/metadata endpoints) when a provider URL can be configured.
- Verify webhook signatures, timestamps/replay windows and idempotency.
- Logs include request/correlation IDs and safe status only; redact email, phone, address, tokens, keys and payment references as policy requires.
- CSP/security headers, CORS, cookie policy, upload limits and public cache headers tested on production build.

---

## 9. Developer workflow and commands

### 9.1 Environment

Current target repo toolchain from root package: Node `^24.15.0 || >=26.0.0`, pnpm `12.15.0`. Use Windows PowerShell syntax or Git Bash syntax consistently. The documented Git Bash commands:

```bash
pnpm install --frozen-lockfile
TM_CUSTOMER_ID=sentuan TM_AUTH_MODE=hub pnpm dev:cms
TM_CUSTOMER_ID=sentuan pnpm dev:web
```

CMS `http://localhost:4005`, Web `http://localhost:4006`. Start in separate terminals. Use local Hub/stubs and local Mongo for automated tests; don't inherit production environment variables.

### 9.2 Minimum gates after changes

From `tm-websites` root:

```bash
pnpm validate:registry
pnpm verify:scaffold
pnpm test:layers
pnpm test:hub
pnpm test:iam
pnpm test:refresh-coordinator
pnpm test:db
pnpm test:content
pnpm test:categories
pnpm test:catalog
pnpm test:media
pnpm test:audit
pnpm test:audit-write
pnpm test:settings
pnpm test:menus
pnpm test:web-content
pnpm test:web-site
pnpm test:web-cart
pnpm test:web-routes
pnpm test:legacy-import
pnpm test:migrate-apply
pnpm test:backup-restore
pnpm test:media-backup
pnpm test:backup-bundle
pnpm test:purge-scope
pnpm test:pwa-isolation
pnpm test:build-matrix
pnpm verify:all
pnpm typecheck
pnpm lint
```

Run relevant subsets during a slice; run the complete suite before phase exit. Inspect test output and exit codes. Do not run commands merely to record a green line if they don't cover changed behavior.

Build both hosts for all enabled customers using the documented build matrix. At minimum:

```bash
TM_CUSTOMER_ID=sentuan pnpm build:cms
TM_CUSTOMER_ID=sentuan pnpm build:web
TM_CUSTOMER_ID=bagpost pnpm build:cms
TM_CUSTOMER_ID=bagpost pnpm build:web
```

`default`, `thanhtung`, `hoangvi` require explicit DB configuration before claims of full business operation; build-only may still be tested as customer-specific shells where the registry enables it. Do not invent DB names.

`tm-platform` checks from its repo:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

`tm-hub` checks from its repo:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

Do not run `pnpm seed`, `seed:reset`, production SQL or deployment tasks as part of websites local test unless a separately authorized Hub task requires it. Specifically do not run A1 migration or A2 drill again.

### 9.3 Browser verification

For each implemented vertical slice, verify real UI flows in browser, not only API/type tests:

- CMS login with Hub test account, session state, app/tenant label, permission-denied UI.
- CMS CRUD create/edit/delete/restore and optimistic conflict.
- Content/media/settings/menu changes reflected on Web SSR.
- Storefront home, listing, search, category/tag, detail, redirects, 404/410, empty/unavailable states.
- Desktop and mobile viewports; keyboard navigation/accessibility; light and dark themes.
- Portal only with actual authenticated Hub test user and ownership fixtures.
- Browser DevTools: no secrets/tokens in localStorage, JS-readable cookies, SSR payload or API response.
- PWA install/offline/update and no cross-customer asset leakage.

Use disposable records and remove probes only from the local test database. Keep a test report with URLs, customer ID, build revision, screenshots/traces where safe, and console/network findings; never capture credentials.

---

## 10. Deployment target architecture

Production host provider/region must follow owner’s current infra decision; this plan does not authorize provisioning or deployment. The deployable architecture should remain two application deployments backed by the same business DB binding per customer:

| Deployable | Role | Required environment (names only) |
|---|---|---|
| `tm-cms` | Admin SPA + Nitro BFF/business mutations | `TM_CUSTOMER_ID`, CMS `TM_APP_ID`, Hub URL, server-only Hub client credentials as contract requires, Mongo URI, DB/site binding, media storage adapter config, origin/revalidate config |
| `tm-web` | SSR storefront/public API/PWA | `TM_CUSTOMER_ID`, Web `TM_APP_ID`, site URL/domain, read-only or scoped Mongo access, public media origin, cache/revalidation config |
| `tm-hub` | IAM/control plane | Existing Hub Supabase environment and approved app registry; don't duplicate business DB secrets into browser |
| MongoDB | Per-customer business database | Separate least-privilege CMS writer/Web reader if supported; replica set where transactions are required; backup/restore/offsite plan |
| Object storage/CDN | Public/private media bytes | Signed server-side grants or provider adapter; customer/site prefixes and cache policy |

Vercel is the current documented expected hosting family for `tm-websites`, but no production token/domain is currently available in the audit scope. Do not add `.vercel` linkage, deploy or set production env without owner instruction. Local start and preview builds are the current deliverable.

### 10.1 Customer build/deploy matrix

- One build per selected customer/app layer; do not build runtime multi-brand by accepting customerId from query/header.
- Verify each build includes only its customer logos, favicon, manifest, OG assets, theme, allowed modules and domains.
- CMS and Web for one customer must resolve to the same site/database owner as registry.
- `bagpost` and `sentuan` are the two customer mappings currently declared with Mongo DB.
- `default`, `thanhtung`, `hoangvi` require explicit owner DB mapping before enablement of business data.
- Multi-domain routing needs approved mapping to the corresponding deployment/build; no host header alone can switch database without a trusted allowlist.

### 10.2 Rollout strategy

1. Local stable and full tests.
2. Disposable staging database migration rehearsal.
3. Non-production deployment for one customer after access approved.
4. Owner acceptance of content/catalog/SEO/auth/ERP flows.
5. Production snapshot + dry-run, exact one-customer migration, reconciliation.
6. Owner approval for cutover.
7. Controlled DNS/deployment switch, smoke and monitoring.
8. Rollback if metrics/parity fail.
9. Repeat per customer; no global switch by default.

---

## 11. Immediate next actions — bắt đầu từ đây

Agent phải thực hiện theo thứ tự, không bắt đầu P5–P8 trong khi P0–P4 và local stabilization chưa sạch.

### Batch 1 — ngay bây giờ

- [ ] Kiểm tra local branches/working tree của cả `tm-websites` và `tm-hub`; giữ `d5503a7`, `ef54968` và mọi user WIP.
- [ ] Reconcile với remote `main` bằng compare log; chuẩn bị feature branches nếu cần.
- [ ] Sửa `test:migrate-apply` order-sensitive JSON assertion; không đổi behavior importer.
- [ ] Rà soát TODO/ADR current vs old remote state; A1 CLOSED, A2 VERIFIED, A3 OPEN/DEFERRED, A5 DEFERRED, A6 BLOCKED/NOT AUTHORIZED.
- [ ] Rà soát `apps.site_ids` read/write consumers bằng code search; chỉ đề xuất/fix ở code local nếu link có thể gây bug; không chạy lại A2 trên Supabase.
- [ ] Chạy complete local Quality Gates, typecheck, lint, CMS/Web build và build matrix; ghi kết quả thật.

### Batch 2 — sau khi Batch 1 sạch

- [ ] Complete content/catalog importer ↔ parity checker consistency and data-field mapping.
- [ ] Audit local content formats/legacy incomplete flags, J1/J2 compliance; no new format renderer unless owner opens scope.
- [ ] Audit CMS/Web media cross-host origin requirement; implement adapter only if provider/origin is already configured for local test; otherwise record blocker and continue unrelated work.
- [ ] Re-run browser checks for Web storefront + authenticated CMS. Use real Hub test account if available; mock mode cannot close Hub-backed screen requirements.
- [ ] Update `docs/v2/05-feature-parity.md`, `07-delivery-roadmap.md`, `08-operations-and-verification.md`, `tasks/todo.md` with exact evidence; remove stale statements only when current evidence supports it.

### Batch 3 — only after owner/local stable

- [ ] A3: robust two-instance refresh test including winner’s new refresh token after loser completes; session state; old token revoked; unaffected sessions.
- [ ] A5: full field-by-field content/catalog mapping and parity verification.
- [ ] Resolve architecture decision Q11 before Web private commands/portals.
- [ ] Reopen Q17/Q18/Q19/Q21 only if owner wants full old checkout/forms/provider/jobs functionality; record new ADR.

### Batch 4 — production later, not in this task

- [ ] A6 prerequisites gathered.
- [ ] Production migration rehearsal against approved snapshot.
- [ ] Owner explicitly authorizes one-customer cutover.
- [ ] Only then deploy/migrate/monitor/rollback.

---

## 12. Definition of Done — “có thể thay thế bộ cũ”

Không dùng một dấu `DONE` chung cho toàn dự án. Chỉ kết luận có thể thay thế legacy khi các điều kiện sau được chứng minh:

### 12.1 Source and engineering

- [ ] `tm-websites` remote/local commits reconciled, clean install reproducible.
- [ ] CI green for every required test; no skipped test with zero cases.
- [ ] Both Nuxt apps build from clean environment for every enabled customer.
- [ ] No cross-repository filesystem links or duplicate Vue runtime.
- [ ] All modules in parity matrix classified; no unexplained pending placeholders.

### 12.2 Feature parity

- [ ] CMS content/settings/media/catalog functionality is verified, including legacy mapping.
- [ ] Public storefront covers homepage, pages/posts, category/tag/search, product list/detail, cart and SEO/redirect behavior.
- [ ] CRM/commerce/customer portal is implemented or formally owner-deferred; full checkout cannot be marked replaced if it remains excluded.
- [ ] Inventory/purchasing/supplier portal implemented or formally deferred.
- [ ] Finance/reports implemented or formally deferred.
- [ ] HR implemented or formally deferred.
- [ ] Mail/notifications/integrations implemented or formally deferred.
- [ ] Legacy bugs documented and intentionally not ported.

### 12.3 Security/data

- [ ] Hub is the only identity authority; no legacy local JWT, passwords or development root bypass.
- [ ] Tenant/app/site/record ownership tested with cross-tenant negative cases.
- [ ] No secret in source defaults, Mongo business data, browser bundle, log or CI artifact.
- [ ] All committed/legacy credential material rotated or explicitly confirmed irrelevant/revoked.
- [ ] Migration mapping field-by-field; unknown/unmapped data is visible in report.
- [ ] Backup/restore database + media; rollback rehearsal succeeded.

### 12.4 Operations/launch

- [ ] Customer-specific runtime configuration, domains, assets, database and public media origin verified.
- [ ] Monitoring/alerts, restore procedure, off-site backup and retention schedule approved.
- [ ] Migration report reconciled against approved snapshot.
- [ ] One-customer cutover and rollback evidence recorded.
- [ ] Owner explicitly signs off each customer before old system becomes read-only/decommissioned.

---

## 13. Agent reporting template

After each batch/phase, append a dated evidence record. Do not overwrite history or claim completion because code exists.

```text
Phase / parity IDs:
Repository + branch + exact commit SHA:
Working tree status (non-secret):
Files changed:
Legacy source files inspected:
Target APIs/models/services/UI changed:
Owner decisions relied upon:
Migration/schema impact:
Authorization and tenant/site checks:
Commands executed + exit codes:
CI run URL and exact result:
Browser/customer/locale/viewport scenarios:
Data fixtures used and cleanup result:
Provider/live checks not run:
Open issues / blockers:
Status: PASS / PARTIAL / FAIL / BLOCKED / OWNER-DEFERRED
Next safe action:
```

### 13.1 Status labels

- `PASS`: named behavior verified on the recorded commit/environment.
- `PARTIAL`: implementation exists but acceptance incomplete.
- `BLOCKED`: cannot proceed without external fact/owner decision/authorization.
- `OWNER-DEFERRED`: owner explicitly deferred it; not a technical pass.
- `FAIL`: a required test/scenario failed.

### 13.2 Permission boundaries

Local code edits, local tests and read-only repository audit are within this execution plan. These actions are **not** authorization to:

- Run `pnpm seed`, `seed:reset`, reset or mutate shared Supabase;
- Re-run A1 or A2;
- Apply database migrations to production or delete production tenant/data;
- Copy/read/print provider secret values;
- Publish npm packages, create paid resources, send real mail/push or charge payment methods;
- Push to `main`, force-push, merge PR, change DNS, create Vercel production deployments or modify production env;
- Switch a production customer to a new Mongo DB or perform A6 cutover.

Ask for explicit authorization for each action. Never hide a blocked state by making the gate optional or changing the acceptance criteria.

---

## 14. Primary repository references

### Target application

- [tm-websites README](https://github.com/tuanmjnh/tm-websites/blob/main/README.md)
- [Canonical V2 docs](https://github.com/tuanmjnh/tm-websites/tree/main/docs/v2)
- [Architecture](https://github.com/tuanmjnh/tm-websites/blob/main/docs/v2/02-architecture.md)
- [Hub auth/BFF](https://github.com/tuanmjnh/tm-websites/blob/main/docs/v2/03-hub-auth.md)
- [MongoDB/API contracts](https://github.com/tuanmjnh/tm-websites/blob/main/docs/v2/04-data-and-api.md)
- [Feature parity](https://github.com/tuanmjnh/tm-websites/blob/main/docs/v2/05-feature-parity.md)
- [UI/storefront](https://github.com/tuanmjnh/tm-websites/blob/main/docs/v2/06-ui-and-storefront.md)
- [Roadmap](https://github.com/tuanmjnh/tm-websites/blob/main/docs/v2/07-delivery-roadmap.md)
- [Operations and verification](https://github.com/tuanmjnh/tm-websites/blob/main/docs/v2/08-operations-and-verification.md)
- [AI execution contract](https://github.com/tuanmjnh/tm-websites/blob/main/docs/v2/09-ai-execution.md)
- [Legacy domain specs](https://github.com/tuanmjnh/tm-websites/blob/main/docs/v2/12-legacy-domain-specs.md)
- [Current TODO](https://github.com/tuanmjnh/tm-websites/blob/main/tasks/todo.md)
- [Questions/decisions](https://github.com/tuanmjnh/tm-websites/blob/main/tasks/questions.md)

### Legacy references

- [nuxt4-cms README](https://github.com/tuanmjnh/nuxt4-cms/blob/main/README.md)
- [nuxt4-cms architecture](https://github.com/tuanmjnh/nuxt4-cms/blob/main/docs/ARCHITECTURE.md)
- [nuxt4-cms docs index](https://github.com/tuanmjnh/nuxt4-cms/blob/main/docs/INDEX.md)
- [nuxt4-website README](https://github.com/tuanmjnh/nuxt4-website/blob/main/README.md)
- [nuxt4-website Nuxt config](https://github.com/tuanmjnh/nuxt4-website/blob/main/nuxt.config.ts)
- [nuxt4-website public APIs](https://github.com/tuanmjnh/nuxt4-website/tree/main/server/api/v1/public)

### Control Plane and shared libraries

- [tm-hub README](https://github.com/tuanmjnh/tm-hub/blob/main/README.md)
- [tm-hub architecture](https://github.com/tuanmjnh/tm-hub/blob/main/docs/ARCHITECTURE.md)
- [tm-platform README](https://github.com/tuanmjnh/tm-platform/blob/main/README.md)
- [tm-platform security review](https://github.com/tuanmjnh/tm-platform/blob/main/docs/security-review.md)
- [tm-platform remaining phases plan](https://github.com/tuanmjnh/tm-platform/blob/main/docs/plans/2026-11-12-remaining-phases.md)

---

## Final direction

**Không cần duy trì `nuxt4-cms` và `nuxt4-website` như hai ứng dụng phát triển song song.** Hãy dùng chúng làm nguồn tham chiếu để hoàn thiện `tm-websites`; tiếp tục dùng `tm-hub` làm Control Plane/IAM và `tm-platform` làm shared packages. Giữ hai deployment `tm-cms` và `tm-web` trong cùng monorepo, dùng một registry và business Mongo binding nhất quán theo customer/site.

Mục tiêu không phải port toàn bộ code cũ. Mục tiêu là port đầy đủ những capability mà owner cần, giữ URL và dữ liệu hợp lệ, cải thiện security/data integrity và có bằng chứng vận hành. Các capability bị hoãn theo owner decision phải được ghi rõ là deferred; không được báo cáo thay thế hoàn toàn nếu còn checkout, portal, inventory, finance, HR hoặc media integration cần thiết chưa được implement hay owner chấp thuận bỏ.
