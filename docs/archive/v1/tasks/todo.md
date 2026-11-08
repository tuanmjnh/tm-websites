# TODO — TM Websites Next Work

> Kế hoạch chi tiết: [`docs/superpowers/plans/2026-11-04-next-work-plan.md`](../docs/superpowers/plans/2026-11-04-next-work-plan.md)
>
> Trạng thái: **Đề xuất — chờ duyệt**. Không bắt đầu implementation khi các câu hỏi ở mục 7 của plan chưa được trả lời.

## Delivered — Hub resource modules (CMS)

Each entry is a page/composable wired to a verified TM Hub endpoint, gated by the Hub capability the endpoint enforces. No module was implemented without a real data source.

- [x] Media Library (`/media`) — `media.read`; folders + Cloudinary resources, cursor paging, `error.cloudinaryNotConfigured` callout.
- [x] Notifications (`/notifications`) — `notifications.read` / `notifications.send`; inbox, mark-read, mark-all, compose (title/body/url).
- [x] Email Center (`/mail`) — `mail.manage` / `mail.analytics.read` / `mail.send`; templates list + status filter, 30-day delivery analytics, queue stats.
- [x] App Routes (`/routes`) — `routes.read`; route definitions with visibility/permission gating, filter by visible/hidden/gated.
- [x] Integrations (`/connections`) — `connections.read`; code-registry provider definitions + connection status.
- [x] Content (`/content`) — ungated read of Hub content; CRUD/publish/restore already wired.

Contracts added to `tm-shared/packages/flow-contracts/src/hub-admin.ts`: notifications, mail template/summary/queue, routes, connections. Fetchers added to `cms-base/app/composables/useHubAdmin.ts`. Contract coverage added in `scripts/build/test-hub-contracts.ts` (28 checks).

**Still pending (no tenant data source in TM Hub):** Catalog, Orders, Inventory, Finance, Reports stay on the `pending` module-state screen. TM Hub exposes no products/orders/inventory/finance endpoints; the blueprint's `/api/v1/admin/*` paths are legacy reference only.

**AI Workspace is now mislabelled as pending:** TM Hub does expose `apps/:id/ai/providers`, `ai/models`, `ai/connections`, `ai/relay/*` and `chat/*`, so the module has a real data source and only needs a UI. It is not wired yet — the page still renders the pending screen.

## Phase 1 — An toàn & trung thực dữ liệu

- [ ] Task 1: Khởi tạo git + CI gates
- [x] Task 2: Loại bỏ dữ liệu giả khỏi 6 module CMS (Catalog, Orders, Inventory, Finance, Reports, AI)
- [x] Task 2b: Thêm nguồn sự thật cho trạng thái module (entitlement + connected)
- [x] Checkpoint Phase 1: gates PASS, build CMS sentuan PASS, review

## Phase 2 — Vòng lặp Content CMS → Web

- [ ] Task 3 (tm-hub): capability `content.read` / `content.write`
- [ ] Task 4: CMS Content CRUD (create/edit/publish/soft-delete/restore)
- [ ] Task 5 (tm-hub): public content API chỉ trả published + field an toàn
- [ ] Task 6: Web slug resolver + render content SSR + 404
- [ ] Task 7: Web SEO baseline (metadata, canonical, OG, sitemap, robots, JSON-LD)
- [ ] Checkpoint Phase 2: CMS tạo content → Web SSR thấy nội dung; unpublish → 404

## Phase 3 — Web storefront MVP

- [ ] Task 8: Site context + Hub public config
- [ ] Task 9: Catalog list/detail (sau khi chốt nguồn dữ liệu)
- [ ] Task 10: Cache/ISR + revalidation có chữ ký
- [ ] Checkpoint Phase 3: storefront SSR + SEO + cache

## Phase 4 — Module nghiệp vụ thật

- [ ] Task 11: Tenant DB binding + connection manager
- [ ] Task 12: Catalog thật
- [ ] Task 13: Inventory + Orders
- [ ] Task 14: Finance + Reports + AI

## Phase 5 — Hardening & launch

- [ ] Task 15: TOTP login
- [x] Task 16: PWA service worker — Web (`injectManifest`, offline shell; CMS vẫn chỉ có manifest, xem ghi chú cuối)
- [ ] Task 17: Branding thật
- [ ] Task 18: Vercel deploy + smoke
- [ ] Task 19: E2E Playwright smoke
- [ ] Task 20: Rotate seed passwords

## Gate bắt buộc trước mọi checkpoint

All gates below were run after the Web PWA landed. Result: PASS.

- [x] `pnpm validate:registry`
- [x] `pnpm verify:scaffold` (145/145)
- [x] `pnpm test:layers`
- [x] `pnpm test:hub` (28 checks)
- [x] `pnpm test:web-content` (21 checks)
- [x] `pnpm --dir tm-shared run typecheck`
- [x] `pnpm typecheck` (recursive)
- [x] `pnpm lint` (recursive)
- [x] `TM_CUSTOMER_ID=sentuan pnpm validate:build:cms`
- [x] `TM_CUSTOMER_ID=sentuan pnpm validate:build:web`
- [x] `TM_CUSTOMER_ID=sentuan pnpm build:cms`
- [x] `TM_CUSTOMER_ID=sentuan pnpm build:web`
- [x] CMS build matrix, all customers: `default`, `sentuan`, `bagpost`, `thanhtung`, `hoangvi`

