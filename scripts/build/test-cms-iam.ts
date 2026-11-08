import assert from 'node:assert/strict'
import {
  HubRequestError,
  createHubTransport,
  fetchMeViaHub,
  loginViaHub,
  mapHubUser,
  refreshViaHub,
  toHubRequestError,
  totpLoginViaHub,
} from '../../tm-cms/server/utils/hubClient.js'
import type { HubAuthTransport } from '../../tm-cms/server/utils/hubClient.js'
import { evaluateMutationOrigin } from '../../tm-cms/server/utils/csrf.js'
import { isMockAuthAllowed, resolveSession } from '../../tm-cms/server/utils/context.js'
import { isHubProxyPathDenied, sanitizeHubProxyPath } from '../../tm-shared/packages/flow-utils/src/hub.js'

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

async function checkAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    checks++
    console.log(`   ✅ ${name}`)
  } catch (error) {
    console.error(`   ❌ ${name}`)
    console.error(`      ${(error as Error).message}`)
    process.exitCode = 1
  }
}

function hubError(code: string, statusCode: number) {
  return () => {
    const error = new Error(code) as Error & { statusCode?: number, data?: unknown }
    error.statusCode = statusCode
    error.data = { success: false, error: { code } }
    return Promise.reject(error)
  }
}

const CONTEXT = { appId: 'app_sentuan_cms', tenantId: 'tenant_sentuan' }

const USER = {
  id: 'user_1',
  email: 'root@example.com',
  name: 'Root',
  appId: 'app_sentuan_cms',
  roles: ['root'],
  permissions: ['*'],
  allowedRoutes: ['*'],
}

function transportWith(overrides: Partial<HubAuthTransport['auth']>): HubAuthTransport {
  return {
    auth: {
      login: async () => ({ success: true, data: {} }),
      verifyTotp: async () => ({ success: true, data: {} }),
      me: async () => ({ success: true, data: USER }),
      refresh: async () => ({ success: true, data: {} }),
      logout: async () => ({ success: true }),
      ...overrides,
    },
  }
}

console.log('IB — Hub BFF adapter (tm-hub-client)\n')

console.log('   Proxy policy')

check('proxy keeps ordinary /api/v1 business paths', () => {
  assert.equal(sanitizeHubProxyPath('api/v1/apps/app_sentuan_cms/users'), '/api/v1/apps/app_sentuan_cms/users')
  assert.equal(isHubProxyPathDenied('/api/v1/apps/app_sentuan_cms/users'), false)
})

check('proxy rejects traversal and non-v1 paths', () => {
  assert.equal(sanitizeHubProxyPath('api/v1/../secret'), null)
  assert.equal(sanitizeHubProxyPath('api/v2/apps'), null)
  assert.equal(sanitizeHubProxyPath('https://evil.test/api/v1/x'), null)
})

check('proxy denies every token-issuing auth path', () => {
  for (const path of ['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/sessions', '/api/v1/auth', '/api/v1/auth/totp/login']) {
    assert.equal(isHubProxyPathDenied(path), true, path)
  }
})

check('proxy denial does not catch lookalike prefixes', () => {
  assert.equal(isHubProxyPathDenied('/api/v1/authentic'), false)
  assert.equal(isHubProxyPathDenied('/api/v1/authn/users'), false)
})

console.log('\n   CSRF origin policy')

check('safe methods are always allowed', () => {
  assert.deepEqual(evaluateMutationOrigin({ method: 'GET', origin: 'https://evil.test', host: 'cms.test' }), { allowed: true })
})

check('same-origin mutation is allowed', () => {
  assert.deepEqual(
    evaluateMutationOrigin({ method: 'POST', origin: 'http://localhost:4005', host: 'localhost:4005' }),
    { allowed: true },
  )
})

check('cross-origin mutation is rejected', () => {
  assert.deepEqual(
    evaluateMutationOrigin({ method: 'POST', origin: 'https://evil.test', host: 'localhost:4005' }),
    { allowed: false, reason: 'origin-mismatch' },
  )
})

check('malformed origin is rejected', () => {
  assert.deepEqual(
    evaluateMutationOrigin({ method: 'POST', origin: 'not-a-url', host: 'localhost:4005' }),
    { allowed: false, reason: 'origin-mismatch' },
  )
})

check('Sec-Fetch-Site cross-site is rejected when Origin is absent', () => {
  assert.deepEqual(
    evaluateMutationOrigin({ method: 'POST', host: 'localhost:4005', secFetchSite: 'cross-site' }),
    { allowed: false, reason: 'cross-site' },
  )
})

check('non-browser client without Origin is allowed', () => {
  assert.deepEqual(evaluateMutationOrigin({ method: 'POST', host: 'localhost:4005' }), { allowed: true })
})

