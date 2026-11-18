# TM CMS / TM Web — Remaining Decisions & Repository Audit

> **Ngày chốt:** 2026-11-18  
> **Cập nhật lần 2 (2026-11-18):** đối chiếu lại `tm-hub` bằng source + runtime local/live, bổ sung runbook kiểm tra, ghi nhận quyết định package của owner. Chỉ `tm-websites` được sửa trong đợt này; `tm-hub` chỉ đọc.  
> **Mục đích:** Chốt phạm vi sản phẩm, xử lý các câu hỏi còn mở, ghi nhận tình trạng thực tế của `tm-hub` và `tm-platform`, đồng thời đưa ra queue triển khai để AI coding agent không tự suy diễn.  
> **Đối tượng:** `tm-hub`, `tm-platform`, `tm-cms`, `tm-web`.  
> **Nguyên tắc:** Không tự tạo credentials, không invent legacy data, không migrate hoặc deploy production nếu chưa được cấp quyền.

---

## 0. Executive decision

### 0.1. Quyết định tổng thể

1. **V2 tập trung vào CMS + public product/content website**, không mở rộng thành ERP đầy đủ.
2. **Orders, Inventory, Finance, Reports và CAT-02 serial/IMEI**: giữ ngoài scope hiện tại; CAT-02 tiếp tục BLOCKED cho đến khi có quyết định triển khai Inventory/serial tracking.
3. **AI Workspace**: vẫn OUT OF SCOPE. Giữ tương thích kỹ thuật với TM Hub AI Provider/Model/Grant và `@tuanmjnh/tm-ai-client`, nhưng không xây AI Workspace UI trong đợt này.
4. **tm-web là public storefront SSR**: không có login/account/customer portal trong scope hiện tại. Chỉ CMS có user authentication. Public website truy cập ẩn danh; SSR server chỉ dùng service identity nếu cần đọc dữ liệu public.
5. **WEB-06 checkout, WEB-07 forms, public media projection, locale-prefixed URLs/hreflang, durable event queue/cron, Hub legacy import/real-data migration**: tiếp tục OUT OF SCOPE theo mục 4 trong danh sách cập nhật ngày 2026-11-18. Các quyết định tạm trước đây về COD/transfer checkout không còn áp dụng cho V2.
6. **Không sử dụng Redis/BullMQ cho CMS/Web ở V2**. Không tự bật scheduler. Publish/prune và tác vụ cần lịch chạy thủ công.
7. **Cache purge**: chỉ giữ cơ chế internal purge hiện có sau khi harden secret/signature và tenant/site scope. Không tích hợp CDN vendor-specific purge trong scope hiện tại.
8. **Production migration/deployment**: BLOCKED do chưa có production Mongo URI, legacy snapshot được phép sử dụng, Vercel token/domain và production authorization.

### 0.2. Trạng thái theo nhóm

| Nhóm | Quyết định | Trạng thái |
|---|---|---|
| Product scope | CMS + catalog/content storefront; ERP modules deferred | RESOLVED |
| AI Workspace | Không làm V2 | RESOLVED |
| Storefront auth | Public anonymous; chỉ CMS login | RESOLVED |
| CSRF | Strict Origin/Fetch Metadata + double-submit | RESOLVED (decision) / implementation OPEN |
| Hub auth contract | Không có `sid`/`tenantId` claim; introspect không kiểm tra revocation; refresh không grace window | VERIFIED (source + local/live runtime) |
| CDN/provider purge | Internal purge only; chưa có CDN adapter | RESOLVED |
| OPS import/export/jobs | Bulk import/export/jobs deferred | RESOLVED |
| Legacy migration | Không migrate nếu chưa có snapshot và quyền | BLOCKED |
| Public media origin | Deferred; Cloudinary là lựa chọn mặc định khi mở lại | RESOLVED / BLOCKED on credentials |
| Locale URLs | Giữ `no_prefix`; không hreflang trong V2 | RESOLVED |
| Durable jobs | Deferred; manual operation | RESOLVED |
| NPM `tm-ui` | Không publish/adopt trong đợt này; SSR-safe làm sau | DEFERRED by owner |
| Live Hub verification | Local Hub `:4000` và live Hub `1.1.0` đều healthy; contract probe 8/8 | VERIFIED (unauthenticated); authenticated session BLOCKED on test account |

---

# 1. Repository audit — evidence and limits

## 1.1. Repository revisions inspected

| Repository | Branch | Commit inspected | Commit message summary |
|---|---|---|---|
| `tm-hub` (local clone, read-only) | `main` | `2a917cbb303a7051c8337da1f316e7e3a79f41a0` | Register `UFormField` in generated `tm-ui` globals registry |
| `tm-platform` (local clone, read-only) | `main` | `9e7a766eda19fd4332658b10328868eb03f79b77` | Add `tm-ai-client` and update workspace release exclusions |
| `tm-websites` (workspace được sửa) | `main` | `0d1d7f2b` + working tree | Treat a closed publish window as hidden when writing automatic redirects |
| Live Hub deployment | — | runtime `1.1.0` | `/api/v1/health` trả `db: ok`, 2026-11-18 |

All four sources are present on this machine (`D:\Applications`). This revision inspected them directly:

- **`tm-cms` / `tm-web`:** read `server/utils/hubClient.ts`, `context.ts`, `csrf.ts`, `authSession.ts`, `refreshCoordinator.ts`, `server/api/hub/[...path].ts`, `tm-shared/packages/flow-utils/src/hub.ts`, `scripts/build/test-cms-iam.ts` and `test-refresh-coordinator.ts`. Conclusions below about the BFF/CSRF/proxy are a direct source audit, not the owner's issue list.
- **`tm-hub` (read-only):** `server/modules/token/jwt.ts`, `server/modules/auth/service.ts`, `server/api/v1/auth/{login,refresh,introspect,me}.post|get.ts`, `server/api/v1/auth/sessions/*`, `server/api/v1/tenants/*`, `server/modules/tenants/service.ts`, `server/utils/request.ts`.
- **Runtime:** local Hub on `http://localhost:4000` (restarted during this revision, healthy `1.1.0`) and live Hub `https://tm-hub-app.vercel.app` both answered the contract probes in §3.7.
- **Not done:** no account login, session revoke, tenant mutation or multi-instance test was exercised; no production migration or deployment.

## 1.2. TM Hub — what is present

The current Hub repository contains:

