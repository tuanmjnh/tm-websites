# TM Hub — Tenant & App Installation Upgrade Addendum

> **Document type:** Addendum to `TM Hub Control Plane — Architecture & Upgrade Roadmap`.
>
> **Purpose:** Close the tenant/customer grouping and app-installation gaps required by `tm-cms` (SPA) and `tm-web` (SSR) within `D:\Applications\tm-websites` (`tm-shared`, `tm-cms`, `tm-web`), while preserving the existing app-scoped IAM/RBAC design.
>
> **Target Ecosystem Integration:** `D:\Applications\tm-websites`
> - Monorepo Packages: `@tm/flow-contracts`, `@tm/flow-config`, `@tm/flow-utils`, `@tm/design-system`
> - Nuxt Base Layers: `@tm/nuxt-layer-core`, `@tm/nuxt-layer-api-base`, `@tm/nuxt-layer-config-base`, `@tm/nuxt-layer-cms-base`, `@tm/nuxt-layer-web-base`
> - Customer Layers (`packages/customer-layers/`): `sentuan`, `bag-post`, `hoang-vi`, `thanh-tung` (linked via `tenantId: tenant_<customerId>`, `cmsAppId: app_<customerId>_cms`, `webAppId: app_<customerId>_web`)
> - Satellite Apps: `d:\Applications\tm-websites\tm-cms` (SPA, port 4005) and `d:\Applications\tm-websites\tm-web` (SSR/Hybrid, port 4006)
>
> **Core decision:** One central TM Hub; a customer is a Tenant; each customer deployment is a distinct App Registry record (`appId`); CMS and Web installations of the same customer are linked by `tenantId`.
>
> **Compatibility:** Extend the existing Control Plane incrementally. Do not replace the existing Application Registry, User, Membership, Role, Permission, Route, Config, Media or Notification modules unnecessarily.
>
> **Important evidence limitation:** This specification is based on the uploaded TM Hub roadmap document and direct inspection of `D:\Applications\tm-websites`. The roadmap documents app-scoped isolation and membership, but does not explicitly define a Tenant entity linking CMS/Web installations or a tenant-owned database/site/media context. The AI agent must verify actual implementation before deciding whether each item is already complete.

---

## 0. Assessment of the current TM Hub roadmap

### 0.1. What the uploaded roadmap already establishes

The current roadmap already has a solid Control Plane foundation:

- Modular Monolith first; no premature microservices.
- Application Registry with `appId`, active/system/deletable states and allowed origins.
- A protected `tm-hub` System Application.
- User → App Membership → Role → Permission.
- Users may participate in multiple applications with different roles.
- Roles manage Permissions; routes declare required permissions; Accessible Routes are calculated.
- Backend authorization and resource ownership checks by `appId`.
- User Permission is distinct from internal service capability.
- Remote Config, Media and Notifications are app-scoped.
- `tm-hub-client` is the official consumer SDK.
- Backward compatibility with `tm-tools` and existing consumers is mandatory.
- Phase 0 audit, migrations, tests and reporting are required.

This is a good **multi-application Control Plane** baseline. In particular, app-scoped memberships and resource isolation can protect separate customer application installations when each installation has its own `appId`.

### 0.2. What is not explicit in the current roadmap

The uploaded roadmap uses `appId` as the ownership boundary, but does not explicitly define:

1. A Tenant/Customer entity that groups multiple app installations belonging to one customer.
2. A clear distinction between logical application code (`tm-cms`, `tm-web`) and a concrete deployed installation (`customer-a-cms`, `customer-a-web`).
3. A rule that a CMS installation and one or more Web installations can belong to the same `tenantId` and use the same customer business database.
4. A `siteId`/website registry for multiple public sites under one customer.
5. Tenant-level brand/config values shared between CMS and Web, with per-app/per-site overrides.
6. A media ownership/access rule that lets CMS upload/manage a customer's media while that same customer's Website can read approved public assets without crossing into another tenant.
7. A safe database binding reference per tenant, without exposing DB credentials from Hub APIs.
8. Service credentials and capability grants per concrete app installation.

### 0.3. Is the current plan already suitable?

**Yes, as the app isolation foundation. Not yet complete as the customer-pair model unless the actual implementation already has equivalent Tenant/App Installation concepts.**

There are two ways to interpret the current `App` record:

- If one `App` row represents a reusable logical product (`tm-cms`) shared by all customers, a single `appId` cannot safely represent each customer's separate app configuration/media/origin/DB access. This must be changed or supplemented.
- If one `App` row already represents a concrete deployment/installation (for example `customer-a-cms`), the existing `appId` is an appropriate unique installation identifier. Add `tenantId` and `appCode` metadata to pair customer apps.

**Recommended interpretation:** Keep each `App` Registry record as one concrete app installation. Add `appCode` for logical app type and `tenantId` for customer ownership. Do not introduce duplicate `appInstallationId` if `appId` already uniquely represents that installation.