console.log('\n   Session mapping')

check('maps a Hub user into the session DTO', () => {
  const session = mapHubUser(USER, CONTEXT)
  assert.equal(session.id, 'user_1')
  assert.equal(session.appId, 'app_sentuan_cms')
  assert.equal(session.tenantId, 'tenant_sentuan')
  assert.deepEqual(session.permissions, ['*'])
})

check('accepts the userId alias returned by /auth/me', () => {
  const session = mapHubUser({ userId: 'user_2', email: 'a@b.test', appId: 'app_sentuan_cms' }, CONTEXT)
  assert.equal(session.id, 'user_2')
})

check('rejects a session issued for another application', () => {
  assert.throws(
    () => mapHubUser({ ...USER, appId: 'app_bagpost_cms' }, CONTEXT),
    (error: unknown) => error instanceof HubRequestError && error.code === 'APP_MISMATCH' && error.statusCode === 403,
  )
})

check('rejects an incomplete user payload', () => {
  assert.throws(
    () => mapHubUser({ appId: 'app_sentuan_cms' }, CONTEXT),
    (error: unknown) => error instanceof HubRequestError && error.code === 'HUB_INVALID_RESPONSE',
  )
})

check('rejects a deployment without a tenant binding', () => {
  assert.throws(
    () => mapHubUser(USER, { appId: 'app_sentuan_cms', tenantId: '' }),
    (error: unknown) => error instanceof HubRequestError && error.code === 'HUB_TENANT_UNCONFIGURED',
  )
})

console.log('\n   Login flows')

await checkAsync('login returns the TOTP challenge discriminant', async () => {
  const result = await loginViaHub(
    transportWith({ login: async () => ({ success: true, data: { totpRequired: true, pendingTotpToken: 'pending' } }) }),
    { email: 'root@example.com', password: 'secret123' },
    CONTEXT,
  )
  assert.deepEqual(result, { totpRequired: true, pendingTotpToken: 'pending' })
})

await checkAsync('login returns user and tokens', async () => {
  const result = await loginViaHub(
    transportWith({
      login: async () => ({ success: true, data: { accessToken: 'at', refreshToken: 'rt', user: USER } }),
    }),
    { email: 'root@example.com', password: 'secret123' },
    CONTEXT,
  )
  assert.equal(result.totpRequired, false)
  if (result.totpRequired) throw new Error('expected tokens')
  assert.equal(result.tokens.accessToken, 'at')
  assert.equal(result.user.email, 'root@example.com')
})

await checkAsync('login without tokens fails as an invalid Hub response', async () => {
  await assert.rejects(
    loginViaHub(transportWith({ login: async () => ({ success: true, data: { user: USER } }) }), { email: 'a@b.test', password: 'secret123' }, CONTEXT),
    (error: unknown) => error instanceof HubRequestError && error.code === 'HUB_INVALID_RESPONSE',
  )
})

await checkAsync('TOTP login maps user and tokens', async () => {
  const result = await totpLoginViaHub(
    transportWith({ verifyTotp: async () => ({ success: true, data: { accessToken: 'at2', refreshToken: 'rt2', user: USER } }) }),
    { pendingTotpToken: 'pending', code: '123456' },
    CONTEXT,
  )
  assert.equal(result.tokens.accessToken, 'at2')
  assert.equal(result.user.id, 'user_1')
})

await checkAsync('TOTP login keeps the Hub status code for a wrong code', async () => {
  await assert.rejects(
    totpLoginViaHub(transportWith({ verifyTotp: hubError('INVALID_CODE', 400) }), { pendingTotpToken: 'p', code: '000000' }, CONTEXT),
    (error: unknown) => error instanceof HubRequestError && error.statusCode === 400,
  )
})

await checkAsync('session read propagates a 401 so the BFF can refresh', async () => {
  await assert.rejects(
    fetchMeViaHub(transportWith({ me: hubError('UNAUTHENTICATED', 401) }), CONTEXT),
    (error: unknown) => error instanceof HubRequestError && error.statusCode === 401,
  )
})

await checkAsync('refresh rejects a payload without an access token', async () => {
  await assert.rejects(
    refreshViaHub(transportWith({ refresh: async () => ({ success: true, data: {} }) }), 'rt'),
    (error: unknown) => error instanceof HubRequestError && error.code === 'REFRESH_FAILED',
  )
})

console.log('\n   Transport isolation')

await checkAsync('transport sends app id and the caller token', async () => {
  const seen: Headers[] = []
  const transport = createHubTransport({
    baseUrl: 'http://hub.test',
    appId: 'app_sentuan_cms',
    accessToken: 'token-a',
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers))
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
    }) as typeof globalThis.fetch,
  })

  await transport.auth.me()

  assert.equal(seen[0]?.get('x-app-id'), 'app_sentuan_cms')
  assert.equal(seen[0]?.get('authorization'), 'Bearer token-a')
})