- Tenant and Site migration `supabase/migrations/20261102000000_tenant_app_installation_upgrade.sql`.
- Tenant service module `server/modules/tenants/service.ts`.
- Tenant endpoints under `server/api/v1/tenants/**`.
- App Registry fields including `tenant_id`, `app_code`, `app_kind`, `environment`, `installation_status`, `site_ids`, and `database_binding_ref`.
- Tenant/Site records, app pairing by `tenant_id`, and tenant-related management UI.
- `POST /api/v1/auth/introspect`.
- Session list/revoke endpoints using `refresh_tokens`.
- Device Registry and device-linked refresh-token checks.
- Cloudinary Media Gateway, separate Storage Gateway (R2/S3/Supabase), AI provider domain and AI relay.

**Assessment:** Tenant/Site/App Registry foundations exist in code. Do not reimplement Tenant Registry from scratch. Remaining work is implementation hardening and contract completion.

### 1.2.1. Verified auth surface (source + runtime, 2026-11-18)

| Capability | Verified behavior | Evidence |
|---|---|---|
| Access-token claims | `sub`, `appId`, `email`, `name`, `roles`, `permissions`, `allowedRoutes`, `iat`, `exp`. **No `sid`/`sessionId`. No `tenantId`.** | `tm-hub/server/modules/token/jwt.ts` (`TokenPayload`), `server/modules/auth/service.ts` (`issueSession`) |
| Login | `POST /api/v1/auth/login` requires `appId` + `email` + `password`; a TOTP account gets `totpRequired` + `pendingTotpToken` instead of tokens | `server/api/v1/auth/login.post.ts` |
| `/auth/me` | Validates the JWT signature/expiry only, then reads `users` for `name`/`username`/`avatar_url`/`totp_enabled`. It does not join or check the refresh-session row | `server/api/v1/auth/me.get.ts` |
| `/auth/introspect` | Returns `{ valid, sub, appId, email, name, roles, permissions, allowedRoutes }`; it never queries `refresh_tokens`, so a revoked session still introspects as valid until `exp` | `server/api/v1/auth/introspect.post.ts` |
| Refresh rotation | Atomic claim (`update … is revoked_at null`); the winner inserts a new refresh row. A token whose row is already revoked is treated as reuse and **revokes every active session for that `user_id` + `app_id`** | `server/api/v1/auth/refresh.post.ts` |
| Grace window | **None.** There is no rotation-family or idempotency key for concurrent legitimate renewals | same |
| Session list/revoke | `GET /api/v1/auth/sessions`, `DELETE /api/v1/auth/sessions?id=…` / `?all=true` set `refresh_tokens.revoked_at`; an already-issued access token stays valid until it expires | `server/api/v1/auth/sessions/*` |
| Signing | RS256 when `AUTH_JWT_PRIVATE_KEY` is configured, legacy HS256 fallback; `GET /api/v1/auth/jwks` publishes the public keys | `jwt.ts`; both targets answered a non-empty RSA JWKS |
| Health | Local `:4000` and live deployment both report `1.1.0` and `db: ok` | `GET /api/v1/health` |

Consequences that bind the CMS implementation:

- Tenant binding stays a deployment/app-registry property (`TM_TENANT_ID`). Hub never claims a tenant, so the CMS must not expect one and must not infer tenant membership from a token.
- Revocation is only observable at refresh. `/auth/me` and introspection cannot report a revoked session; see §3.3 for the accepted window.
- Legitimate concurrent refreshes from two CMS instances can revoke the whole user session; see §3.4 for the accepted mitigation.

## 1.3. TM Platform — packages currently present

Current repository README and package manifests list:

| Package | Current responsibility | Reuse decision |
|---|---|---|
| `@tuanmjnh/tm-types` | TypeScript API/docs/AI contracts and primitives | Reuse; add product/content domain contracts only when agreed |
| `@tuanmjnh/tm-validators` | Zod API/AI validation schemas | Reuse after resolving Zod major mismatch |
| `@tuanmjnh/tm-utils` | Framework-neutral helpers | Reuse |
| `@tuanmjnh/tm-core` | Pure shared JS/TS helpers | Reuse |
| `@tuanmjnh/tm-ai-client` | Provider-agnostic AI client, streaming, model discovery | Keep available, but AI Workspace UI remains out of scope |
| `@tuanmjnh/tm-hub-client` | Hub Control Plane SDK | Reuse as official Hub integration client |
| `@tuanmjnh/tm-mongo` | MongoDB connection pooling/manager; Mongoose injected by host | Reuse for connection lifecycle, not as domain models/repositories |
| `@tuanmjnh/tm-ui` | Precompiled Vue/Nuxt UI components and stylesheet | Reuse selectively after SSR compatibility fix |
| `@tuanmjnh/tm-cut-core` | TMCut core | Not relevant to CMS/Web |

The README says `tm-nuxt` is planned, not currently published as a Nuxt Layer package. The repository does not yet list CMS/Web-specific Product/Content/Inventory/Finance domain packages or the planned `@tm/nuxt-layer-*` packages.

## 1.4. Important package compatibility findings

### Zod major mismatch

- `tm-hub/package.json` currently declares `zod: ^4.4.3`.
- `tm-platform/packages/tm-validators/package.json` currently declares `zod: ^3.24.1`.
- The current validator package exposes Zod 3 types such as `z.ZodTypeAny`.

**Required decision:** Standardize new TM CMS/Web domain contracts on Zod 4 to match the current Hub stack. Update `@tuanmjnh/tm-validators` with a compatible package release and migration notes before using its schemas as a shared source of truth. Do not quietly install Zod 3 and Zod 4 and assume their schema types are interchangeable.

### `tm-mongo` is not a shared domain model package

`@tuanmjnh/tm-mongo` is a connection manager. It can be reused by CMS and Web to manage pools, but it does not provide Product Mongoose models, domain invariants, admin query services, storefront queries, migrations or repository implementations.

Do not duplicate connection pooling inside a future `flow-server` package. If shared server-side domain models are still needed, keep them in a separate server-only package with a narrow boundary; do not put CMS/Web-specific query implementations into it.

### `tm-ui` is not yet ready for SSR adoption

The `tm-ui` README describes a generated `tm-ui-globals.client.ts.txt` plugin and states that a client-only plugin is sufficient because the existing consuming apps are SPA (`ssr: false`). `tm-web` is SSR.

**Required before using `tm-ui` in tm-web:** generate/register the Nuxt UI primitives for both server and client (or switch to a Nuxt module/source-compilation strategy that works in SSR), then add real SSR render + hydration tests. A `.client`-only registration must not be copied into `tm-web` and treated as sufficient.