---

# 1. Target identity and ownership model

## 1.1. Distinguish the identifiers

| Identifier | Meaning | Example (`tm-websites`) |
|---|---|---|
| `userId` | Central human identity | `usr_123` |
| `customerId` | Human-readable business customer key | `sentuan`, `bag-post`, `hoang-vi` |
| `tenantId` | Customer/organization/data owner | `tenant_sentuan`, `tenant_bag_post` |
| `appCode` | Logical application product | `tm-cms`, `tm-web`, `tm-tools`, `tm-trading` |
| `appId` | Concrete deployed application installation registered in Hub | `app_sentuan_cms`, `app_sentuan_web` |
| `siteId` | Public website/channel inside a tenant | `main`, `campaign`, `shop` |
| `resourceId` | Business/media/config/resource identity | Product, media asset, config record |

These identifiers have different jobs and must never be treated as interchangeable.

## 1.2. Customer application pairing

```text
TM Hub Control Plane (Port 4000)
│
├── Tenant: tenant_sentuan (Customer: sentuan)
│   ├── App: app_sentuan_cms
│   │   ├── appCode: tm-cms
│   │   ├── appKind: cms (Nuxt 4 SPA - Port 4005)
│   │   ├── extends: @tm/customer-layer-sentuan-cms -> @tm/nuxt-layer-cms-base
│   │   └── DB access policy: customer business DB read/write
│   │
│   └── App: app_sentuan_web
│       ├── appCode: tm-web
│       ├── appKind: web (Nuxt 4 SSR/Hybrid - Port 4006)
│       ├── extends: @tm/customer-layer-sentuan-web -> @tm/nuxt-layer-web-base
│       ├── domains: ["sentuan.vn", "www.sentuan.vn"]
│       └── DB access policy: customer business DB read-only
│
├── Tenant: tenant_bag_post (Customer: bag-post)
│   ├── App: app_bag_post_cms
│   │   ├── appCode: tm-cms
│   │   └── appKind: cms
│   └── App: app_bag_post_web
│       ├── appCode: tm-web
│       └── appKind: web
│
└── TM Hub System Application (tm-hub)
    └── platform scope; not a customer tenant
```

Tenant A's CMS and Website are separate app installations with different `appId`, allowed origins, credentials, config and capabilities, but share the same `tenantId` relationship. In `tm-websites`, each customer layer declares this mapping in `app.config.ts` validated via `@tm/flow-config` (`CustomerConfigSchema`).

## 1.3. Account/identity policy

**Default recommendation: centralized global identity + tenant/app-scoped memberships and roles.**

- `User` remains a central authentication identity managed by TM Hub.
- A user can be a member of multiple tenants.
- A user can have different roles in different customer applications.
- A user removed from Tenant A does not automatically lose access to Tenant B.
- A user in Customer A cannot access Customer B data just because both memberships share the same `userId`.
- Employee/staff profile data remains in the customer's own business database; do not confuse HR employee profile with central authentication user.

This provides SSO-like convenience without sharing customer business data or authorization. It does **not** mean every customer shares the same roles or application permissions.

Do not create duplicate User records per customer unless product requirements explicitly require separate credentials/passwords for the same email in different tenants. The uploaded roadmap does not establish that requirement. If a tenant-isolated login namespace is ever required, design it as a separate identity mode with composite uniqueness and account recovery policy; do not silently change current global identity semantics.

---

# 2. Minimal additive data model

Adapt to the actual database/ORM conventions. The following are logical schema targets, not instructions to create duplicate collections blindly.

## 2.1. Tenant

```ts
interface Tenant {
  id: string
  tenantId: string                  // stable public/business identifier
  name: string
  slug: string
  status: 'active' | 'suspended' | 'archived'
  planCode?: string
  metadata?: Record<string, unknown> // non-secret metadata only
  databaseBinding?: {
    provider: 'mongodb' | 'external'
    databaseName?: string
    clusterRef?: string
    secretRef?: string              // reference only, never raw connection string
    status: 'configured' | 'missing' | 'disabled'
  }
  createdAt: Date
  updatedAt: Date
}
```

Rules:

- `tenantId` must be unique and immutable after creation.
- `slug` must be unique under the chosen namespace.
- Tenant status is enforced server-side.
- Never return `secretRef` if it reveals infrastructure naming or access policy unnecessarily; return masked database binding status to ordinary tenant admins.
- Do not store plaintext MongoDB URI/password in ordinary Tenant document.
- If the app's deployment environment owns the DB secret, Hub may store only a safe database reference and operational metadata.

## 2.2. App Registry extension

Keep the existing `App` record and fields where possible. Add only missing fields:

