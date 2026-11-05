# Kế hoạch công việc tiếp theo — TM Websites

**Ngày:** 2026-11-04  
**Trạng thái:** Đề xuất — chờ duyệt trước khi triển khai  
**Phạm vi:** `tm-cms`, `tm-web`, `tm-shared`, `scripts`. Các việc cần sửa `tm-hub` được ghi rõ là dependency bên ngoài repo này.  
**Kế hoạch lịch sử:** [2026-11-02-tm-websites-scaffolding.md](./2026-11-02-tm-websites-scaffolding.md) đã hoàn tất và được đánh dấu superseded, không sửa lại.

---

## 1. Hiện trạng đã kiểm tra

### 1.1. Nền tảng đang chạy tốt

- Customer registry có 5 customer (`default`, `sentuan`, `bagpost`, `thanhtung`, `hoangvi`) và 8 app (`cms`/`web`) được resolve động bằng `TM_CUSTOMER_ID`.
- Layer precedence đúng: customer layer → `cms-base`/`web-base` → `api-base` → `config-base` → `core-base`.
- CMS là SPA (`ssr: false`), Web là SSR (`ssr: true`); host app không chứa `app/pages` hay `app/layouts`.
- CMS đã nối TM Hub thật qua BFF: login/logout/refresh/session, cookie HttpOnly, proxy `/api/hub/[...path]`.
- Các trang CMS đọc dữ liệu thật: Dashboard, Users, Roles, App Configuration, Audit Log, Content (read-only), Settings.
- Media Library đã nối cổng media thật nhưng bị Hub trả `error.cloudinaryNotConfigured`; UI hiển thị callout đúng.
- Gates đã chạy lại trong phiên này và PASS:
  - `pnpm validate:registry` — PASS
  - `pnpm verify:scaffold` — 136/136 PASS
  - `pnpm test:layers` — PASS
  - `pnpm test:hub` — 23/23 PASS
  - `pnpm typecheck` — PASS
  - `pnpm lint` — PASS

### 1.2. Khoảng trống chính

| Khu vực | Hiện trạng | Ảnh hưởng |
|---|---|---|
| 6 module CMS: Catalog, Orders, Inventory, Finance, Reports, AI | Dữ liệu giả hardcode; chuỗi tiếng Việt hardcode; nút "Thêm" không có hành vi | Người dùng bị đánh lừa, không phân biệt được module đã nối hay chưa |
| Web storefront | Chỉ có trang chủ tĩnh và 3 sản phẩm mẫu; chưa có API công khai, slug resolver, sitemap/robots, cache | Chưa phải website thật, không SEO được nội dung |
| Content | CMS chỉ đọc; Hub đã có API create/update/delete nhưng chưa có UI | Chưa có vòng lặp "CMS tạo nội dung → Web hiển thị" |
| Phân quyền content | Hub cho mọi user đã đăng nhập ghi/xóa content, chưa có capability `content.read`/`content.write` | Rủi ro ghi dữ liệu trái phép nếu mở UI ghi |
| Dữ liệu nghiệp vụ | Chưa có tenant DB binding, connection manager, repository/API | Catalog/Orders/Inventory/Finance chưa thể làm thật |
| Vận hành | Không có `.git`, không có CI, chưa deploy Vercel | Không có rollback, không có lưới an toàn khi sửa nhiều |
| Bảo mật | TOTP mới dừng ở báo lỗi; seed password còn mặc định | Chưa đủ điều kiện mở cho khách hàng thật |
| Branding/PWA | Asset là placeholder; PWA mới có manifest, chưa có service worker | Chưa nhận diện thương hiệu thật, chưa cài offline được |

---

## 2. Nguyên tắc ưu tiên

1. **An toàn trước**: có version control và CI trước khi sửa nhiều file.
2. **Không đánh lừa người dùng**: module chưa nối dữ liệu phải nói rõ "chưa kết nối", không hiển thị số liệu giả.
3. **Làm theo lát cắt dọc**: mỗi việc phải đi hết UI → BFF → dữ liệu → kiểm thử, không làm ngang từng tầng.
4. **Ưu tiên giá trị khách hàng thấy ngay**: vòng lặp Content CMS → Web trước, rồi mới đến storefront/catalog.
5. **Cross-repo phải tách rõ**: thay đổi `tm-hub` (public content API, capability) là dependency, không trộn vào task tm-websites.

