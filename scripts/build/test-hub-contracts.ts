import assert from 'node:assert/strict'
import {
  AppInstallationSchema,
  AuthTokensSchema,
  HUB_CONTENT_TYPES,
  HubAppConfigMetaSchema,
  HubAppDetailSchema,
  HubAuditLogSchema,
  HubAuthResponseSchema,
  HubConfigListPayloadSchema,
  HubContentEntrySchema,
  HubConnectionsPayloadSchema,
  HubMailAnalyticsSummarySchema,
  HubMailQueuePayloadSchema,
  HubMailTemplateListPayloadSchema,
  HubMediaFoldersPayloadSchema,
  HubMediaResourcesPayloadSchema,
  HubNotificationSchema,
  HubRoleSchema,
  HubRouteListPayloadSchema,
  HubUserSummarySchema,
  LoginResponseSchema,
  SiteSchema,
  TenantSchema,
  UserSessionSchema,
  buildHubContentPayload,
} from '../../tm-shared/packages/flow-contracts/src/index.js'
import {
  buildHubHeaders,
  extractHubTokens,
  getErrorStatus,
  getHubErrorCode,
  resolveHubUrl,
  sanitizeHubProxyPath,
  shouldAttemptTokenRefresh,
} from '../../tm-shared/packages/flow-utils/src/hub.js'

let checks = 0

function check(name: string, fn: () => void) {
  try {
    fn()
    checks++
    console.log(`   ✅ ${name}`)
  } catch (error) {
    console.error(`   ❌ ${name}`)
    console.error(`      ${(error as Error).message}`)
    process.exitCode = 1
  }
}

console.log('🧪 Testing Hub contracts and request helpers...\n')

console.log('1. Auth contracts')
check('AuthTokens accepts access token with optional refresh token', () => {
  const parsed = AuthTokensSchema.parse({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 3600 })
  assert.equal(parsed.accessToken, 'access-1')
  assert.equal(parsed.refreshToken, 'refresh-1')
  assert.equal(parsed.tokenType, 'Bearer')
})
check('AuthTokens rejects missing access token', () => {
  assert.equal(AuthTokensSchema.safeParse({ refreshToken: 'refresh-1' }).success, false)
})
check('HubAuthResponse pairs a user session with tokens', () => {
  const parsed = HubAuthResponseSchema.parse({
    user: {
      id: 'user_1',
      email: 'admin@example.com',
      name: 'Admin',
      tenantId: 'tenant_sentuan',
      appId: 'app_sentuan_cms',
      roles: ['admin'],
      permissions: ['*'],
    },
    tokens: { accessToken: 'access-1' },
  })
  assert.equal(parsed.user.tenantId, 'tenant_sentuan')
  assert.equal(parsed.tokens.tokenType, 'Bearer')
})
check('LoginResponse keeps legacy token fields and accepts tokens', () => {
  const legacy = LoginResponseSchema.parse({
    user: {
      id: 'user_1',
      email: 'admin@example.com',
      name: 'Admin',
      tenantId: 'tenant_sentuan',
      appId: 'app_sentuan_cms',
    },
    token: 'legacy-token',
  })
  assert.equal(legacy.token, 'legacy-token')
  const modern = LoginResponseSchema.parse({
    user: {
      id: 'user_1',
      email: 'admin@example.com',
      name: 'Admin',
      tenantId: 'tenant_sentuan',
      appId: 'app_sentuan_cms',
    },
    tokens: { accessToken: 'access-2', refreshToken: 'refresh-2' },
  })
  assert.equal(modern.tokens?.accessToken, 'access-2')
})
check('UserSession keeps Hub role ids, username and allowed routes', () => {
  const session = UserSessionSchema.parse({
    id: 'user_1',
    email: 'admin@example.com',
    name: 'Admin',
    username: 'admin',
    tenantId: 'tenant_sentuan',
    appId: 'app_sentuan_cms',
    roles: ['role_owner_7f3a'],
    permissions: ['catalog.read'],
    allowedRoutes: ['/catalog'],
  })
  assert.deepEqual(session.roles, ['role_owner_7f3a'])
  assert.equal(session.username, 'admin')
  assert.deepEqual(session.allowedRoutes, ['/catalog'])
})