### Package version mismatch

- `tm-platform` source manifest currently shows `@tuanmjnh/tm-ui` version `0.2.0`.
- `tm-hub/package.json` currently declares `@tuanmjnh/tm-ui: ^0.1.4`.
- The latest Hub commit specifically adds `UFormField` to the generated globals registry.

The Git source manifest is not proof that `0.2.0` is already published to npm. Confirm registry version from an authenticated/local `npm view` command before changing consumers. Do not publish without the owner's NPM OTP/approval.

---

# 2. Product scope decisions

## 2.1. Orders / Inventory / Finance / Reports

**Decision: OUT OF SCOPE for current V2.**

Current V2 remains focused on:

- CMS administration foundation.
- Product/catalog and content management needed by storefront.
- Public storefront SSR/SEO and public data projection, except the items explicitly deferred below.
- Tenant/branding/application configuration foundations.

Do not start full modules for:

- Orders and checkout lifecycle.
- Inventory ledger, stock reservation or stock costing.
- Finance posting, receivables/payables or accounting ledger.
- ERP reports built on those modules.

A basic catalog field must not be expanded into an inventory ledger. Do not model financial posting or stock movements without a separately approved domain design.

### CAT-02 serial/IMEI

Keep CAT-02 serial/IMEI tracking **BLOCKED**. It depends on a real inventory/serialized-asset domain. Do not add serial/IMEI records, uniqueness rules or stock allocation semantics to catalog items in this release.

## 2.2. AI Workspace

**Decision: OUT OF SCOPE for V2.**

Keep only integration readiness:

- Preserve `@tuanmjnh/tm-ai-client` compatibility.
- Preserve the Hub's provider/model/grant control plane.
- Do not build AI Workspace pages, agent orchestration, prompt studio or website chat UI as part of this queue.
- Do not remove working Hub AI APIs or package support as collateral cleanup.

## 2.3. Storefront authentication / Web BFF

**Decision: no public customer login/account flow in current V2.**

- `tm-cms` owns human login and authenticated admin sessions through TM Hub.
- `tm-web` remains anonymous/public.
- Do not add `/login`, `/register`, `/account`, `/profile`, customer session, password reset or user BFF handlers to tm-web in this release.
- `tm-web` SSR may use server-only application identity to request approved public data. This is service-to-service authentication, not a public user session.
- Never put `X-App-Secret`, device secret, Hub token or database credentials in browser bundles or `runtimeConfig.public`.

If a customer portal is needed later, create a separately approved scope with a complete user/session/tenant/CSRF design.

---

# 3. Security decisions

## 3.1. CSRF policy for cookie-authenticated CMS BFF

**Decision: strict browser validation plus double-submit CSRF.**

For state-changing browser requests (`POST`, `PUT`, `PATCH`, `DELETE`):

1. If `Origin` is present, require an exact normalized match against the configured allowlist for that deployment. Do not use suffix or substring matching.
2. If `Sec-Fetch-Site` is present, reject `cross-site`. Permit only an explicitly documented same-origin/same-site policy; do not infer trust from missing headers.
3. Require a valid double-submit CSRF token bound to the browser session (or an equivalent cryptographically bound token). The cookie carrying the session remains `HttpOnly`; the CSRF token is separately readable by the client as designed.
4. If **both** `Origin` and `Sec-Fetch-Site` are absent on a browser-cookie-authenticated state-changing request, reject by default.
5. Safe methods (`GET`, `HEAD`, `OPTIONS`) must not mutate state. Do not use GET for logout, publish, delete or other mutations.
6. Trusted server-to-server routes may use a separate explicit authentication mode (App/Device credential, mTLS or equivalent) and must not accept ambient browser cookies as a substitute. Do not create a broad “missing Origin means trusted” exception.

Test matrix must cover missing headers, cross-origin Origin, `Sec-Fetch-Site: cross-site`, missing/invalid CSRF token, same-origin valid CSRF, and trusted server-to-server calls.

## 3.2. Hub proxy allowlist

**Decision: deny-by-default, explicit method + path allowlist. No broad passthrough.**

- Build a route inventory from actual CMS server handlers and `@tuanmjnh/tm-hub-client` methods.
- Allow only the methods and paths CMS actually needs.
- Do not forward arbitrary path segments, arbitrary methods, or user-supplied Hub base URLs.
- Do not expose Hub `/api/v1/auth/**` directly through a generic browser proxy.
- CMS login/logout/refresh BFF handlers may call the Hub server-to-server through dedicated functions; they are not generic pass-through routes.
- Web SSR public data access uses a separate restricted service route and identity.
- Keep credentials server-only and strip hop-by-hop/untrusted headers before forwarding.
- Return normalized, non-sensitive errors; never return Hub secrets or raw upstream stack traces.

**Status:** NOT_YET_VERIFIED. Source review is complete (today the proxy denies only `/api/v1/auth*`, `tm-shared/packages/flow-utils/src/hub.ts`), but no authenticated session or installed test app was available. Run the §3.7.2 rows 6–7 on both local and live Hub before marking this VERIFIED; do not infer runtime behavior from source alone.

## 3.3. Access-token revoke contract — verified Hub status

Verified in source and at runtime (§1.2.1):

- `POST /api/v1/auth/introspect` calls `verifyAccessToken()` and returns the JWT claims. It does not query `refresh_tokens`, so it cannot report a revoked session.
- `issueSession()` / the refresh path sign claims without `sid`/`sessionId` and without `tenantId`.
- Session list/revoke endpoints update `refresh_tokens.revoked_at`. That blocks the next refresh but not an access token already in a cookie.

**Decision for this workspace:** treat this as an accepted Hub contract, not as a CMS blocker.

- Record `ACCESS_TOKEN_REVOCATION = NOT_IMMEDIATE`, with the revocation window equal to the access-token lifetime (`AUTH_ACCESS_TOKEN_EXPIRY`, default `15m`).
- The CMS must not poll introspection to chase revocation: it would return valid for a revoked session and add load without changing the outcome.
- Sensitive operations cannot rely on "revoked means rejected within seconds". Where immediacy matters later, the Hub change is the fix (`sid` + session-aware introspection); that change belongs to `tm-hub`, outside this workspace.
- Do not copy Hub access tokens into browser-readable state or logs while this window exists.

**Status:** VERIFIED (read-only) for the Hub behavior; `NOT_IMMEDIATE` is the recorded CMS-side contract.