The Hub-backed pages were verified in a live browser afterwards — see *Hub live verification* below.

## Hub live verification (2026-11-06)

The two source projects stay as the functional reference: `nuxt4-cms` and `nuxt4-website`. The new app takes its backend from `tm-hub` only; the originals' own Nitro/Mongo endpoints are reference, not targets.

Ran `tm-hub` locally (`pnpm dev`, port 4000) against its configured Supabase: `/api/v1/health` → `db: ok`. Signed in through the CMS login (Hub credentials `sentuan-root@example.com`, app `app_sentuan_cms`), then checked every Hub-backed page in the browser:

- `/` dashboard — 2 members, 2 roles, 7 licensed modules, real audit-log rows, `app_sentuan_cms` / `tenant_sentuan`.
- `/users`, `/roles` — real members and role definitions with `root` / `admin` roles.
- `/routes`, `/configs` — empty in this installation; Hub really returns 0 routes and 0 config keys (verified over HTTP, not a UI bug).
- `/media` — Hub answers `400 error.cloudinaryNotConfigured`; the page renders its designed credentials callout (`CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET`).
- `/mail` — analytics summary and queue render; queue reports offline because Redis is not running (expected).
- `/notifications` — empty inbox.
- `/connections` — 7 provider definitions from the Hub code registry.
- `/content` — the published `docs` record belonging to the paired website app `app_sentuan_web`.

Contract shapes matched `@tm/flow-contracts` for all of the above, so the CMS/BFF layer needs no change for these endpoints.

### Dự án gốc → bản mới → nguồn tm-hub

| Nhóm chức năng (bản gốc) | Bản mới | Nguồn dữ liệu | Trạng thái |
| :--- | :--- | :--- | :--- |
| `system/users`, `system/roles`, `system/routes`, `system/config` | `tm-cms` `/users`, `/roles`, `/routes`, `/configs` | `apps/:id/{users,roles,routes,configs}` | verified live |
| `settings/mail`, `settings/media`, `settings/connect`, `notify` | `tm-cms` `/mail`, `/media`, `/connections`, `/notifications` | `apps/:id/{mail,media,connections,notifications}` | verified live (media cần Cloudinary) |
| `content/pages`, `content/posts`, `content/categories` | `tm-cms` `/content` | `/api/v1/content` + `/content/public` | verified live |
| `products/*`, `commerce/*`, `inventory/*`, `finance/*`, `hr/*` | `tm-cms` `/catalog`, `/orders`, `/inventory`, `/finance`, `/reports` | — | pending: tm-hub chưa có endpoint |
| (không có ở bản gốc) | `tm-cms` `/ai` | `apps/:id/ai/*`, `/chat/*` | chưa nối, đã có nguồn |
| `nuxt4-website`: trang chủ, sản phẩm, search, tag, `[...slug]`, cart, checkout | `tm-web`: `/`, `/products`, `/categories`, `[...slug]` | content qua BFF → Hub public; catalog qua Mongo | content live, catalog chờ task 11 |

Regression observed while probing: none of the Hub pages threw; the only failing endpoints are the ones that need third-party credentials (Cloudinary) or a running service (Redis queue).

## PWA (Task 16) — what was actually checked

Web build (`TM_CUSTOMER_ID=sentuan`, `bagpost`, `default`) with `@vite-pwa/nuxt` in `injectManifest` mode; worker source `tm-web/service-worker/sw.ts`, offline page `tm-web/public/offline.html`.

- Generated `sw.js` inspected in all three builds: 71 precache entries, all absolute-path-free, branding-only (no cross-customer asset), no `/api/**`, no SSR document, no hand-written `importScripts`.
- `node .output/server/index.mjs` on `127.0.0.1:4016`, opened in Chromium: worker `activated` and controlling the page; caches = `workbox-precache-v2-*` (71 URLs) + `tm-offline` (1 URL = `/offline.html`).
- Offline path: server stopped, navigation to `/products` rendered the offline page (title `Đang ngoại tuyến`). Server restarted, same URL rendered SSR HTML again — navigations are network-first, the fallback is failure-only.
- `/sw.js` is served `public, max-age=0, must-revalidate`; `/manifest.webmanifest` is `application/manifest+json` per customer.

Still open: the CMS keeps its manifest but has no service worker, so `/login` is not offline-capable yet; PWA is disabled in `nuxt dev` by design (`TM_PWA_DISABLED` also force-disables it).

## Chờ quyết định

- [ ] Ghi content thử lên Hub production hay dùng app/tenant test?
- [ ] Catalog MVP: tenant MongoDB / Hub content (`category=product`) / API riêng trong tm-hub?
- [ ] Customer ưu tiên: sentuan hay bagpost?
- [ ] Có được sửa/thêm endpoint `tm-hub` trong cùng đợt không?
- [ ] Ai cung cấp Vercel credential/domain?
