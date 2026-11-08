# 03 — Hub authentication and authorization

This document separates source-observed APIs from target security requirements. No live authorization or exploit test was performed.

## Actual SDK contract

The package is [`tm-hub-client`](../../../tm-hub-client/package.json), locally version 1.0.9. It exports the root ESM/CommonJS/types entry and `package.json`; it has no packaged `/nuxt`, `/server` or `/runtime` export. Runtime entrypoints include `HubClient` and `createHubClient`.

The SDK is a transport library. It does not supply Nuxt cookies, a session store or `useAuth`. Do not copy browser bearer-token examples into this HttpOnly BFF architecture. Its automatic refresh callbacks and deduplication are per client instance, not coordinated across distributed requests. Cached permission helpers are UI conveniences, not authorization decisions.

Current websites integration uses [handwritten `$fetch`](../../tm-cms/server/utils/hubClient.ts), not the SDK. Migrate the transport behind dedicated server adapters while preserving tested BFF response contracts.

**Update 2026-11-06 (P1.a):** the CMS transport now runs on `tm-hub-client@1.0.9` behind [a per-request adapter](../../tm-cms/server/utils/hubClient.ts). Each request builds its own client, so the SDK's permission and refresh caches cannot cross users. Cookies, BFF response shapes and TOTP discrimination are unchanged. See the [current queue](../../tasks/todo.md) for evidence and the still-open items (refresh coordination, authoritative revocation, Web portal BFF).

## Source-observed Hub API

All paths in this table are under `/api/v1/auth`. See [Hub handlers](../../../tm-hub/server/api/v1/auth) and [SDK client](../../../tm-hub-client/src/client.ts).

| Method/path | Input and result | Important limit |
| --- | --- | --- |
| POST `/login` | `appId`, email, password; either tokens/user or `totpRequired` + pending challenge | Validate a discriminated result; SDK login types currently overstate token presence for TOTP |
| POST `/totp/login` | `pendingTotpToken`, code; tokens after verification | SDK `auth.verifyTotp`; not enrollment endpoint `/totp/verify` |
| POST `/refresh` | `refreshToken`, `appId`; rotating replacement tokens | Rotation/reuse detection exists; source does not repeat all active-app/membership checks |
| GET `/me` | Bearer token; user/app/roles/permissions/routes | Claims-based context, not authoritative current membership verification; SDK normalizes `userId` to `id` |
| POST `/introspect` | Inspected token as bearer; valid/reason or claims | Signature/expiry check only, not current revocation/session/tenant entitlement |
| POST `/logout` | Supplied refresh token | Revokes refresh token, not an already issued access JWT |
| GET/DELETE `/sessions` | Authenticated user/app scope | Refresh-session listing/revocation, not proof of immediate access-token invalidation |

Do not invent `/auth/verify`, JWKS, issuer/audience validation, or a service-authenticated introspection API. The [introspection handler](../../../tm-hub/server/api/v1/auth/introspect.post.ts) calls [JWT verification](../../../tm-hub/server/modules/token/jwt.ts); current source is not the authoritative verification contract required below.

## Current BFF concerns to resolve

- Dedicated auth endpoints set HttpOnly cookies, but the [generic Hub proxy](../../tm-cms/server/api/hub/%5B...path%5D.ts) permits broad `/api/v1` forwarding and returns upstream bodies unchanged. Therefore token secrecy cannot be claimed for the whole proxy surface merely because login cookies are HttpOnly.
  *Partially resolved (P1.a):* the proxy now refuses every `/api/v1/auth/**` path (`isHubProxyPathDenied`, 403 `PROXY_PATH_FORBIDDEN`), so token-issuing and session endpoints are BFF-only. Business paths remain broad and transitional until each domain migrates (P3+).
- The current user mapper inserts configured `tenantId` and accepts a returned `appId` without explicitly rejecting a mismatch. Deployment configuration is not proof of user membership.
  *Partially resolved (P1.a):* a returned `appId` that differs from the deployment app now fails closed as `APP_MISMATCH` (403), and a deployment without `TM_TENANT_ID` fails as `HUB_TENANT_UNCONFIGURED`. `tenantId` is still configuration-derived, not membership-proven.
