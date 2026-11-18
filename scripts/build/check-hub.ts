const fallbackUrl = 'https://tm-hub-app.vercel.app'

const urlArg = process.argv.find((arg) => arg.startsWith('--url='))
const hubUrl = (urlArg?.slice('--url='.length) || process.env.TM_HUB_URL || fallbackUrl).replace(/\/+$/, '')

interface ProbeOptions {
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
  /** Status the Hub must answer without credentials. */
  expect: number
  verify?: (body: Record<string, unknown>) => boolean
}

const checks: { name: string, ok: boolean, detail: string }[] = []

function describe(expected: number, actual: number, verifyFailed: boolean): string {
  if (actual !== expected) return `HTTP ${actual}, expected ${expected}`
  if (verifyFailed) return `HTTP ${actual}, unexpected payload`
  return `HTTP ${actual}`
}

async function probe(path: string, options: ProbeOptions) {
  const started = Date.now()
  const method = options.method || 'GET'

  try {
    const response = await fetch(`${hubUrl}${path}`, {
      method,
      headers: options.body ? { 'content-type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    })
    const body = await response.json().catch(() => null) as Record<string, unknown> | null
    const verifyFailed = !response.ok && !body
      ? false
      : !!body && !!options.verify && !options.verify(body)
    const ok = response.status === options.expect && !verifyFailed

    checks.push({
      name: `${method} ${path}`,
      ok,
      detail: ok
        ? `HTTP ${response.status} in ${Date.now() - started}ms`
        : describe(options.expect, response.status, verifyFailed),
    })
  } catch (error) {
    checks.push({
      name: `${method} ${path}`,
      ok: false,
      detail: (error as Error).message,
    })
  }
}

console.log(`🔎 Checking TM Hub at ${hubUrl}\n`)

// Health of the deployment the CMS will actually talk to.
await probe('/api/health', {
  expect: 200,
  verify: (body) => body.success === true && typeof body.data === 'object',
})
await probe('/api/v1/health', {
  expect: 200,
  verify: (body) => {
    const data = body.data as Record<string, unknown> | undefined
    return body.success === true && data?.status === 'healthy' && data?.db === 'ok'
  },
})

// Public signing keys: RS256 tokens cannot be verified by the CMS without these.
await probe('/api/v1/auth/jwks', {
  expect: 200,
  verify: (body) => Array.isArray(body.keys) && body.keys.length > 0,
})

// The contract the CMS BFF depends on. Each route must reject an anonymous
// caller with the documented status, so a proxy that forwards without a token
// fails the same way locally and on the live deployment.
await probe('/api/v1/auth/introspect', {
  method: 'POST',
  expect: 400,
  verify: (body) => body.statusMessage === 'error.missingToken',
})
await probe('/api/v1/auth/refresh', {
  method: 'POST',
  body: {},
  expect: 400,
  verify: (body) => body.statusMessage === 'error.missingRefreshToken',
})
await probe('/api/v1/auth/me', { expect: 401 })
await probe('/api/v1/auth/sessions', { expect: 401 })
await probe('/api/v1/tenants', { expect: 401 })

for (const check of checks) {
  console.log(`${check.ok ? '✅' : '❌'} ${check.name} — ${check.detail}`)
}

const failed = checks.filter((check) => !check.ok).length
console.log(`\n${failed === 0 ? '🎉' : '⚠️ '} ${checks.length - failed}/${checks.length} checks passed`)

if (failed > 0) {
  process.exit(1)
}