```ts
interface AppInstallationExtension {
  tenantId?: string                 // required for customer application installations
  appCode?: 'tm-cms' | 'tm-web' | 'tm-tools' | string
  appKind?: 'cms' | 'web' | 'desktop' | 'mobile' | 'service' | 'other'
  environment?: 'development' | 'preview' | 'staging' | 'production'
  installationStatus?: 'provisioning' | 'active' | 'suspended' | 'retired'
  siteIds?: string[]                // optional list of sites served by this Web installation
  databaseBindingRef?: string      // reference only; no raw DB credential
  pairKey?: string                  // optional deployment grouping key; tenantId remains owner
}
```

Keep existing `type: system | application | service`, `isSystem`, `isActive`, `isDeletable`, `allowedOrigins`, secret hash/credential metadata, timestamps and current compatibility fields.

Rules:

- `tm-hub` remains `type=system`, protected, platform-scoped and not owned by a customer tenant.
- Customer `tm-cms` and `tm-web` installs are `type=application` unless actual conventions require `service` for server-to-server-only workers.
- Customer app installations must have a valid `tenantId`.
- `appId` is unique per installed deployment, not reused by all customers running the same logical app code.
- `appCode` identifies logical app product; it is not a secret or authorization proof.
- `allowedOrigins` are supplemental browser-origin controls; they are not authentication.
- Do not accept `tenantId`/`appId` from an untrusted body as the authority for a request.

## 2.3. Tenant membership

The current roadmap uses User ↔ App Membership. Preserve that model and add tenant ownership/consistency if missing.

Possible logical model:

```ts
interface TenantMembership {
  id: string
  tenantId: string
  userId: string
  status: 'invited' | 'active' | 'suspended' | 'removed'
  joinedAt?: Date
  createdAt: Date
  updatedAt: Date
}
```

A separate collection is only necessary if current `AppMembership` cannot represent tenant membership cleanly. Alternatively add `tenantId` to the existing membership record and expose derived tenant member views. Avoid duplicate membership sources of truth.

## 2.4. App membership and role assignment

Keep app-level role assignment as the effective application authorization boundary:

```ts
interface AppMembership {
  id: string
  appId: string
  tenantId: string
  userId: string
  roleIds: string[]
  status: 'active' | 'suspended' | 'removed'
  createdAt: Date
  updatedAt: Date
}
```

If current schema has direct user-role mapping, preserve it if it is correctly unique/scoped by `appId`; add `tenantId` only if needed for relationship validation and query safety.

Constraints:

- Unique active membership policy must be explicit (commonly `(appId, userId)`).
- `appId` and `tenantId` must match the referenced App installation.
- A user must be a member of the Tenant before receiving an app membership, unless an atomic invitation/join flow creates both.
- Role/Permission resources remain app-scoped as in the current roadmap.
- Do not automatically grant roles when a Tenant or App installation is created.

## 2.5. Site registry (optional but recommended for multi-site)

If a tenant may deploy more than one public site, define a lightweight Site entity:

```ts
interface Site {
  id: string
  tenantId: string
  siteId: string
  name: string
  primaryDomain: string
  allowedDomains: string[]
  defaultLocale: string
  locales: string[]
  status: 'active' | 'disabled'
  publicConfigRevision?: string
  createdAt: Date
  updatedAt: Date
}
```

Rules:

- `siteId` unique within tenant.
- Domains must be verified/allow-listed before activation.
- A Web App installation may serve one or more explicitly assigned sites.
- Website host → `tenantId`/`siteId` mapping is server-trusted.
- For a simple one-site-per-Web-deployment customer, `siteId=main` is sufficient; Site collection can be delayed if not needed.

---

# 3. User, tenant and app authorization

## 3.1. Authorization relationship

```text
User (global identity)
  └── TenantMembership
        └── AppMembership (current app installation)
              └── Roles
                    └── Permissions

App Installation
  └── Tenant owner

Route
  └── requiredPermissions (navigation calculation only)
```

This extends the current roadmap; it does not replace the rule that roles manage permissions and routes declare permission requirements.

## 3.2. Trusted Authorization Context

```ts
interface AuthorizationContext {
  userId?: string                   // absent for service/public request
  tenantId: string
  appId: string
  appCode: string
  appKind: string
  roles: string[]
  permissions: string[]
  isPlatformAdmin?: boolean
  authMode: 'user' | 'service'
}
```

Context is built from:

- Validated user session/token + app installation registration for user requests.
- Authenticated service credential for service-to-service requests.
- Trusted server-side host/config mapping for public site context.

Never read `roles`, `permissions`, `isPlatformAdmin`, `tenantId` or `appId` from a client-supplied JSON body as authorization truth.

## 3.3. Authorization order

```text
Authenticate user or service
→ Resolve trusted app installation
→ Resolve tenant owner from registered App record
→ Verify app and tenant active
→ Verify membership (for user request)
→ Resolve active roles and effective permissions
→ Check endpoint permission or service capability
→ Verify tenant/app/resource ownership
→ Execute operation
```

For public website requests, there is no human user membership check; validate the Web installation/service identity, tenant/site mapping and public data policy.