---

## 3. Lộ trình tổng quan

| Phase | Kết quả | Thời lượng gợi ý | Phụ thuộc |
|---|---|---|---|
| **1. An toàn & trung thực dữ liệu** | Có git + CI; 6 module CMS không còn dữ liệu giả | 2–3 ngày | Không |
| **2. Vòng lặp Content CMS → Web** | Tạo/sửa/publish content trong CMS; Web render content đã publish qua SSR | 4–6 ngày | Phase 1 + thay đổi nhỏ ở `tm-hub` |
| **3. Web storefront MVP** | Site context, public config, catalog list/detail, SEO, cache | 1.5–2.5 tuần | Phase 2 + quyết định nguồn dữ liệu catalog |
| **4. Module nghiệp vụ thật** | Tenant DB binding; Catalog → Inventory/Orders → Finance/Reports/AI | 3–5 tuần | Phase 3 + DB credentials/binding |
| **5. Hardening & launch** | TOTP, PWA, branding thật, Vercel deploy, E2E smoke | 1–2 tuần | Phase 1–4 |

**Đề xuất bắt đầu:** Phase 1, sau đó Phase 2. Hai phase này không cần DB nghiệp vụ và tạo ra giá trị nhìn thấy được ngay.

---

## 4. Chi tiết công việc

### Phase 1 — An toàn & trung thực dữ liệu

#### Task 1: Khởi tạo version control và CI gates

**Mô tả:** Tạo lưới an toàn trước khi sửa nhiều file: git repository, commit baseline, `.gitignore` đúng, và workflow CI chạy các cổng tĩnh hiện có.

**Acceptance criteria:**
- [ ] `git init` tại `D:\Applications\tm-websites`; commit baseline đầu tiên.
- [ ] `.gitignore` chặn `node_modules/`, `.nuxt/`, `.output/`, `.data/`, `.env`, `.env.*` (trừ `.env.example`), `dist/`, log, ảnh tạm.
- [ ] `.github/workflows/quality.yml` chạy trên push/PR với Node 24 + pnpm 12: `validate:registry`, `verify:scaffold`, `test:layers`, `test:hub`, `typecheck`, `lint`.
- [ ] CI không cần secret và không build production ở bước này.

**Verification:**
- [ ] `git log --oneline -1` có commit baseline.
- [ ] `git check-ignore -v tm-cms/.env tm-cms/.nuxt tm-cms/.output node_modules` trả đúng các rule.
- [ ] `git status --porcelain` sạch sau commit.
- [ ] Chạy lại 6 lệnh gate ở trên — PASS.

**Dependencies:** Không.  
**Files likely touched:** `.gitignore`, `.github/workflows/quality.yml`.  
**Estimated scope:** Small (2 files).

> **Cần bạn xác nhận:** hiện thư mục chưa phải git repo. Nếu bạn đã lưu repo ở nơi khác, bỏ qua task này và cho tôi biết đường dẫn repo thật.

---

#### Task 2: Loại bỏ dữ liệu giả khỏi 6 module CMS chưa kết nối

**Mô tả:** Catalog, Orders, Inventory, Finance, Reports, AI đang hiển thị số liệu và bảng mẫu hardcode. Thay bằng trạng thái trung thực "module chưa kết nối dữ liệu", giữ nguyên entitlement gating và cấu trúc `CmsBasePage`.

**Acceptance criteria:**
- [ ] Không còn số liệu/bản ghi mẫu hardcode trong 6 trang (`450`, `184.500.000 ₫`, `Nhẫn Kim Cương Vàng Trắng 18K`, v.v.).
- [ ] Mỗi trang có 2 trạng thái rõ ràng:
  - Entitlement tắt: "Phân hệ chưa nằm trong gói đăng ký".
  - Entitlement bật nhưng chưa có nguồn dữ liệu: "Phân hệ đang chờ kết nối dữ liệu".