await checkAsync('a transport built without a token sends no Authorization header', async () => {
  const seen: Headers[] = []
  const transport = createHubTransport({
    baseUrl: 'http://hub.test',
    appId: 'app_sentuan_cms',
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers))
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
    }) as typeof globalThis.fetch,
  })

  await transport.auth.refresh('rt')

  assert.equal(seen[0]?.get('authorization'), null)
  assert.equal(seen[0]?.get('x-app-id'), 'app_sentuan_cms')
})

console.log('\n   Verified context')

await checkAsync('a valid access token resolves without refreshing', async () => {
  let refreshCalls = 0
  const result = await resolveSession({
    accessToken: 'live',
    refreshToken: 'rt',
    fetchMe: async () => mapHubUser(USER, CONTEXT),
    refresh: async () => {
      refreshCalls++
      return { accessToken: 'new' }
    },
  })
  assert.equal(result.user.id, 'user_1')
  assert.equal(result.tokens, undefined)
  assert.equal(refreshCalls, 0)
})

await checkAsync('an expired access token is refreshed once', async () => {
  const seen: string[] = []
  const result = await resolveSession({
    accessToken: 'expired',
    refreshToken: 'rt',
    fetchMe: async (token) => {
      seen.push(token)
      if (token === 'expired') throw new HubRequestError(401, 'UNAUTHENTICATED', 'expired')
      return mapHubUser(USER, CONTEXT)
    },
    refresh: async () => ({ accessToken: 'fresh', refreshToken: 'rt2' }),
  })

  assert.deepEqual(seen, ['expired', 'fresh'])
  assert.equal(result.tokens?.accessToken, 'fresh')
})

await checkAsync('session expiry without a refresh token fails as unauthenticated', async () => {
  await assert.rejects(
    resolveSession({
      accessToken: 'expired',
      refreshToken: '',
      fetchMe: async () => {
        throw new HubRequestError(401, 'UNAUTHENTICATED', 'expired')
      },
      refresh: async () => ({ accessToken: 'fresh' }),
    }),
    (error: unknown) => error instanceof HubRequestError && error.statusCode === 401,
  )
})

await checkAsync('an app mismatch is not retried with a refresh', async () => {
  let refreshCalls = 0
  await assert.rejects(
    resolveSession({
      accessToken: 'live',
      refreshToken: 'rt',
      fetchMe: async () => {
        throw new HubRequestError(403, 'APP_MISMATCH', 'wrong app')
      },
      refresh: async () => {
        refreshCalls++
        return { accessToken: 'fresh' }
      },
    }),
    (error: unknown) => error instanceof HubRequestError && error.code === 'APP_MISMATCH',
  )
  assert.equal(refreshCalls, 0)
})

await checkAsync('an unreachable Hub fails closed without clearing cookies', async () => {
  await assert.rejects(
    resolveSession({
      accessToken: 'live',
      refreshToken: 'rt',
      fetchMe: async () => {
        throw new HubRequestError(503, 'HUB_UNAVAILABLE', 'down')
      },
      refresh: async () => ({ accessToken: 'fresh' }),
    }),
    (error: unknown) => error instanceof HubRequestError && error.statusCode === 503,
  )
})

check('mock auth is refused in production', () => {
  assert.equal(isMockAuthAllowed('mock', 'development'), true)
  assert.equal(isMockAuthAllowed('mock', 'test'), true)
  assert.equal(isMockAuthAllowed('mock', 'production'), false)
  assert.equal(isMockAuthAllowed('hub', 'development'), false)
})

console.log('\n   Error translation')

check('network failure becomes a 503', () => {
  const translated = toHubRequestError(new Error('fetch failed'))
  assert.equal(translated.statusCode, 503)
  assert.equal(translated.code, 'HUB_UNAVAILABLE')
})

check('upstream status and code are preserved', () => {
  const translated = toHubRequestError({
    statusCode: 429,
    data: { error: { code: 'RATE_LIMITED' }, message: 'slow down' },
  })
  assert.equal(translated.statusCode, 429)
  assert.equal(translated.code, 'RATE_LIMITED')
  assert.equal(translated.message, 'slow down')
})

check('an existing HubRequestError is returned unchanged', () => {
  const original = new HubRequestError(403, 'APP_MISMATCH', 'mismatch')
  assert.equal(toHubRequestError(original), original)
})

console.log(`\n${process.exitCode ? '❌' : '✅'} IAM checks: ${checks} passed\n`)