## 3.4. Token claims

A user access token may include stable context claims:

```ts
interface AccessTokenClaims {
  sub: string
  appId: string
  tenantId: string
  aud: string
  sessionId?: string
  permissionVersion?: number
  iat: number
  exp: number
}
```

Do not put huge permission arrays into tokens unless current Hub design requires it. Permissions can be resolved server-side or cached with explicit invalidation/version rules.

Rules:

- `aud` and `appId` must be checked for the receiving application.
- `tenantId` must match the current registered App installation owner.
- Membership suspension/revocation must take effect according to a documented token/cache invalidation window.
- A token for `customer_a_cms` must not be accepted by `customer_b_cms` or `customer_a_web` unless an explicit token-exchange/session policy authorizes it.
- Never rely on frontend tenant switching without a fresh server-validated app context.

## 3.5. Account switching and membership

- `/auth/me` returns current user plus current tenant/app context.
- A user may query accessible tenants/apps through authorized Hub endpoint.
- Selecting another tenant/app requires a fresh context/session or token exchange validated by Hub.
- Do not accept arbitrary `X-Tenant-Id` to switch tenant.
- When a user only has one accessible customer app, consumer UI may skip selection.

---

# 4. Database binding and customer data isolation

## 4.1. Default customer database model

Recommended for current product shape: separate logical database per customer, potentially on the same MongoDB cluster.

```text
MongoDB Cluster
├── tm_customer_a
├── tm_customer_b
└── tm_customer_c
```

- Customer A CMS and Customer A Web point to `tm_customer_a`.
- Customer B CMS points to `tm_customer_b`.
- A customer without website has no Web deployment.
- CMS uses an appropriately scoped read/write DB user.
- Web uses a read-only DB user where feasible; narrowly constrained public writes must use a separate route/role or service.

## 4.2. Where DB credentials live

Preferred:

- DB credential stored in each Vercel Project's server-only Environment Variables or approved secret manager.
- TM Hub stores tenant database binding metadata/reference/status, not plaintext URI in public API.
- Each CMS/Web installation receives its own credential with different database privileges.
- If Hub must manage secret values, use a dedicated encrypted secret store/KMS policy; do not reuse ordinary public config endpoint.

Do not return raw Mongo URI in `/auth/me`, app details, tenant details, runtime public config or logs.

## 4.3. Safe DB binding API/UI

Admin UI may show:

- Provider/cluster label (non-sensitive).
- Database name (only if policy allows).
- Connection status.
- Last verification time.
- Credential reference/status (masked).

Admin UI must not display or return raw credential after creation. Rotate by replacing a secret reference/credential through a protected server workflow.

## 4.4. No implicit default database

- Missing customer DB binding must fail closed in production.
- Do not silently fall back to shared `tm-flow` or `default` database.
- Development fallback requires explicit dev-only configuration.
- Health check should identify missing binding without disclosing credentials.

---

# 5. Tenant-scoped shared services

The current roadmap scopes Config, Media and Notification by `appId`. Preserve app-level isolation, but add tenant-level sharing only where two installations of the same customer must intentionally share a resource.

## 5.1. Scope hierarchy

Recommended resource scopes:

1. `platform`: TM Hub internal/system resources only.
2. `tenant`: intentionally shared within one customer (brand assets, selected shared provider connections/configs, tenant metadata).
3. `app`: isolated to a concrete CMS/Web installation.
4. `site`: scoped to a website/channel (public theme, site menu, SEO, publishing config).

Every record must have exactly one explicit owner scope (or a well-defined owner + grants model). Do not infer sharing because two apps happen to have the same `tenantId`.

## 5.2. Remote Configuration

Current roadmap stores configs by `appId`. Extend with optional scope metadata:

```ts
interface ConfigRecordScope {
  scopeType: 'platform' | 'tenant' | 'app' | 'site'
  scopeId: string
  key: string
  valueType: string
  isSecret: boolean
  version: number
  updatedAt: Date
  updatedBy?: string
}
```

Precedence for non-secret public values:

```text
platform defaults (TM Hub default config)
  < tenant brand/customer defaults (CustomerConfig in @tm/flow-config: theme, companyName)
  < app-specific override (CMS vs Web local app.config.ts)
  < site-specific override (for multi-domain web UI/site settings)
```

In `tm-websites`, the base customer values (`customerId`, `tenantId`, `companyName`, `theme`, `entitlements`, `domains`) are defined in customer layers (e.g. `@tm/customer-layer-sentuan-cms`) and validated by `@tm/flow-config` (`CustomerConfigSchema`). TM Hub synchronizes these settings into `app_configs` scoped by `tenant` or `app`, ensuring `tm-cms` can edit them while `tm-web` fetches them via `GET /api/v1/apps/:appId/configs/public`.

Only implement precedence if there is a concrete consumer. Do not make secrets inherit automatically across scopes without explicit grant.

Rules:

- Keep public/secret split.
- Secret values never appear in browser payload.
- `tm-cms` may manage customer branding for the tenant if authorized.
- `tm-web` gets a public projection for its assigned site only.
- App-specific secret credentials remain isolated unless an explicit tenant-level shared connection/grant is created.

## 5.3. Media Gateway — important cross-app requirement

Current plan's strict app-scoped media ownership is secure, but if Web A must display assets uploaded by CMS A, it needs an explicit same-tenant sharing mechanism.

Recommended model:

```ts
interface MediaResource {
  id: string
  tenantId: string
  ownerAppId: string              // usually CMS installation that uploaded it
  visibility: 'private' | 'tenant' | 'site-public'
  siteIds?: string[]
  provider: string
  providerResourceId: string
  publicUrl?: string
  metadata: Record<string, unknown>
}

interface MediaAccessGrant {
  tenantId: string
  resourceId: string
  granteeAppId: string            // e.g. same tenant's Web installation
  actions: Array<'read' | 'transform' | 'delete'>
}
```

Rules:

- Media owner remains `tenantId`; upload actor/app is recorded.
- CMS can upload/manage resources according to `media.upload`/`media.delete`.
- Web app can read only `site-public` resources explicitly assigned to one of its sites or granted to that Web installation.
- Web cannot delete CMS-owned media unless explicit capability exists.
- Tenant A Web can never read Tenant B media.
- Validate Cloudinary folder/namespace on server; never trust caller folder path.
- Keep Cloudinary API secret server-only.

For an initial one-CMS/one-Web pair, a tenant folder namespace plus explicit `site-public` visibility and Web read permission may be sufficient. Do not implement a general ACL engine if a simpler model satisfies requirements.

## 5.4. Notification Hub

Notifications remain app/user/device scoped. A notification sent to CMS users should not automatically be delivered to Web visitors. If a shared site notification/feed is needed, define a separate public content/event resource and policy; do not expose private user notifications.

## 5.5. AI Provider and Model Connections

Recommended scope:

- Tenant-level provider connection when customer intentionally shares a provider configuration across CMS and Web.
- App-level grant determines which app may use which connection/model/capabilities.
- CMS AI tools require user permissions and tenant context.
- Web public assistant uses an explicit site-level policy, strict rate/quota and public-only tool scope.
- Never expose provider credentials to CMS/Web browser.
- Provider connection/model catalog/grants do not automatically prove an inference/streaming API exists. Audit and define a server-side AI Runtime if absent.

## 5.6. Service-to-service identity

- Each concrete app installation has its own service credential or supported token-exchange mechanism.
- Credential is bound to one `appId` and `tenantId`.
- Rotate/revoke and audit credentials.
- Never use a shared universal service secret across all customer sites.
- For public Web requests, only the server uses the Web app credential; visitor does not.

---

# 6. Application Registry and lifecycle

## 6.1. App creation workflow

Creating a customer app installation should require:

1. Existing active Tenant.
2. Logical `appCode` (`tm-cms`, `tm-web`, etc.).
3. `appKind` and environment.
4. Unique installation `appId`.
5. Allowed origins/domains.
6. Required capabilities and service credential policy.
7. Optional site assignments.
8. Config scope references.
9. Status and audit fields.

## 6.2. Example registry records

```json
{
  "appId": "customer-a-cms",
  "tenantId": "customer-a",
  "appCode": "tm-cms",
  "appKind": "cms",
  "type": "application",
  "environment": "production",
  "isActive": true,
  "isDeletable": true,
  "allowedOrigins": ["https://admin.customer-a.vn"]
}
```

```json
{
  "appId": "customer-a-web",
  "tenantId": "customer-a",
  "appCode": "tm-web",
  "appKind": "web",
  "type": "application",
  "environment": "production",
  "isActive": true,
  "isDeletable": true,
  "siteIds": ["main"],
  "allowedOrigins": ["https://www.customer-a.vn"]
}
```

Never use these sample IDs in production without provisioning. `allowedOrigins` is supplementary and does not replace authenticated requests.

## 6.3. Lifecycle states

- `provisioning`: created but not ready for traffic.
- `active`: can authenticate/use allowed services.
- `suspended`: access blocked; preserve data/config for investigation/reactivation.
- `retired`: no new traffic; retain audit and ownership records.

Delete should be rare. Prefer deactivate/retire and preserve audit history. System app is immutable/non-deletable.

---

# 7. API contract additions

Keep existing `/api/v1/apps/:appId/*` APIs working. Add endpoints only after auditing existing equivalent APIs.

## 7.1. Tenant APIs

```text
GET    /api/v1/tenants
POST   /api/v1/tenants
GET    /api/v1/tenants/:tenantId
PUT    /api/v1/tenants/:tenantId
POST   /api/v1/tenants/:tenantId/activate
POST   /api/v1/tenants/:tenantId/suspend
GET    /api/v1/tenants/:tenantId/apps
GET    /api/v1/tenants/:tenantId/members
POST   /api/v1/tenants/:tenantId/invitations
```