- [ ] Không còn nút "Thêm sản phẩm"/"Tạo đơn" giả; nút hành động bị ẩn hoặc disabled kèm tooltip giải thích.
- [ ] Toàn bộ chuỗi hiển thị đi qua i18n `vi`/`en`; không hardcode tiếng Việt trong template hay script.
- [ ] Có một nguồn sự thật duy nhất cho trạng thái module (ví dụ `tm-shared/packages/flow-config` hoặc `tm-shared/nuxt-layers/config-base/app/utils/modules.ts`) để nav và page dùng chung.

**Verification:**
- [ ] `Select-String` không còn các literal mẫu trong 6 trang.
- [ ] `pnpm typecheck` — PASS.
- [ ] `pnpm lint` — PASS.
- [ ] `TM_CUSTOMER_ID=sentuan pnpm validate:build:cms` — PASS.
- [ ] `TM_CUSTOMER_ID=sentuan pnpm build:cms` — PASS.
- [ ] Kiểm tra thủ công 6 route `/catalog`, `/orders`, `/inventory`, `/finance`, `/reports`, `/ai` trên desktop + mobile.

**Dependencies:** Task 1.  
**Files likely touched:**
- `tm-shared/nuxt-layers/cms-base/app/pages/{catalog,orders,inventory,finance,reports,ai}.vue`
- `tm-cms/i18n/locales/{vi,en}.json`
- `tm-shared/nuxt-layers/cms-base/app/layouts/default.vue` (nếu nav dùng trạng thái mới)
- `tm-shared/nuxt-layers/config-base/app/composables/useCustomerConfig.ts` hoặc file module registry mới

**Estimated scope:** Medium (6–9 files).

---

### Checkpoint: Sau Phase 1

- [ ] Git sạch, CI xanh.
- [ ] Không còn dữ liệu giả trong CMS.
- [ ] Typecheck/lint/build CMS sentuan PASS.
- [ ] Review với bạn trước khi sang Phase 2.

---

### Phase 2 — Vòng lặp Content CMS → Web

#### Task 3: Bổ sung capability content ở TM Hub (dependency `tm-hub`)

**Mô tả:** Hiện mọi user đã đăng nhập đều có thể gọi create/update/delete content. Thêm capability `content.read` và `content.write`, gán cho role phù hợp, và enforce ở các route content.

**Acceptance criteria:**
- [ ] Seed/RBAC có `content.read` và `content.write`; role `admin`/`root` được cấp theo thiết kế.
- [ ] `GET /api/v1/content` yêu cầu `content.read`; `POST/PATCH/DELETE` yêu cầu `content.write`.
- [ ] User không có quyền nhận 403 ổn định, không phải 401.
- [ ] Migration/seed idempotent, không phá user/role hiện có.
- [ ] CMS nhận capability qua session và dùng để gate UI.

**Verification:**
- [ ] `pnpm typecheck` + `pnpm lint` trong `tm-hub` — PASS.
- [ ] Test bằng 2 tài khoản: có/không có `content.write`; kết quả 200/403 đúng.
- [ ] `pnpm seed:websites` chạy lại không tạo trùng.

**Dependencies:** Không (repo `tm-hub`).  
**Files likely touched:** `tm-hub/scripts/seed/...`, `tm-hub/server/api/v1/content/*.ts`, `tm-hub/server/modules/...`.  
**Estimated scope:** Medium (4–6 files, repo khác).

---

#### Task 4: CMS Content CRUD

**Mô tả:** Biến trang Content từ read-only thành nơi tạo/sửa/publish/unpublish/xóa mềm/khôi phục nội dung thật qua BFF hiện có.

**Acceptance criteria:**
- [ ] Tạo content mới với `key`, `title`, `description`, `category`, `contentType`, `data` (JSON), `isPublished`.
- [ ] Sửa metadata và payload JSON; validate JSON trước khi gửi.
- [ ] Publish/unpublish và xóa mềm/khôi phục đúng hành vi Hub.
- [ ] Danh sách tự refresh sau mỗi thao tác; có toast thành công/thất bại.
- [ ] Nút ghi chỉ hiển thị khi có `content.write`; API vẫn là lớp bảo vệ cuối.
- [ ] Có confirm trước khi xóa; không xóa cứng nếu chưa được yêu cầu.
- [ ] Loading/empty/error đầy đủ; i18n `vi`/`en`.