## 3.4. Cross-instance refresh coordination

**Verified Hub behavior:** the rotation is a single-winner atomic claim and a replayed rotated token revokes every active session for that user + app (§1.2.1). There is no grace window and no rotation-family/idempotency endpoint.

**Decision for this workspace: accept the process-local singleflight and record the limit.**

What the CMS does today (`tm-cms/server/utils/refreshCoordinator.ts`): one in-flight renewal per refresh token inside a process, shared by `/auth/refresh`, the Hub proxy and `requireVerifiedContext`; a failed renewal is not cached, so the next request may retry. `scripts/build/test-refresh-coordinator.ts` pins the sharing, cleanup and retry behavior.

Why a CMS-side fix cannot close this:

- Two CMS instances behind a load balancer can both hold the same refresh cookie. A lock in the CMS Mongo database would only serialise them; the instance that loses still has no new token to send, so its user sees a sign-out.
- The authoritative rotation state is the Hub's `refresh_tokens` row. Only the Hub can accept a second legitimate renewal inside a bounded window, and only the Hub can return the already-rotated token to the loser.
- Redis is out of scope by §0.1.6 and would not supply the missing rotation state either.

**Accepted risk:** `refresh_coordination = process_local`, documented. A concurrent renewal from two instances can end the session. Do not weaken reuse detection in the CMS, do not log refresh tokens, and do not retry a failed refresh with an already-used token. The Hub-side grace/idempotency contract is a follow-up in `tm-hub` (outside this workspace); when it lands, the coordinator can be relaxed to use that response instead of failing.

## 3.5. Tenant API hardening findings in current Hub

The following concrete issues were observed in the current source and must be addressed before treating Tenant management as production-verified:

### A. Tenant API scope is not explicit enough

`server/api/v1/tenants/[tenantId]/apps.get.ts`, `tenants/[tenantId]/index.ts` and `tenants/[tenantId]/sites/index.ts` require a capability, but the handler does not visibly verify that the caller is the platform/system administrator or an authorized member of the target tenant. A route parameter must not be sufficient to choose another tenant.

Required:

- Platform tenant administration endpoints must require the intended TM Hub system/platform authorization.
- For any tenant-scoped role, derive tenant from trusted app/session context and verify membership/ownership; do not trust `tenantId` from the URL alone.
- Test a user authorized for Tenant A attempting to read/update/delete Tenant B.

### B. `listTenantApps()` returns raw app rows

`server/modules/tenants/service.ts` uses `.select('*')` and returns the rows directly. The App Registry contains a `secret_key` field. The general `/apps` list masks the secret for non-root users, but the tenant app listing currently does not apply an equivalent safe DTO.

Required:

- Return an explicit `TenantAppSummary` DTO.
- Never return `secret_key` or other server credentials from this endpoint.
- Keep secret rotation/reveal as a separate root-only action with audit logging.
- Add regression test asserting the response does not contain `secret_key`, app secret, database URI or device secret.

### C. Tenant deletion is physical and cascades

`deleteTenant()` executes a database delete. Migration foreign keys include cascading behavior for related `sites`, `media_resources`, and `app_configs`; app rows use `ON DELETE SET NULL` for `tenant_id`.

Required:

- Normal tenant lifecycle should use `status: archived` or `suspended`, not physical delete.
- Remove/hide hard-delete from ordinary Tenant UI/API, or make it a separate root-only destructive operation with explicit confirmation, impact preview, backup and audit.
- Do not let tenant deletion orphan apps or silently cascade customer resources.

### D. Database binding defaults to `configured`

The migration's `database_binding` default and `createTenant()` fallback currently use a configured status even when no Mongo connection/URI/database has been verified.

Required:

- New tenant defaults to `status: missing` / `unconfigured` unless an operator explicitly records and verifies a real binding.
- `configured` must mean a successful server-side connection/health check, not merely that a tenant row was created.
- Never store or return raw Mongo connection strings in the Tenant record/API.
- Health checks may return only safe status (`configured`, `unconfigured`, `unavailable`) with no URI, secret, cluster credential or internal path.

### E. App installation validation

`POST /api/v1/apps` currently accepts `tenantId`, `appCode`, `appKind` and `siteIds` as optional fields.

Required:

- For customer app types `tm-cms` and `tm-web`, require a valid active `tenantId` and correct `appCode`/`appKind` combination.
- Validate the referenced tenant exists and is not suspended/archived.
- Enforce per-installation unique `appId` and exact allowed origins in production; disallow wildcard origins for customer production apps.
- Resolve tenant from the registered app on server-side requests. Never trust a caller-supplied tenant ID as the authority.

### F. RLS posture

The current `supabase/policies.sql` includes permissive `USING (true) WITH CHECK (true)` policies for `anon` and `authenticated` on central Hub tables, including tenants/sites. The Hub README prefers using the Supabase `service_role` secret only from the server.

Required:

- Production Hub must use server-only service-role credentials; never expose them to browser or packages.
- Do not use the permissive anon/authenticated policies as a fallback for a public client.
- Confirm no public/browser Supabase client can read/write private Tenant, App Registry, credentials, session, config or media records.
- Verify this with an anon-key security test and a production configuration check.

## 3.6. Tenant claim and app context

`AuthPayload` and `issueSession()` include `appId` but not `tenantId` (re-verified 2026-11-18, §1.2.1); Hub App Registry has `tenant_id` on the App row.

**Current CMS contract (in force):** the deployment is the tenant. `TM_TENANT_ID` comes from config, `mapHubUser()` stamps it on the session, and the CMS keeps rejecting a session whose `appId` differs from `TM_HUB_APP_ID`. The CMS never reads a tenant claim and never trusts one from a request body.

**Hub-side follow-up (deferred, `tm-hub` only):** derive a stable `tenantId` claim from the registered App row, return it from introspection, and let receiving apps compare it with their configured customer. The system `tm-hub` app remains platform-scoped and may legitimately have no customer tenant. Until that lands, do not add a fallback that guesses a tenant from email, host or roles.

---

## 3.7. Verification runbook — local and live Hub

Both targets expose the same routes, so every check runs twice and records its base URL. Do not mark a check VERIFIED from one target alone.

