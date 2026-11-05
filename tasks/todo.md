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

**Still pending by design (no tenant data source in TM Hub):** Catalog, Orders, Inventory, Finance, Reports, AI workspace — these stay on the `pending` module-state screen. TM Hub exposes no products/orders/inventory/finance endpoints; the blueprint's `/api/v1/admin/*` paths are legacy reference only.

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
- [ ] Task 16: PWA service worker
- [ ] Task 17: Branding thật
- [ ] Task 18: Vercel deploy + smoke
- [ ] Task 19: E2E Playwright smoke
- [ ] Task 20: Rotate seed passwords

## Gate bắt buộc trước mọi checkpoint

All gates below were run after the Hub resource modules landed. Result: PASS.

- [x] `pnpm validate:registry`
- [x] `pnpm verify:scaffold` (136/136)
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

Not verified in a live browser: the Hub-backed pages (media/notifications/mail/routes/connections) are compile/lint/build/contract verified only. No signed-in Hub session was used, so runtime rendering is unconfirmed.

## Chờ quyết định

- [ ] Có được `git init` không?
- [ ] Ghi content thử lên Hub production hay dùng app/tenant test?
- [ ] Public content API ở `tm-hub` hay BFF service credential?
- [ ] Catalog MVP: tenant MongoDB / Hub content / API riêng?
- [ ] Customer ưu tiên: sentuan hay bagpost?
- [ ] Có được sửa `tm-hub` trong cùng đợt không?
- [ ] Ai cung cấp Vercel credential/domain?