**Verification:**
- [ ] Unit test cho payload builder/validator (thêm vào `scripts/build/test-hub-contracts.ts` hoặc test riêng).
- [ ] `pnpm test:hub`, `pnpm typecheck`, `pnpm lint` — PASS.
- [ ] Thao tác thật trên một app/test record: create → edit → publish → unpublish → soft delete → restore.
- [ ] `TM_CUSTOMER_ID=sentuan pnpm build:cms` — PASS.

**Dependencies:** Task 3, Task 2.  
**Files likely touched:**
- `tm-shared/nuxt-layers/cms-base/app/pages/content.vue`
- `tm-shared/nuxt-layers/cms-base/app/composables/useHubAdmin.ts`
- `tm-shared/packages/flow-contracts/src/hub-admin.ts`
- `tm-cms/i18n/locales/{vi,en}.json`
- `scripts/build/test-hub-contracts.ts`

**Estimated scope:** Medium–Large (5–7 files). Nếu phình quá, tách form tạo/sửa thành component riêng.

---

#### Task 5: Public content API ở TM Hub (dependency `tm-hub`)

**Mô tả:** Web không thể gọi endpoint content hiện tại vì yêu cầu đăng nhập. Thêm endpoint công khai chỉ trả content đã publish và chỉ các trường an toàn.

**Acceptance criteria:**
- [ ] `GET /api/v1/content/public?appId=...&category=...&limit=...&cursor=...` không yêu cầu auth.
- [ ] Chỉ trả `isPublished=true` và `isDeleted=false`.
- [ ] Không trả `updatedBy`, `deletedAt`, hay bất kỳ trường nội bộ nào.
- [ ] App-scoped đúng; `appId` thiếu/sai trả 400/404 rõ ràng.
- [ ] Có rate limit và `Cache-Control` phù hợp.
- [ ] Test chứng minh draft/deleted không bao giờ lọt ra.

**Verification:**
- [ ] Test tự động trong `tm-hub` — PASS.
- [ ] `curl` endpoint với app có draft + published; chỉ thấy published.
- [ ] `pnpm typecheck` + `pnpm lint` — PASS.

**Dependencies:** Task 3 (cùng repo `tm-hub`).  
**Files likely touched:** `tm-hub/server/api/v1/content/public.get.ts`, service/contracts, tests.  
**Estimated scope:** Medium (3–5 files, repo khác).

---

#### Task 6: Web render content qua slug resolver

**Mô tả:** Thêm BFF/API phía Web gọi public content API, và trang `[...slug].vue` resolve content theo key/slug, render SSR, trả 404 đúng.

**Acceptance criteria:**
- [ ] `app/pages/[...slug].vue` resolve được content published theo `key` hoặc slug.
- [ ] Nội dung chính có trong HTML server-render (không phụ thuộc client fetch).
- [ ] Draft/không tồn tại trả HTTP 404 thật.
- [ ] Title/description/OG lấy từ content.
- [ ] Không rò rỉ content của app/tenant khác.
- [ ] Có trang 404 thân thiện.

**Verification:**
- [ ] `TM_CUSTOMER_ID=sentuan pnpm build:web` — PASS.
- [ ] Chạy `node .output/server/index.mjs`, `curl` URL content published → HTML có nội dung; URL draft → 404.
- [ ] Kiểm tra HTML không chứa trường nội bộ.

**Dependencies:** Task 5.  
**Files likely touched:**
- `tm-web/server/api/public/content/[...slug].get.ts` (hoặc tương đương)
- `tm-shared/nuxt-layers/web-base/app/pages/[...slug].vue`
- `tm-shared/nuxt-layers/web-base/app/error.vue` / `app/pages/404` nếu cần
- `tm-shared/packages/flow-contracts/src/...` (public DTO)
- `tm-cms/i18n`/`tm-web/i18n` locales

**Estimated scope:** Medium (4–6 files).

---

#### Task 7: SEO baseline cho Web

**Mô tả:** Bổ sung metadata, canonical, OG, sitemap, robots và structured data cho các trang public.

**Acceptance criteria:**
- [ ] Mỗi trang có title/description/canonical/OG duy nhất.
- [ ] `sitemap.xml` chỉ chứa URL published, không chứa draft/private.
- [ ] `robots.txt` chặn preview/private paths; production cho phép index.
- [ ] Content page có JSON-LD phù hợp (Article/WebPage).
- [ ] 404/410/301 semantics đúng; không soft-404.