| Target | Base URL | Status 2026-11-18 | Notes |
|---|---|---|---|
| Local Hub | `http://localhost:4000` | healthy, `1.1.0`, `db: ok` | `cd D:\Applications\tm-hub && pnpm dev`. Requires its own `.env` (Supabase). Mail/import queues log `Redis unavailable` and stay disabled; auth is unaffected. |
| Live Hub | `https://tm-hub-app.vercel.app` | healthy, `1.1.0`, `db: ok`, RS256 JWKS | Holds real data. Never create/delete tenants or revoke sessions here without explicit permission. |
| Local CMS | `http://localhost:4005` | `pnpm dev:cms` | Needs `TM_HUB_URL`, `TM_HUB_APP_ID`, `TM_HUB_SECRET`, `TM_TENANT_ID`, and `TM_AUTH_MODE` unset or `hub`. |

**A stale Hub dev server answers `500 … renderer.mjs ENOENT` on every route** after its `node_modules` changes. That is a dead process, not a Hub defect: stop it and start `pnpm dev` again before recording any result.

### 3.7.1. Unauthenticated probes (safe on both targets)

```bash
pnpm hub:check --url=http://localhost:4000
pnpm hub:check --url=https://tm-hub-app.vercel.app
```

Expected, and observed on both targets on 2026-11-18 (8/8):

| Probe | Expected |
|---|---|
| `GET /api/health` | 200, `success: true` |
| `GET /api/v1/health` | 200, `status: healthy`, `db: ok` |
| `GET /api/v1/auth/jwks` | 200, non-empty `keys` |
| `POST /api/v1/auth/introspect` (no token) | 400 `error.missingToken` |
| `POST /api/v1/auth/refresh` (`{}`) | 400 `error.missingRefreshToken` |
| `GET /api/v1/auth/me` | 401 |
| `GET /api/v1/auth/sessions` | 401 |
| `GET /api/v1/tenants` | 401 |

### 3.7.2. Authenticated checks (need a test account + app installation)

Prerequisites, none of which may be invented: a Hub app installation for the customer (`app_*_cms`), a role granting at least one CMS capability, and a test user whose password is supplied through the owner's secret channel. Put them in the ignored local env: `TM_HUB_URL`, `TM_HUB_APP_ID`, `TM_HUB_SECRET`, `TM_TENANT_ID`.

| # | Check | How | Pass criteria |
|---|---|---|---|
| 1 | Login | `POST /api/auth/login` on the CMS with the test credentials | 200, `appId` matches the installation, no token in the response body |
| 2 | Session read | `GET /api/auth/session` with the cookies | 200, same user/app |
| 3 | CSRF: missing headers | same `POST` without `Origin` and without `Sec-Fetch-Site` | 403 `CSRF_REJECTED` (target policy, §3.1) |
| 4 | CSRF: cross-origin | `Origin: https://evil.test` | 403 `CSRF_ORIGIN_MISMATCH` |
| 5 | CSRF: double submit | mutation with the CSRF cookie but no `X-CSRF-Token` (and the reverse) | 403; with both matching, 2xx |
| 6 | Proxy allowlist | a Hub path/method outside the allowlist through `/api/hub/**` | 403, no upstream call |
| 7 | Auth paths closed | `/api/hub/api/v1/auth/refresh`, `/api/hub/api/v1/auth/sessions` | 403 `PROXY_PATH_FORBIDDEN` |
| 8 | Refresh | expire/delete the access cookie, then call a private route | exactly one rotation, new cookies, no sign-out; the old refresh token is now rejected |
| 9 | Revoke | revoke the session from Hub (`DELETE /api/v1/auth/sessions?all=true`) as that user | the next refresh is 401 `SESSION_EXPIRED`; the still-valid access token is accepted until `exp` (record the elapsed time) |
| 10 | Reuse | replay the previous refresh token | 401, and every session for that user/app is revoked (this is Hub behavior, not a CMS bug) |
| 11 | Cross-instance refresh | two CMS processes sharing the cookie jar, refresh both at once | document the observed outcome; §3.4 predicts one success and one sign-out until the Hub grace contract exists |

Record per row: target (local/live), timestamp, Hub version from `/api/v1/health`, HTTP status, error code, and whether the row is VERIFIED, FAILED or BLOCKED (missing account/installation). Rows 3–7 are the ones that can be completed without a live Hub session once the CMS changes land; rows 1, 2, 8–11 need the test account.

---

# 4. Media, cache purge, imports and background jobs

## 4.1. Public media origin

**Decision: OUT OF SCOPE for current V2.**

- Do not build public media projection, public media listing, logo URL projection or OG image support as part of this queue.
- Do not proxy public images through CMS.
- Do not treat local disk upload as a production media origin.
- Keep current local/dev media behavior for development only.

When reopened, default choice is the existing **TM Hub Cloudinary Media Gateway** for public image CDN/transform needs, after credentials are provided. The Hub's Storage Gateway (R2/S3/Supabase) is a separate object-storage product and is more appropriate for private/general files; do not conflate it with Cloudinary Media Gateway.

### Important Hub implementation note

The tenant migration adds `tenant_id`, `visibility` and `site_ids` columns to `media_resources`, but the inspected Cloudinary media endpoints still call `getCloudinaryForApp(appId)` and perform app-scoped Cloudinary listing/signature operations. The existence of those columns does not prove cross-app tenant media sharing is implemented.

When public media is brought back into scope, design and test the full path: CMS upload → tenant-owned media reference → visibility approval → Web public projection/download → tenant/site isolation. Do not assume the migration alone enables sharing.

## 4.2. CDN/provider purge

**Decision: no external CDN provider adapter in this release.**

Keep the existing internal storefront purge endpoint only, provided it is hardened before production:

- Require a high-entropy server-only secret or HMAC signature.
- Prefer timestamp + nonce/replay protection for signed requests.
- Verify tenant/site ownership at the receiver.
- Scope purge to approved site/tag/path identifiers; do not accept arbitrary URLs or cross-tenant purge targets.
- Use constant-time secret/signature comparison.
- Rate-limit and audit purge requests without logging secrets.
- Reject unsigned or malformed requests.

This is an internal app/cache purge contract, not a Cloudflare/Vercel/Cloudinary cache purge integration. External CDN invalidation remains deferred.

## 4.3. OPS-01 import/export

**Decision: bulk customer import/export and associated jobs are OUT OF SCOPE for V2.**

- Do not export legacy Hub content/config/media data.
- Do not import Hub legacy records into customer MongoDB.
- Do not create fake legacy snapshots or invented customer fixtures.
- Do not build a background import/export queue in this phase.
- Existing TM Hub import/export features remain Hub-scoped and must not be repurposed as a customer MongoDB migration mechanism.
- If a small synchronous export already exists and is used, keep it bounded, permission-checked and tenant-scoped; do not expand it into a general import/export product without a separate decision.