## 7.2. App installation APIs

```text
GET    /api/v1/tenants/:tenantId/apps
POST   /api/v1/tenants/:tenantId/apps
GET    /api/v1/apps/:appId
PUT    /api/v1/apps/:appId
POST   /api/v1/apps/:appId/rotate-secret
POST   /api/v1/apps/:appId/deactivate
POST   /api/v1/apps/:appId/activate
GET    /api/v1/apps/:appId/capabilities
```

If existing `POST /api/v1/apps` can safely create installation records with tenant ownership, preserve that route and add validation rather than introducing duplicates.

## 7.3. Membership APIs

```text
GET    /api/v1/tenants/:tenantId/members
POST   /api/v1/tenants/:tenantId/members/invite
PUT    /api/v1/tenants/:tenantId/members/:userId
DELETE /api/v1/tenants/:tenantId/members/:userId

GET/PUT /api/v1/apps/:appId/users/:userId/roles
```

All actions need platform/tenant admin permissions and audit logs. Tenant membership does not automatically imply membership in every app; app access must be explicitly granted.

## 7.4. Public site configuration API

A Website installation may need public config/bootstrap:

```text
GET /api/v1/apps/:appId/configs/public
GET /api/v1/apps/:appId/sites/:siteId/public-config
```

Public response must be allow-listed and only for the trusted installation/site. Do not let a browser specify another tenant's `appId` and receive public config unless the endpoint is intentionally public and verified against host/origin/installation policy.

## 7.5. Service authentication

Prefer existing Hub service credential/token exchange mechanism. If absent, define a narrow mechanism:

- Client credential bound to app installation.
- Short-lived signed service token with `iss`, `aud`, `sub=appId`, `tenantId`, scope/capabilities, `iat`, `exp`, `jti`.
- Credential rotation and revocation.
- Replay and clock-skew protection as appropriate.
- No long-lived service secret in browser.
- Rate limit and audit sensitive operations.

Do not implement a parallel service-auth protocol if the current Hub already has one.

---

# 8. Admin UI changes

## 8.1. Tenant Management

Create a Tenant Management section for authorized platform operators:

- Tenant list: name, tenantId, status, plan, app count, created/updated.
- Tenant detail: overview, app installations, members, sites, public branding/config status, database binding status, audit.
- Tenant lifecycle: activate/suspend/retire with confirmation.
- No raw database secrets displayed.

## 8.2. Application detail

Add/clarify fields:

- Tenant owner.
- Logical app code (`tm-cms`, `tm-web`).
- Installation kind.
- Environment.
- AppId.
- Allowed origins.
- Assigned site IDs (Web app).
- Credential status/rotation.
- Service capabilities/grants.
- Config scope/revision.
- Media permissions.
- Audit events.

## 8.3. Pairing view

For Tenant A, show:

```text
Customer A
├── TM CMS installation     active
└── TM Web installation     active / not installed
```

This is an operational grouping, not a requirement that every tenant have both apps.

## 8.4. Permissions

Add stable codes only after checking actual use cases, for example:

```text
tenants.read
tenants.create
tenants.update
tenants.suspend
tenants.members.read
tenants.members.manage
apps.installations.read
apps.installations.create
apps.installations.update
apps.installations.manage_credentials
sites.read
sites.manage
media.tenant.read
media.site_public.assign
configs.tenant.read
configs.tenant.write
```

Do not auto-grant platform-wide rights to ordinary customer admins. Tenant admin permissions must be scoped to their own tenant.

---

# 9. Migration and backward compatibility

## 9.1. Do not assume the uploaded roadmap is the current schema

Phase 0 must inspect the actual `tm-hub` database and code, including:

- Current App records and whether each represents a logical product or concrete installation.
- Existing users, memberships and role mappings.
- Whether email/username is globally unique or app-scoped.
- Existing app-scoped configs/media folders/notifications.
- Current service credential implementation.
- `tm-hub-client` and `tm-tools` consumers.

## 9.2. Migration strategy

1. Add nullable tenant/app extension fields first if schema supports compatibility.
2. Create Tenant records for existing customer-owned apps using an explicit mapping file.
3. Keep `tm-hub` System Application platform-scoped and protected.
4. For every legacy child app, decide and record its tenant owner. Do not guess from display name alone.
5. Existing legacy apps with no customer relationship may be assigned to a documented `legacy` tenant only if that matches their operational ownership. Otherwise leave them in controlled migration state, not silently accessible.
6. Backfill `tenantId` to memberships/roles/resources only where needed; avoid duplicate data sources.
7. Add/verify indexes and uniqueness after duplicate scan.
8. Add compatibility logic for old app records during transition.
9. Update SDK types/response contracts additively.
10. Keep old endpoints working until all consumers migrate.
11. Back up data and define rollback before any destructive migration.