console.log('\n2. Tenant, installation and site contracts')
check('Tenant defaults to active status', () => {
  const tenant = TenantSchema.parse({ tenantId: 'tenant_sentuan', name: 'Sen Tuấn' })
  assert.equal(tenant.status, 'active')
})
check('AppInstallation binds appId/appCode to a tenant', () => {
  const installation = AppInstallationSchema.parse({
    appId: 'app_sentuan_cms',
    appCode: 'tm-cms',
    tenantId: 'tenant_sentuan',
  })
  assert.equal(installation.appCode, 'tm-cms')
  assert.equal(installation.environment, 'production')
  assert.equal(installation.status, 'active')
})
check('AppInstallation rejects an unknown app code', () => {
  assert.equal(
    AppInstallationSchema.safeParse({ appId: 'a', appCode: 'tm-mobile', tenantId: 't' }).success,
    false,
  )
})
check('Site requires siteId, tenantId and appId', () => {
  assert.equal(SiteSchema.safeParse({ siteId: 'main', tenantId: 'tenant_sentuan' }).success, false)
  const site = SiteSchema.parse({ siteId: 'main', tenantId: 'tenant_sentuan', appId: 'app_sentuan_web' })
  assert.equal(site.status, 'active')
})

console.log('\n3. Hub request helpers')
check('resolveHubUrl joins base and path without duplicate slashes', () => {
  assert.equal(resolveHubUrl('http://localhost:4000/', '/api/v1/session'), 'http://localhost:4000/api/v1/session')
  assert.equal(resolveHubUrl('http://localhost:4000', 'api/v1/session'), 'http://localhost:4000/api/v1/session')
})
check('resolveHubUrl passes absolute URLs through unchanged', () => {
  assert.equal(resolveHubUrl('http://localhost:4000', 'https://hub.example.com/api'), 'https://hub.example.com/api')
})
check('buildHubHeaders attaches app, tenant and bearer headers', () => {
  const headers = buildHubHeaders({ appId: 'app_sentuan_cms', tenantId: 'tenant_sentuan', accessToken: 'token-1' })
  assert.equal(headers.get('X-App-Id'), 'app_sentuan_cms')
  assert.equal(headers.get('X-Tenant-Id'), 'tenant_sentuan')
  assert.equal(headers.get('Authorization'), 'Bearer token-1')
})
check('buildHubHeaders omits tenant and authorization when absent', () => {
  const headers = buildHubHeaders({ appId: 'app_sentuan_cms' })
  assert.equal(headers.get('X-Tenant-Id'), null)
  assert.equal(headers.get('Authorization'), null)
})
check('buildHubHeaders preserves explicitly provided headers', () => {
  const headers = buildHubHeaders(
    { appId: 'app_sentuan_cms', accessToken: 'token-1' },
    { Authorization: 'Bearer override', 'X-App-Id': 'other-app' },
  )
  assert.equal(headers.get('Authorization'), 'Bearer override')
  assert.equal(headers.get('X-App-Id'), 'other-app')
})
check('shouldAttemptTokenRefresh retries only non-auth 401 responses', () => {
  assert.equal(shouldAttemptTokenRefresh(401, '/api/v1/catalog/products'), true)
  assert.equal(shouldAttemptTokenRefresh(401, '/api/v1/auth/login'), false)
  assert.equal(shouldAttemptTokenRefresh(401, '/api/v1/auth/refresh'), false)
  assert.equal(shouldAttemptTokenRefresh(403, '/api/v1/catalog/products'), false)
  assert.equal(shouldAttemptTokenRefresh(undefined, '/api/v1/catalog/products'), false)
})
check('extractHubTokens reads flat, data and data.tokens payloads', () => {
  assert.deepEqual(extractHubTokens({ accessToken: 'a' }), { accessToken: 'a', refreshToken: undefined })
  assert.deepEqual(extractHubTokens({ data: { accessToken: 'b', refreshToken: 'r' } }), { accessToken: 'b', refreshToken: 'r' })
  assert.deepEqual(extractHubTokens({ data: { tokens: { accessToken: 'c' } } }), { accessToken: 'c', refreshToken: undefined })
  assert.equal(extractHubTokens({ data: {} }), null)
  assert.equal(extractHubTokens(null), null)
})
check('getErrorStatus reads statusCode, response.status and status', () => {
  assert.equal(getErrorStatus({ statusCode: 401 }), 401)
  assert.equal(getErrorStatus({ response: { status: 403 } }), 403)
  assert.equal(getErrorStatus({ status: 500 }), 500)
  assert.equal(getErrorStatus(new Error('boom')), undefined)
})
check('sanitizeHubProxyPath allows only /api/v1 endpoints', () => {
  assert.equal(sanitizeHubProxyPath('api/v1/catalog/products'), '/api/v1/catalog/products')
  assert.equal(sanitizeHubProxyPath('api/v1/catalog/products?page=2'), null)
  assert.equal(sanitizeHubProxyPath('/api/v1/auth/me'), null)
  assert.equal(sanitizeHubProxyPath('api/v2/auth/me'), null)
  assert.equal(sanitizeHubProxyPath('api/v1/../../etc/passwd'), null)
  assert.equal(sanitizeHubProxyPath('https://evil.example.com/api/v1/auth/me'), null)
  assert.equal(sanitizeHubProxyPath(undefined), null)
})
check('Hub admin contracts parse app-scoped user, role and app payloads', () => {
  const user = HubUserSummarySchema.parse({
    id: 'user_1',
    email: 'admin@example.com',
    username: 'sentuan_admin',
    name: 'Sentuan Administrator',
    role: 'admin',
    isActive: true,
    createdAt: '2026-11-04T06:23:41.000Z',
  })
  assert.equal(user.role, 'admin')
  assert.equal(user.isActive, true)

  const role = HubRoleSchema.parse({
    id: 'admin',
    appId: 'app_sentuan_cms',
    name: 'Administrator',
    permissions: [{ module: 'users', actions: ['read'] }],
    allowedRoutes: ['*'],
    isSystem: true,
  })
  assert.deepEqual(role.permissions[0], { module: 'users', actions: ['read'] })
  assert.equal(role.allowedRoutes[0], '*')

  const app = HubAppDetailSchema.parse({
    id: 'app_sentuan_cms',
    name: 'Sen Tuấn CMS',
    allowedOrigins: ['https://sentuan.vn'],
    isActive: true,
    configs: { theme: 'amber' },
  })
  assert.equal(app.description, '')
  assert.equal(app.configs.theme, 'amber')
})
check('Hub admin contracts parse config entries and audit logs', () => {
  const meta = HubAppConfigMetaSchema.parse({
    key: 'storefront.currency',
    category: 'storefront',
    isPublic: true,
    description: 'Display currency',
    updatedAt: '2026-11-04T06:23:41.000Z',
  })
  assert.equal(meta.isSecret, false)

  const payload = HubConfigListPayloadSchema.parse({
    success: true,
    data: { 'storefront.currency': 'VND' },
    meta: [meta],
    nextCursor: null,
  })
  assert.equal(payload.data['storefront.currency'], 'VND')
  assert.equal(payload.meta.length, 1)

  const log = HubAuditLogSchema.parse({
    modelName: 'products',
    action: 'update',
    by: { _id: 'user_1', name: 'Sentuan Administrator', email: 'admin@example.com' },
    source: 'external_app',
    at: 1762243421000,
    changedFields: ['price'],
    summary: 'Updated price',
  })
  assert.equal(log.by?.email, 'admin@example.com')
  assert.deepEqual(log.changedFields, ['price'])
  assert.equal(log.at, 1762243421000)
})
check('Hub content contracts parse published and defaulted records', () => {
  const entry = HubContentEntrySchema.parse({
    _id: '6adc9603a878e9ec6d36cdbf',
    appId: 'global',
    key: 'system_docs',
    title: 'TM Platform Reference & API Documentation',
    description: 'Central documentation for TM Hub and satellites',
    category: 'docs',
    contentType: 'json',
    isPublished: true,
    data: { version: 1, en: {}, vi: {} },
    metadata: { source: 'seed' },
  })
  assert.equal(entry._id, '6adc9603a878e9ec6d36cdbf')
  assert.equal(entry.isPublished, true)
  assert.equal(entry.isDeleted, false)
  assert.deepEqual(Object.keys(entry.data as object), ['version', 'en', 'vi'])

  const minimal = HubContentEntrySchema.parse({ _id: 'c1', appId: 'app_1', key: 'hero', title: 'Hero' })
  assert.equal(minimal.contentType, 'json')
  assert.equal(minimal.isPublished, false)
})
check('buildHubContentPayload trims metadata and parses JSON payloads', () => {
  const result = buildHubContentPayload({
    key: '  pages/about  ',
    title: '  About us  ',
    description: '  Company story  ',
    category: '  page  ',
    contentType: 'json',
    data: '{"sections":[{"type":"hero"}]}',
    isPublished: true,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.payload.key, 'pages/about')
  assert.equal(result.payload.title, 'About us')
  assert.equal(result.payload.description, 'Company story')
  assert.equal(result.payload.category, 'page')
  assert.deepEqual(result.payload.data, { sections: [{ type: 'hero' }] })
  assert.equal(result.payload.isPublished, true)
})
check('buildHubContentPayload keeps raw text for non-JSON content types', () => {
  const result = buildHubContentPayload({
    key: 'legal/terms',
    title: 'Terms',
    contentType: 'markdown',
    data: '# Terms\n\nHello',
    isPublished: false,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.payload.data, '# Terms\n\nHello')
  assert.ok(HUB_CONTENT_TYPES.includes(result.payload.contentType))
})
check('buildHubContentPayload rejects invalid keys, missing fields and broken JSON', () => {
  const base = { key: 'page', title: 'Page', contentType: 'json' as const, data: '{}', isPublished: false }
  assert.deepEqual(buildHubContentPayload({ ...base, key: '  ' }), { ok: false, field: 'key' })
  assert.deepEqual(buildHubContentPayload({ ...base, key: 'bad key' }), { ok: false, field: 'key' })
  assert.deepEqual(buildHubContentPayload({ ...base, title: '  ' }), { ok: false, field: 'title' })
  assert.deepEqual(buildHubContentPayload({ ...base, data: '   ' }), { ok: false, field: 'data' })
  assert.deepEqual(buildHubContentPayload({ ...base, data: '{not json}' }), { ok: false, field: 'data' })
})
check('Hub media contracts parse folders and Cloudinary resources', () => {
  const folders = HubMediaFoldersPayloadSchema.parse({
    success: true,
    data: {
      parent: null,
      folders: [{ name: 'products', path: 'products' }, { name: 'campaigns', path: 'campaigns' }],
    },
    folders: [{ name: 'products', path: 'products' }, { name: 'campaigns', path: 'campaigns' }],
    nextCursor: null,
  })
  assert.equal(folders.folders.length, 2)
  assert.equal(folders.folders[0]?.path, 'products')

  const resources = HubMediaResourcesPayloadSchema.parse({
    success: true,
    resources: [{
      public_id: 'products/nhan-kim-cuong-01',
      filename: 'nhan-kim-cuong-01.webp',
      format: 'webp',
      resource_type: 'image',
      folder: 'products',
      bytes: 188416,
      width: 1600,
      height: 1600,
      created_at: '2026-11-02T10:00:00.000Z',
      secure_url: 'https://res.cloudinary.com/demo/image/upload/products/nhan-kim-cuong-01.webp',
    }],
    nextCursor: 'abc123',
  })
  assert.equal(resources.resources.length, 1)
  assert.equal(resources.resources[0]?.public_id, 'products/nhan-kim-cuong-01')
  assert.equal(resources.resources[0]?.resource_type, 'image')
  assert.equal(resources.nextCursor, 'abc123')

  const defaults = HubMediaResourcesPayloadSchema.parse({
    success: true,
    resources: [{ public_id: 'raw/report' }],
  })
  assert.equal(defaults.resources[0]?.resource_type, 'image')
  assert.equal(defaults.resources[0]?.bytes, 0)
  assert.equal(defaults.nextCursor, undefined)
})
check('Hub notification and mail contracts parse Hub payloads', () => {
  const notification = HubNotificationSchema.parse({
    id: '6f1c2a44-8f0e-4a53-9d2e-2a3f5e6b7c88',
    appId: 'app_sentuan_cms',
    userId: 'a1b2c3d4-0000-0000-0000-000000000001',
    title: 'Low stock alert',
    body: '3 ring variants fell below the reorder threshold.',
    url: 'https://sentuan.vn/admin/inventory',
    isRead: false,
    createdAt: '2026-11-04T08:30:00.000Z',
  })
  assert.equal(notification.isRead, false)
  assert.equal(notification.icon, undefined)

  const notificationDefaults = HubNotificationSchema.parse({
    id: 'n2',
    appId: 'app_sentuan_cms',
    createdAt: '2026-11-04T09:00:00.000Z',
  })
  assert.equal(notificationDefaults.title, '')
  assert.equal(notificationDefaults.body, '')
  assert.equal(notificationDefaults.isRead, false)

  const templates = HubMailTemplateListPayloadSchema.parse({
    success: true,
    data: [{
      id: 'tpl_1',
      key: 'order.confirmation',
      name: 'Order confirmation',
      subject: 'Your order {{orderCode}} is confirmed',
      locale: 'vi',
      status: 'published',
      version: 3,
      updatedAt: '2026-11-01T12:00:00.000Z',
    }],
    pagination: { page: 1, limit: 20, total: 1 },
  })
  assert.equal(templates.data.length, 1)
  assert.equal(templates.data[0]?.key, 'order.confirmation')
  assert.equal(templates.pagination?.total, 1)

  const templateDefaults = HubMailTemplateListPayloadSchema.parse({ success: true })
  assert.deepEqual(templateDefaults.data, [])

  const summary = HubMailAnalyticsSummarySchema.parse({
    totalSent: 120,
    totalDelivered: 118,
    totalOpened: 64,
    deliveryRate: 118 / 120,
    openRate: 64 / 118,
  })
  assert.equal(summary.totalClicked, 0)
  assert.ok(summary.deliveryRate > 0.98)

  const queue = HubMailQueuePayloadSchema.parse({
    success: true,
    data: { enabled: true, stats: { waiting: 3, active: 1 }, jobs: [{ id: 'job_1' }] },
  })
  assert.equal(queue.data.enabled, true)
  assert.equal(queue.data.jobs.length, 1)

  const queueOffline = HubMailQueuePayloadSchema.parse({ success: true, data: { enabled: false } })
  assert.deepEqual(queueOffline.data.jobs, [])
  assert.equal(queueOffline.data.stats, undefined)
})
check('Hub route and connection contracts parse Hub payloads', () => {
  const routes = HubRouteListPayloadSchema.parse({
    success: true,
    data: {
      routes: [
        { id: 'content_pages', path: '/content/pages', label: 'nav.content_pages', sort: 10, isVisible: true, parentId: 'group_content', requiredPermission: null },
        { id: 'admin_users', path: '/administration/users', label: 'nav.users', sort: 40, isVisible: true, parentId: 'group_administration', requiredPermission: 'users.read' },
      ],
      tree: [{ id: 'group_content', children: [] }],
    },
    nextCursor: null,
  })
  assert.equal(routes.data.routes.length, 2)
  assert.equal(routes.data.routes[1]?.requiredPermission, 'users.read')
  assert.equal(routes.data.tree.length, 1)

  const routeDefaults = HubRouteListPayloadSchema.parse({ success: true, data: {} })
  assert.deepEqual(routeDefaults.data.routes, [])

  const connections = HubConnectionsPayloadSchema.parse({
    success: true,
    data: [{
      key: 'cloudinary',
      name: 'Cloudinary',
      description: 'Media storage and transformation',
      category: 'media',
      connection: {
        id: 'conn_1',
        provider: 'cloudinary',
        name: 'default',
        status: 'connected',
        isEnabled: true,
        hasSecrets: true,
        lastTestAt: '2026-11-03T07:00:00.000Z',
        lastTestOk: true,
      },
    }, {
      key: 'google_oauth',
      name: 'Google OAuth',
      description: 'Sign-in with Google',
    }],
  })
  assert.equal(connections.data.length, 2)
  assert.equal(connections.data[0]?.connection?.isEnabled, true)
  assert.equal(connections.data[0]?.connection?.hasSecrets, true)
  assert.equal(connections.data[1]?.connection, undefined)

  const connectionDefaults = HubConnectionsPayloadSchema.parse({ success: true })
  assert.deepEqual(connectionDefaults.data, [])
})
check('getHubErrorCode reads nested Hub error codes and status messages', () => {
  assert.equal(getHubErrorCode({ data: { data: { error: { code: 'INVALID_CREDENTIALS' } } } }), 'INVALID_CREDENTIALS')
  assert.equal(getHubErrorCode({ data: { error: { code: 'FORBIDDEN' } } }), 'FORBIDDEN')
  assert.equal(getHubErrorCode({ data: { statusMessage: 'error.missingCapability' } }), 'error.missingCapability')
  assert.equal(getHubErrorCode({ statusMessage: 'error.forbidden' }), 'error.forbidden')
  assert.equal(getHubErrorCode(new Error('boom')), undefined)
})

console.log(`\n${process.exitCode ? '⚠️' : '🎉'} ${checks} Hub contract checks passed${process.exitCode ? ' (with failures)' : ' successfully'}!`)

if (process.exitCode) {
  process.exit(process.exitCode)
}