## 4.4. Durable events / queue / cron

**Decision: DEFERRED.**

- No Redis requirement for this release.
- No BullMQ worker activation for CMS/Web.
- No durable outbox/event bus implementation in this queue.
- No scheduled publish, automatic retention prune or periodic invalidation.
- Publish/prune remains a manual operator action.
- Existing internal purge endpoint may be invoked synchronously by an explicit save/publish handler after its security scope is fixed.

Do not claim scheduled publish or durable delivery guarantees until an approved worker/scheduler deployment exists and has integration tests.

---

# 5. URL and SEO decision

**Decision: retain current `no_prefix` locale URL behavior for V2.**

- Do not migrate to `/vi/...` and `/en/...` in this release.
- Do not claim complete hreflang coverage.
- Do not generate a sitemap pretending to have locale-prefixed equivalents.
- Keep canonical behavior consistent with the current selected locale and current route model.
- Document that `hreflang` and locale-prefixed URLs are deferred SEO work.

The previous provisional recommendation to add locale prefixes is superseded by the owner's latest explicit scope list dated 2026-11-18.

---

# 6. Credentials and owner-provided dependencies

No credential value is present in the supplied conversation or the inspected GitHub source. The agent must not invent any of them.

| Item | Current decision/status | Required handling |
|---|---|---|
| Production `TM_MONGO_URI` | NOT PROVIDED | Local Mongo only. Configure production URI as a server-only Vercel environment secret when available. Do not paste it into Git or docs. |
| Cloudinary credentials | NOT PROVIDED | Keep production upload/public media blocked. Add credentials only to Hub's secret connection workflow/environment. |
| Vercel token | NOT PROVIDED | No deployment. Do not attempt `vercel deploy`. |
| Customer domains | NOT PROVIDED | Do not configure production domains or mark Sites verified. |
| Legacy snapshot | NOT PROVIDED / NOT AUTHORIZED | No migration, no fabricated legacy fixture. |
| NPM OTP for `tm-ui` | NOT PROVIDED | Do not publish. Keep local `link:`/local development or use an already-published, verified version. |
| Live Hub reachability | AVAILABLE: live `1.1.0` + local `:4000` healthy, 8/8 contract probes | Safe unauthenticated probes only; do not mutate tenant/session data on the live deployment. |
| Hub test account / app installation | NOT PROVIDED | Login, revoke, refresh and proxy-allowlist checks stay BLOCKED until an owner-supplied test user and installed app exist (§3.7.2). Never invent credentials. |
| Production authorization | NOT PROVIDED | P10 launch/migration remains BLOCKED. |

## 6.1. Local MongoDB

The owner-provided environment notes say local MongoDB 8.2.3 is running at `127.0.0.1:27017`, and `sen-tuan` health had previously passed. This audit did not connect to that machine and cannot re-confirm the current process.

Use local-only values in ignored `.env.local` files. Production values belong in the corresponding Vercel Project's server-side Environment Variables, never in Customer Layers, public runtime config or committed files.

## 6.2. Customer database names

Keep existing legacy names unchanged:

- `sentuan` → `sen-tuan`
- `bagpost` → `bag-post`

New customer names may use the approved registry mapping:

- `default` → `tm_default`
- `thanhtung` → `tm_thanh_tung`
- `hoangvi` → `tm_hoang_vi`

However, these names do not mean the database exists or is configured. Keep tenant database binding `missing/unconfigured` until an actual connection check succeeds.

---

# 7. NPM package adoption and publication decisions

## 7.1. Packages to reuse now

Use the following existing packages where their runtime boundary fits:

- `@tuanmjnh/tm-types`
- `@tuanmjnh/tm-utils`
- `@tuanmjnh/tm-core`
- `@tuanmjnh/tm-hub-client`
- `@tuanmjnh/tm-mongo`
- `@tuanmjnh/tm-ai-client` only if an already-in-scope Hub AI integration requires it
- `@tuanmjnh/tm-ui` only after SSR plugin compatibility is resolved for tm-web

Do not create duplicate connection managers or generic utility packages inside CMS/Web.

## 7.2. Packages still needed for the CMS/Web domain

The current `tm-platform` README does not show complete flow-specific schemas/models for:

- Product and ProductVariant.
- Category and Attribute.
- Content/Article/Menu/Site settings.
- Customer branding and feature configuration.
- Public/admin DTO projections.

Create these only as domain packages when the actual consuming contract is defined. Keep admin and public DTOs separate. Do not publish database credentials, private query implementations or customer-specific business logic.

## 7.3. Zod standardization

**Owner decision (2026-11-18):** `tm-validators` will be upgraded to Zod **4.6.7** on the platform side. No Zod change is made in this workspace, and CMS/Web keep their current `zod` pin until that release exists.

When the upgraded package is published, the adoption checks are:

1. Consumer typecheck proves a single Zod major in the tree (no Zod 3 + Zod 4 mix).
2. Public `z.infer`/input/output types are emitted correctly in ESM/CJS declarations.
3. The package is exercised in both the Nuxt SPA CMS and the SSR storefront before its schemas become a shared source of truth.

## 7.4. `tm-ui` release

**Owner decision (2026-11-18):** SSR-safe registration is deferred. There is no publish, no version bump and no adoption into `tm-cms`/`tm-web` in this release.

Do not add a client-only `tm-ui` globals plugin to the SSR storefront in the meantime. When the SSR work is scheduled, the release still requires: server+client registration for SSR consumers, a real SSR render/hydration test in `tm-web`, existing consumers green after the pin update, an automated registry path instead of hand edits, and the owner's npm OTP/approval. Confirm the published version with `npm view @tuanmjnh/tm-ui version` before changing any consumer; a GitHub manifest version is not proof of publication.

---

# 8. Implementation queue

## P0 — Hub/Tenant security (all items live in `tm-hub`, outside this workspace)

Re-verified in source on 2026-11-18. None of these is editable from `tm-websites`; they are listed so the CMS side does not silently compensate for them.