## 9.3. Important indexes (adapt to actual DB)

- `Tenant.tenantId` unique.
- `App.appId` unique (existing invariant).
- `App(tenantId, appCode, environment)` indexed; uniqueness only if product deployment rules require it.
- `TenantMembership(tenantId, userId)` unique according to active-membership design.
- `AppMembership(appId, userId)` unique according to active-membership design.
- `Site(tenantId, siteId)` unique.
- `Site(tenantId, primaryDomain)` unique or domain registry equivalent.
- All tenant-owned service resources indexed by `tenantId` plus resource lookup fields.

Do not add unique indexes until existing duplicates have been reported/resolved.

## 9.4. Rollback

- New fields remain nullable during compatibility window.
- Old app-scoped APIs continue to work.
- Tenant mapping can be disabled/rolled back before irreversible data transforms.
- Do not drop old fields/collections in this upgrade.
- Keep migration logs with counts and failed records.

---

# 10. Required tests

## 10.1. Tenant/app pairing

- Customer A has CMS app and Web app with different `appId` but same `tenantId`.
- Customer B has a distinct `tenantId` and app records.
- CMS-only tenant has no Web installation and still works.
- Multiple Web sites are assigned only to the correct tenant/Web installation.

## 10.2. Identity/membership

- One global user can have memberships in Tenant A and Tenant B.
- Role in Customer A CMS does not grant permissions in Customer B CMS.
- Removing Tenant A membership does not remove Tenant B membership.
- A user with Tenant membership but no App membership cannot call the app's admin APIs.
- Inactive tenant/app blocks new requests.
- Browser cannot switch tenant by editing header/body/query.

## 10.3. Resource isolation

- Customer A cannot read/update/delete Customer B app/config/media/site resources by changing IDs.
- CMS A can upload/manage permitted tenant media.
- Web A can read only media explicitly public/granted to Site A.
- Web A cannot delete CMS media.
- Web B cannot read Tenant A media.
- Tenant config → app override → site override precedence is deterministic and tested.
- Public config never returns secrets.

## 10.4. Service auth

- CMS service token only accesses CMS allowed capabilities.
- Web service token only accesses Web allowed capabilities.
- App secret rotation/revocation invalidates old credential according to policy.
- Expired/wrong-audience/wrong-tenant token is rejected.
- `appId` without credential is not authenticated.
- Public visitor has no service token.

## 10.5. Backward compatibility

- `tm-tools` login/refresh/me/routes/config/media/notification continue working.
- Existing app-scoped role mapping remains correct.
- Legacy App with migration status is handled explicitly.
- Existing System App and protected roles remain non-deletable.

---

# 11. Implementation phases

## Phase 0 — Read-only verification (mandatory)

Inspect actual `tm-hub`, SDK and consumer code. Do not modify code.

Deliver:

1. Current schema and indexes.
2. Current App record semantics: logical product or installation?
3. Current identity uniqueness scope: global/app/tenant?
4. Current membership/role scope.
5. Current secret/service credential mechanism.
6. Config/Media sharing limitations across two appIds.
7. Existing site/domain data if any.
8. API and SDK compatibility map.
9. Precise missing items from this addendum.
10. Minimal file-level migration plan.

If actual code already implements a requirement, mark it `Complete` with file/schema/API/test evidence and do not build a duplicate implementation.

## Phase 1 — Tenant model and App ownership

- Add Tenant entity only if no equivalent exists.
- Extend App Registry records with tenantId/appCode/appKind/environment where missing.
- Keep appId unique per concrete installation.
- Protect System Application from tenant assignment/deletion.
- Add tenant registry admin UI.
- Unit/integration tests for app ownership.

## Phase 2 — Tenant/App membership relationship

- Preserve existing app membership.
- Add TenantMembership only if required by current data model.
- Validate app tenant consistency.
- Add tenant switching/access listing APIs if required.
- Update token/session context additively.
- Test membership isolation.

## Phase 3 — Site registry and public site identity

- Add Site registry only if multiple sites need central management; otherwise support `siteId=main` per Web installation using validated config.
- Bind host/domain to tenant/site.
- Verify domain/allowed origin.
- Add Web installation service identity.

## Phase 4 — Tenant/app/site config scope

- Extend config scope only where shared customer branding/provider config is required.
- Implement public projections.
- Preserve app-specific secret ownership and current config APIs.
- Add config precedence and audit tests.

## Phase 5 — Cross-app Media Gateway access

- Add tenant-owned media visibility/grants.
- Keep upload/delete owner app and permission checks.
- Allow Web read of explicit public media only.
- Ensure tenant isolation tests.

## Phase 6 — Service capabilities and DB binding metadata

- Verify current service-to-service auth.
- Add app-specific service credentials/grants only if missing.
- Add non-secret DB binding metadata/reference; secret value remains in secret manager or deployment env.
- Do not turn Hub into direct customer database proxy unless separately designed.