- Hub tenant/site administration endpoints do not establish end-user tenant/site grants. SDK method presence also does not prove a corresponding Hub handler supports that operation.
- Access-token claims can remain valid after logout or role changes. Document an approved revocation/freshness policy; never imply immediate revocation from current introspection.

These are source-grounded gaps. Confirm behavior with isolated fixtures before recording a security finding or a fixed status.

## Target server-side adapter

1. Use the actual SDK only from server code; construct request-isolated client state. Never share mutable user bearer tokens in a process-global client.
2. Keep explicit BFF routes for login, TOTP login, session, refresh and logout. Identity management for users/roles/grants may use separate allowlisted IAM endpoints. Remove generic business forwarding after consumers migrate.
3. Keep access, refresh and TOTP challenge values in Secure, HttpOnly, narrowly scoped cookies; enforce production HTTPS, suitable SameSite policy and bounded lifetimes. Return only a safe user/session DTO. Never serialize tokens into SSR payloads, logs, localStorage or Pinia.
4. Enforce CSRF protection on cookie-authenticated mutations, including login/session actions as appropriate. Validate allowed origin and the selected CSRF mechanism; SameSite alone is not the complete policy.
   *Partially resolved (P1.a):* [a same-origin guard](../../tm-cms/server/utils/csrf.ts) runs on login, TOTP, refresh, logout and proxy writes, rejecting a foreign `Origin` or `Sec-Fetch-Site: cross-site`. A double-submit/ bound token and the policy for header-less clients are still open.
5. Coordinate refresh rotation across concurrent requests/tabs and deployment instances using a reviewed session strategy. Per-instance SDK deduplication is insufficient. Test refresh reuse, lost responses and expired challenges without bypassing Hub reuse detection.
6. Reject mismatched app identity; derive trusted tenant/database binding on the server. Do not accept tenant/app/database overrides from browser headers, query or body.
7. Apply route capability and resource ownership checks before every private operation, including exports, uploads, bulk actions and background jobs.
8. Fail closed for private operations when trustworthy verification is unavailable. Public published reads may continue through their independent public policy.

## Authoritative verification prerequisite

Before production private business endpoints are accepted, an approved Hub contract must establish:

- Current session/revocation status with an explicit freshness window.
- Expected app binding and active application status.
- Current app membership and normalized permission names.
- How tenant/site entitlement is derived and checked; a tenant administration list is not an end-user entitlement API.
- Logout, session revoke, role removal, disabled account/app and Hub outage behavior.

This is a **cross-repository blocker**, not an instruction to silently modify Hub or distribute its signing secret. If a constrained access-token lifetime policy is chosen instead of immediate revocation, the owner must explicitly accept and document the stale-authorization window. Current docs do not approve that relaxation.

## Identity versus business profiles

Hub owns credentials and grants. MongoDB owns Customer, Supplier and Staff business profiles and their relationship to the Hub subject identifier. A person may have several business roles; an email address is not a stable join key or authorization proof.

Legacy password hashes, refresh sessions, passkey material and local `User`/`Role` authentication implementations must not be copied into business collections. Preserve historical actor references through a reviewed mapping, without granting access to unresolved identities.

## Required regression suite

Use dummy users/apps/tenants and local Hub stubs initially. Cover success and rejection for login, TOTP, refresh rotation/concurrency, logout, CSRF, app mismatch, expired/revoked session, role removal, missing permission, cross-tenant resource ID, cross-customer database selection and portal ownership. Inspect browser network/storage and SSR payloads for token leakage. Verify generic proxy auth paths cannot return token-bearing payloads.

Implemented so far: `pnpm test:iam` covers login/TOTP discriminants, session mapping, app mismatch, tenant-binding failure, refresh rejection, proxy auth denial and the CSRF decision table with a stubbed transport. Browser-level token inspection, refresh concurrency and revoked-session behavior are NOT RUN (no authoritative Hub revocation contract).

A source-contract check or a login screenshot alone does not satisfy these gates. Actual Hub compatibility must later be verified in an explicitly authorized isolated test environment.