| # | Finding | Status |
|---|---|---|
| 1 | Tenant/site/app endpoints require only the `tenants.read` / `tenants.create` capability, not an explicit tenant-membership scope | OPEN (Hub) |
| 2 | `listTenantApps()` returns raw `apps` rows (`select('*')`), including credential columns | OPEN (Hub) |
| 3 | Tenant deletion is physical (`delete()`); there is no archive/soft-delete endpoint | OPEN (Hub) |
| 4 | New tenants default `database_binding.status` to `configured`, not `missing`/`unconfigured` | OPEN (Hub) |
| 5 | App installation `tenantId`/`appCode`/`appKind` and production allowed origins are not validated | OPEN (Hub) |
| 6 | Supabase service-role scope was not re-audited in this revision | NOT RE-AUDITED |
| 7 | No Tenant A vs Tenant B isolation test exists in `tm-hub/tests` | OPEN (Hub) |

## P1 — Auth/BFF correctness

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | `sid`/session ID in access tokens, tied to the refresh row | `tm-hub` | DEFERRED — verified absent (§1.2.1) |
| 2 | Session-aware introspection (revoked/app/tenant) | `tm-hub` | DEFERRED — verified absent; accepted window in §3.3 |
| 3 | Tenant claim derived from the registered App | `tm-hub` | DEFERRED — no tenant claim exists; CMS keeps `TM_TENANT_ID` (§3.6 still applies) |
| 4 | Refresh grace/idempotency for multi-instance renewals | `tm-hub` | DEFERRED — accepted risk + process-local singleflight (§3.4) |
| 5 | Explicit method/path Hub proxy allowlist | `tm-cms` | OPEN — today only `/api/v1/auth*` is denied (`flow-utils/src/hub.ts`), every other `/api/v1` path/method is forwarded |
| 6 | Strict CSRF from §3.1 | `tm-cms` | OPEN — `csrf.ts` checks Origin/`Sec-Fetch-Site`, allows requests with neither header, and has no double-submit token |
| 7 | Exercise proxy/CSRF/revoke/refresh | `tm-cms` | READY TO RUN — runbook §3.7; needs the owner test account for the authenticated rows |

## P2 — Shared packages and CMS/Web integration readiness

1. Reuse `tm-mongo` connection manager with production fail-closed wrapper in each server runtime.
2. Resolve Zod 3/4 mismatch in `tm-validators`.
3. Design only the Product/Content/Branding contracts currently required by CMS/Web.
4. Keep admin API query and public storefront query services separate.
5. Fix `tm-ui` universal SSR registration before using it in tm-web.
6. Do not create a broad mega `flow-server` package. If shared Mongoose models/invariants are proven to be used by both server applications, create a narrow server-only package and keep query services app-local.

## P3 — Existing in-scope product slices

Continue only the current approved CMS/catalog/content and storefront slices. Do not silently add Orders, Inventory, Finance, Reports, Checkout, Contact Forms, Newsletter, public media projection or locale-prefix work.

## P10 — Migration/launch

Remain BLOCKED until all are true:

- Owner provides a real legacy snapshot and explicit permission to read it.
- Owner authorizes the exact production migration window and rollback plan.
- Production Mongo URI and app credentials are configured through secret channels.
- Cloudinary/public media credentials are supplied if media is brought back into scope.
- Vercel token and customer domain ownership are supplied if deployment is requested.
- Backup and restore verification completed.
- Data isolation and tenant/app access tests pass against production-like infrastructure.

---

# 9. Acceptance criteria

The agent must not mark a phase Verified based only on typecheck or a passing build.

## Tenant and data isolation

- A CMS app bound to Tenant A cannot read Tenant B metadata/apps/sites/media/config.
- A Web app bound to Tenant A cannot read Tenant B public projection.
- App secret and database credentials never appear in tenant list/detail responses.
- Tenant archive does not physically delete apps, configs, sites or customer data.
- Missing/unverified database binding produces a safe unconfigured health result and fails closed for production business routes.

## Authentication

- Revoking a session makes the next refresh fail with `SESSION_EXPIRED`; an access token stays accepted until it expires, and the observed delay is recorded against the access-token TTL (§3.3).
- A session whose `appId` differs from the deployment's Hub app is rejected (`APP_MISMATCH`). Tenant identity is deployment config; Hub claims none, so there is no token `tenantId` to mismatch (§1.2.1, §3.6).
- Parallel refresh requests from two independent app instances are a documented accepted risk: one wins, the other signs the user out (§3.4). Do not claim this row PASS without the row-11 record from §3.7.2.
- Reuse of a rotated refresh token still triggers Hub's documented revoke-all response.

## Proxy and CSRF

- Unknown Hub route/method combinations are rejected.
- Browser mutations with missing Origin and missing Fetch Metadata are rejected unless they use an explicitly approved non-cookie server-to-server authentication mode.
- Same-origin mutation with valid double-submit token succeeds.
- Cross-site mutation fails.
- Hub app/device credentials never appear in browser network payloads or logs.

## Packages

- Zod version alignment is verified by consumer typecheck and runtime validation.
- `tm-ui` components render correctly in CMS SPA and Web SSR.
- SSR HTML contains the expected rendered Nuxt UI primitives; hydration produces no unresolved `u-*` custom elements or hydration warnings.
- `tm-mongo` manager is tested with connection success, unavailable DB, missing URI, URI/database change and shutdown.

## Deferred scope guard

- No checkout/order flow added.
- No HR/Finance/Inventory ERP module added.
- No serial/IMEI domain added.
- No AI Workspace UI added.
- No public media projection or OG image implementation added.
- No locale prefix/hreflang implementation added.
- No durable cron/queue activation added.
- No legacy migration/import/export run.
- No production deployment performed.

---

# 10. Required agent report format

After each task/slice, report:

1. **Scope:** exact task and files changed.
2. **Evidence:** source paths and behavior observed before the change.
3. **Implementation:** contracts, routes, schema/migration and compatibility behavior.
4. **Security:** tenant/app/session boundaries checked.
5. **Tests:** commands and actual results; distinguish unit, integration and live Hub tests.
6. **Blocked items:** exact credential/owner input required; never invent values.
7. **Rollback:** migration rollback/compatibility plan where relevant.
8. **Queue:** RESOLVED / IN PROGRESS / BLOCKED for each ID.

The agent must not ask again for decisions already marked RESOLVED in this document. It must not silently reinterpret deferred scope as approved work.

---

# 11. Decision log — concise machine-readable summary