**Verification:**
- [ ] `curl /sitemap.xml`, `curl /robots.txt`, `curl` một content page — kiểm tra nội dung.
- [ ] Build web sentuan + bagpost — PASS.
- [ ] Kiểm tra HTML head bằng script hoặc browser.

**Dependencies:** Task 6.  
**Files likely touched:** `web-base` pages/layout/plugins, `tm-web/server/routes`, `tm-web/nuxt.config.ts`.  
**Estimated scope:** Medium (3–5 files).

---

### Checkpoint: Sau Phase 2

- [ ] Tạo content trong CMS → publish → thấy trên Web SSR.
- [ ] Unpublish → Web trả 404.
- [ ] Sitemap chỉ có nội dung published.
- [ ] `pnpm test:hub`, `typecheck`, `lint`, build CMS/Web sentuan PASS.
- [ ] Review với bạn trước khi sang Phase 3.

---

### Phase 3 — Web storefront MVP (backlog chi tiết)

| Task | Kết quả | Acceptance chính | Verification | Deps | Size |
|---|---|---|---|---|---|
| **Task 8: Site context + public config** | Web đọc public config của Hub (`/api/v1/apps/:appId/configs/public`) và merge với layer config | Không cần auth; secret không lộ; fallback khi Hub lỗi; app isolation | Build web; curl page; test fallback | Task 6 | M |
| **Task 9: Catalog list/detail** | Trang `/products` và `/products/[slug]` render SSR từ nguồn dữ liệu đã chọn | List/detail có trong HTML; 404 đúng; price/format/i18n; không lộ field nội bộ | Build web; curl list/detail; test isolation | Task 8 + quyết định nguồn dữ liệu | L (tách list/detail) |
| **Task 10: Cache/ISR + revalidation** | `routeRules` theo nhóm trang; cache key có tenant/app; endpoint revalidate có chữ ký | Cache không lẫn tenant; publish content làm mới trang; revalidate sai chữ ký bị chặn | Test cache key; curl revalidate; build | Task 9 | M |

**Quyết định cần chốt trước Task 9:** catalog lấy từ đâu?
- **(A) Tenant MongoDB** — đúng blueprint dài hạn, cần DB binding + credentials; khối lượng lớn.
- **(B) Hub content records** (`category=product`) — nhanh, dùng lại hạ tầng content; phù hợp MVP nhưng không phải mô hình catalog đầy đủ.
- **(C) API nghiệp vụ riêng** — linh hoạt nhưng phải xây mới.

Đề xuất: **(B) cho MVP Web**, đồng thời chuẩn bị Task 11 để chuyển sang (A) khi có DB.

---

### Phase 4 — Module nghiệp vụ thật (backlog)

| Task | Kết quả | Acceptance chính | Deps | Size |
|---|---|---|---|---|
| **Task 11: Tenant DB binding + connection manager** | BFF chọn DB theo tenant từ Hub, không nhận DB từ request | Không thể chọn DB bằng input; connection cache; health check; test isolation | Quyết định DB + Hub binding metadata | L (tách 2–3 task) |
| **Task 12: Catalog thật** | Schema/repository/API/UI catalog đọc-ghi DB tenant | CRUD sản phẩm; phân trang; tìm kiếm; validate; test isolation | Task 11 | L |
| **Task 13: Inventory + Orders** | Tồn kho và đơn hàng thật | Nhập/xuất kho; trạng thái đơn; transaction; test | Task 12 | L mỗi module |
| **Task 14: Finance + Reports + AI** | Báo cáo tài chính, export, AI workspace | Số liệu từ DB; export; phân quyền; AI không lộ dữ liệu tenant khác | Task 13 | L mỗi module |

**Lưu ý:** Phase 4 là khối lượng lớn nhất và phụ thuộc quyết định kiến trúc DB. Không nên bắt đầu trước khi Phase 2–3 ổn định.

---

### Phase 5 — Hardening & launch (backlog)