## Phase 7 — SDK & Monorepo Foundation Integration

- Extend `tm-hub-client` types and methods only for supported new APIs (`tenants`, `installations`, `sites`).
- Integrate directly with `D:\Applications\tm-websites\tm-shared\packages\flow-contracts`:
  - Align `UserSession`, `AuthTokens`, `LoginResponse` with TM Hub auth payload.
  - Export tenant/installation types for cross-app consumption in `tm-cms` and `tm-web`.
- Provide Hub Satellite Composable (`useHub`) in `@tm/nuxt-layer-core` / `@tm/nuxt-layer-api-base` matching the `useHub()` standard from `tm-tools`:
  - Auto-attach headers: `X-App-Id`, `Authorization: Bearer <token>`, optional `X-Tenant-Id`.
  - Handle transparent token refresh, session persistence, and logout navigation.
- Preserve old `appId` methods/response shapes for `tm-tools`, `tm-trading`, and existing satellites.
- Regression test `tm-tools` and verify contract compatibility with `tm-websites`.

## Phase 8 — Hardening and release

- Tenant isolation/security review.
- Migration dry run + backup + rollback plan.
- Permission catalog update.
- Audit logs.
- Load/cache tests for configuration endpoints.
- API/SDK docs and consumer migration guide.

---

# 12. Definition of Done

- [ ] Actual App Registry meaning is explicit: one App record represents one concrete installation.
- [ ] `appId` is unique per customer app deployment.
- [ ] `appCode` identifies logical product such as `tm-cms`/`tm-web`.
- [ ] Every customer application installation is owned by a valid `tenantId`.
- [ ] Customer A CMS and Web can be linked under one tenant.
- [ ] Customer B has a separate tenant/data boundary.
- [ ] TM Hub System Application remains platform-scoped and protected.
- [ ] Global User identity + tenant/app-scoped memberships is implemented or existing equivalent is proven.
- [ ] Role/permission remains app-scoped and no role leaks across tenants.
- [ ] Token/session context is bound to the correct app installation and tenant.
- [ ] Public Website service access is separate from anonymous visitor identity.
- [ ] Site/domain mapping is trusted and tenant-scoped.
- [ ] DB binding metadata does not expose raw connection secrets.
- [ ] CMS-uploaded tenant media can be explicitly exposed to the same tenant's Web site without cross-tenant access.
- [ ] Public configuration returns an allow-listed projection only.
- [ ] Secrets never appear in logs/browser/API responses.
- [ ] Existing `tm-tools` consumer remains compatible.
- [ ] Migrations are additive, documented and rollback-aware.
- [ ] Integration/security tests prove tenant/app/site isolation.

---

# 13. Required AI coding agent workflow

1. Read the current TM Hub Control Plane roadmap and this addendum.
2. Inspect actual repository/schema/API/SDK implementation. This file is not proof that current code has or lacks a feature.
3. Start with Phase 0 read-only verification; do not edit during audit.
4. Distinguish `Complete`, `Partial`, `Missing`, `Not Applicable` with evidence.
5. Do not rewrite the existing Application Registry/RBAC if it can be extended compatibly.
6. Do not create a duplicate TenantMembership if existing membership model already represents it safely.
7. Do not create `appInstallationId` if `appId` already means a unique installation. Add `appCode`/`tenantId` instead.
8. Do not change global identity uniqueness semantics without explicit migration evidence/need.
9. Do not store raw DB credentials in ordinary Hub config or expose them through API.
10. Do not expand app-scoped Media/Config resources into tenant-shared resources without explicit scope/access policy.
11. Preserve `tm-tools` and all existing consumers.
12. For non-blocking ambiguity, use the defaults in this document. For destructive or security-critical unresolved decisions, stop only that operation and report evidence/options.
13. Implement one phase at a time; run tests and report exact commands/results.
14. After each phase report files, schema/API changes, migrations, security impact, SDK impact, tests, risks and rollback.
15. Do not claim completion unless verified in code and tests.

## 14. References

- Existing uploaded roadmap: `TM Hub Control Plane — Architecture & Upgrade Roadmap`.
- `tm-websites` Architecture Blueprints:
  - `D:\Applications\tm-websites\docs\TM-CMS-WEB-HUB-Blueprint-Index.md`
  - `D:\Applications\tm-websites\docs\TM-Shared-Packages-Architecture.md`
  - `D:\Applications\tm-websites\docs\TM-CMS-Project-Blueprint.md`
  - `D:\Applications\tm-websites\docs\TM-WEB-Project-Blueprint.md`
  - `D:\Applications\tm-websites\docs\superpowers\specs\2026-11-02-tm-websites-scaffolding-design.md`
- Nuxt Layers documentation (for consumers): https://nuxt.com/docs/4.x/getting-started/layers
- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Multi-Tenant Application Security: https://cheatsheetseries.owasp.org/