```yaml
product_scope:
  cms_admin: in_scope
  storefront_public_ssr: in_scope
  orders: out_of_scope
  inventory: out_of_scope
  finance: out_of_scope
  reports: out_of_scope
  catalog_serial_imei: blocked
  ai_workspace: out_of_scope

storefront:
  public_auth: false
  customer_account_portal: false
  cms_auth_via_tm_hub: true
  web_ssr_service_identity: true

security:
  csrf:
    decision: strict_origin_sec_fetch_site_double_submit
    origin_allowlist: required
    sec_fetch_site: reject_cross_site
    double_submit: required_for_cookie_mutations
    missing_origin_and_fetch_metadata: reject_browser_mutations
    server_to_server_exception: explicit_credential_only
    implementation_status: open_in_tm_cms
  hub_proxy:
    decision: deny_by_default_allowlist
    current_state: only_api_v1_auth_denied
    implementation_status: open_in_tm_cms
  access_token_revocation: not_immediate_within_access_token_ttl
  access_token_claims: no_sid_no_tenant_id
  hub_introspection_checks_session: false
  refresh_rotation: atomic_claim_single_winner
  refresh_reuse_response: revoke_all_user_app_sessions
  refresh_grace_window: none
  refresh_coordination: process_local_accepted_risk
  tenant_claim_source: deployment_config_tm_tenant_id

data:
  local_mongodb: allowed
  production_mongo_uri: not_provided
  legacy_snapshot: not_provided
  legacy_import: forbidden_until_approved
  tenant_database_default: missing_unconfigured
  legacy_database_names:
    sentuan: sen-tuan
    bagpost: bag-post
  new_database_names:
    default: tm_default
    thanhtung: tm_thanh_tung
    hoangvi: tm_hoang_vi

media:
  public_projection: out_of_scope
  future_default_provider: cloudinary_via_tm_hub_media_gateway
  credentials: not_provided
  external_cdn_purge: deferred
  internal_purge: harden_secret_signature_and_tenant_site_scope

seo:
  locale_strategy: no_prefix
  hreflang: deferred

jobs:
  durable_queue: deferred
  cron_scheduler: deferred
  publish_scheduling: manual
  retention_prune: manual_dry_run_by_default

operations:
  bulk_import_export: out_of_scope
  hub_legacy_export_import: forbidden_until_approved
  production_migration: blocked
  vercel_deployment: blocked
  vercel_token: not_provided
  customer_domains: not_provided

packages:
  reuse:
    - '@tuanmjnh/tm-types'
    - '@tuanmjnh/tm-utils'
    - '@tuanmjnh/tm-core'
    - '@tuanmjnh/tm-hub-client'
    - '@tuanmjnh/tm-mongo'
  zod_standard: 4
  validators_target_zod: 4.6.7 (owner upgrade, platform side)
  validators_adoption_here: deferred
  tm_ui_ssr_ready: false
  tm_ui_adoption: deferred_by_owner
  tm_ui_publish: owner_otp_and_approval_required

hub_runtime:
  local: 'http://localhost:4000 healthy 1.1.0 db_ok'
  live: 'https://tm-hub-app.vercel.app healthy 1.1.0 db_ok'
  contract_probe: '8/8 unauthenticated checks on both'
  authenticated_session: test_account_not_provided
```

---

# 12. Source references inspected

## Local workspace (read directly, 2026-11-18)

- `tm-hub/server/modules/token/jwt.ts` — token payload, signing, refresh-token generation/hash.
- `tm-hub/server/modules/auth/service.ts` — `issueSession`, claims, refresh-row insert.
- `tm-hub/server/api/v1/auth/refresh.post.ts` — atomic claim, reuse response.
- `tm-hub/server/api/v1/auth/introspect.post.ts`, `me.get.ts` — claims-only validation.
- `tm-hub/server/api/v1/auth/sessions/index.get.ts`, `index.delete.ts` — list/revoke by `refresh_tokens.revoked_at`.
- `tm-hub/server/utils/request.ts` — `requireAuthPayload`, capability gate used by tenant routes.
- `tm-hub/server/modules/tenants/service.ts`, `server/api/v1/tenants/*` — raw app rows, hard delete, `configured` default.
- `tm-cms/server/utils/{hubClient,context,csrf,authSession,refreshCoordinator}.ts` — CMS BFF behavior quoted in §1.2.1 and §3.
- `tm-cms/server/api/hub/[...path].ts` — current proxy behavior.
- `tm-shared/packages/flow-utils/src/hub.ts` — `isHubProxyPathDenied` (only `/api/v1/auth`).
- `scripts/build/check-hub.ts` — local/live contract probe used for §3.7.1.

## TM Hub

- [README.md](https://github.com/tuanmjnh/tm-hub/blob/main/README.md)
- [Tenant upgrade addendum](https://github.com/tuanmjnh/tm-hub/blob/main/docs/TM-Hub-Tenant-App-Installation-Upgrade.md)
- [Tenant migration](https://github.com/tuanmjnh/tm-hub/blob/main/supabase/migrations/20261102000000_tenant_app_installation_upgrade.sql)
- [Tenant service](https://github.com/tuanmjnh/tm-hub/blob/main/server/modules/tenants/service.ts)
- [Tenant routes](https://github.com/tuanmjnh/tm-hub/tree/main/server/api/v1/tenants)
- [Auth introspection](https://github.com/tuanmjnh/tm-hub/blob/main/server/api/v1/auth/introspect.post.ts)
- [Auth refresh](https://github.com/tuanmjnh/tm-hub/blob/main/server/api/v1/auth/refresh.post.ts)
- [Auth session service](https://github.com/tuanmjnh/tm-hub/blob/main/server/modules/auth/service.ts)
- [RBAC capabilities](https://github.com/tuanmjnh/tm-hub/blob/main/shared/rbac.ts)
- [RLS policies](https://github.com/tuanmjnh/tm-hub/blob/main/supabase/policies.sql)

## TM Platform

- [README.md](https://github.com/tuanmjnh/tm-platform/blob/main/README.md)
- [Phase 0 audit](https://github.com/tuanmjnh/tm-platform/blob/main/docs/phase-0-audit.md)
- [Remaining phases plan](https://github.com/tuanmjnh/tm-platform/blob/main/docs/plans/2026-11-12-remaining-phases.md)
- [`tm-validators` package manifest](https://github.com/tuanmjnh/tm-platform/blob/main/packages/tm-validators/package.json)
- [`tm-mongo` README](https://github.com/tuanmjnh/tm-platform/blob/main/packages/tm-mongo/README.md)
- [`tm-ui` README](https://github.com/tuanmjnh/tm-platform/blob/main/packages/tm-ui/README.md)
- [`tm-ui` build script](https://github.com/tuanmjnh/tm-platform/blob/main/packages/tm-ui/scripts/build-sfc.mjs)

---

**End of decision and audit document.**