| Task | Kết quả | Acceptance chính | Deps | Size |
|---|---|---|---|---|
| **Task 15: TOTP login** | Luồng nhập OTP sau `TOTP_REQUIRED`, gọi `/auth/totp/login` | Login TOTP thành công; sai OTP báo lỗi; không lộ token | Task 4 | M |
| **Task 16: PWA service worker** | Cài `@vite-pwa/nuxt`, cache shell/offline | Cài được PWA; offline shell; manifest đúng; không cache dữ liệu nhạy cảm | Phase 1 | S–M |
| **Task 17: Branding thật** | Thay logo/favicon/PWA icon/OG placeholder bằng asset thật | 5 CMS + 3 Web build đúng asset; không lẫn customer | Asset từ bạn | S |
| **Task 18: Vercel deploy + smoke** | 4 project CMS/Web × sentuan/bagpost deploy thật | Build Vercel xanh; login/session/proxy hoạt động; domain đúng | Task 17 + credentials | M |
| **Task 19: E2E smoke** | Playwright smoke cho login, content CRUD, Web content SSR | Chạy trong CI; fail khi regression | Task 18 | M |
| **Task 20: Rotate seed passwords** | Đổi mật khẩu seed hoặc tài khoản thật trước khi mở khách | Không còn mật khẩu mặc định trong môi trường thật | Task 18 | S |

---

## 5. Checkpoints tổng

- **Sau Phase 1:** an toàn + không dữ liệu giả.
- **Sau Phase 2:** CMS → Web content loop chạy thật.
- **Sau Phase 3:** storefront MVP SSR + SEO + cache.
- **Sau Phase 4:** ít nhất Catalog chạy trên DB tenant với test isolation.
- **Sau Phase 5:** deploy thật, TOTP, PWA, branding, E2E.

Mỗi checkpoint đều phải chạy lại toàn bộ gate trong `AGENTS.md` trước khi báo hoàn thành.

---

## 6. Rủi ro và cách giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Không có git/CI | Cao | Task 1 trước mọi thay đổi lớn |
| Dữ liệu giả gây hiểu nhầm | Cao | Task 2; review UI từng module |
| Hub cho mọi user ghi content | Cao | Task 3; gate UI + API; test 403 |
| Rò rỉ dữ liệu public (draft, field nội bộ, tenant khác) | Cao | Task 5–6; test âm; review DTO |
| Phụ thuộc `tm-hub` làm chậm | Trung bình | Tách task cross-repo; có phương án BFF service auth dự phòng |
| Chưa có E2E, regression UI | Trung bình | Task 19; smoke test trước deploy |
| Seed password mặc định | Cao | Task 20 trước khi mở khách |
| Branding placeholder | Trung bình | Task 17; checklist asset |
| Chưa deploy thật, khác môi trường local | Trung bình | Task 18; smoke trên preview trước production |
| Multi-site chưa có | Trung bình | Ghi nhận; chỉ làm khi có yêu cầu site thứ hai |

---

## 7. Câu hỏi cần bạn quyết

1. **Git:** Được phép `git init` tại `D:\Applications\tm-websites` và tạo commit baseline không? (Hiện chưa có `.git`.)
2. **Content CRUD:** Được phép ghi thử lên Hub production không, hay dùng một app/tenant test riêng? Có thể xóa record test sau khi kiểm tra?
3. **Public content API:** Đồng ý thêm endpoint public ở `tm-hub` (Task 5), hay muốn Web BFF dùng service credential để gọi endpoint auth hiện có?
4. **Nguồn catalog cho Web MVP:** chọn (A) tenant MongoDB, (B) Hub content `category=product`, hay (C) API riêng?
5. **Customer ưu tiên:** làm MVP trên `sentuan` trước, hay `bagpost`?
6. **Phạm vi repo:** được phép sửa `tm-hub` trong cùng đợt, hay chỉ làm trong `tm-websites` và chờ?
7. **Vercel:** ai cung cấp quyền/credential để deploy và kiểm tra domain?

---

## 8. Đề xuất bắt đầu ngay

Nếu bạn duyệt, thứ tự thực hiện trong phiên tới:

1. Task 1 — git + CI (nếu được phép).
2. Task 2 — làm sạch 6 module CMS.
3. Chạy checkpoint Phase 1.
4. Task 3–4 — content CRUD (sau khi chốt quyền ghi Hub).
5. Task 5–7 — Web content loop.

Không bắt đầu Phase 4 cho đến khi có quyết định về DB binding và credentials.
