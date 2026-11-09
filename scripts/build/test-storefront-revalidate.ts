import assert from 'node:assert/strict'
import {
  STOREFRONT_PURGE_PATH,
  parseRevalidateTarget,
  revalidateStorefront,
  storefrontPurgeUrl,
} from '../../tm-cms/server/utils/storefrontRevalidate.js'

/**
 * Contract for the CMS -> storefront cache purge.
 *
 * The save already succeeded by the time this runs, so every failure mode has to
 * come back as a value: an unconfigured site must not call anything, a wrong
 * secret must not throw, and a refused/failed request must not spread into the
 * admin response.
 */

let checks = 0

function check(name: string, fn: () => void | Promise<void>) {
  const run = async () => {
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
  return run()
}

interface Call {
  url: string
  init: RequestInit
}

function stubFetch(response: Response | Error): { calls: Call[], fetchImpl: typeof fetch } {
  const calls: Call[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    if (response instanceof Error) throw response
    return response
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const target = { baseUrl: 'http://localhost:4006', secret: 'probe-secret' }

await check('an unconfigured pair (either half missing) is never called', async () => {
  for (const [url, secret] of [['', 's'], ['http://localhost:4006', ''], [undefined, 's'], ['http://localhost:4006', undefined]]) {
    assert.equal(parseRevalidateTarget(url, secret), null)
  }
  const { calls, fetchImpl } = stubFetch(new Response('{}'))
  const result = await revalidateStorefront(null, { reason: 'settings.update', fetchImpl })
  assert.deepEqual(result, { attempted: false, ok: false, outcome: 'not-configured' })
  assert.equal(calls.length, 0)
})

await check('a non-http scheme is refused instead of being fetched', async () => {
  assert.equal(parseRevalidateTarget('ftp://localhost:4006', 's'), null)
  assert.equal(parseRevalidateTarget('not a url', 's'), null)
})

await check('the base URL is normalized and the secret trimmed', async () => {
  const parsed = parseRevalidateTarget(' http://localhost:4006/ ', '  probe-secret ')
  assert.deepEqual(parsed, { baseUrl: 'http://localhost:4006', secret: 'probe-secret' })
  assert.equal(storefrontPurgeUrl(parsed!), `http://localhost:4006${STOREFRONT_PURGE_PATH}`)
})

await check('a base URL with a path prefix keeps it', async () => {
  const parsed = parseRevalidateTarget('https://site.test/base/', 's')
  assert.equal(storefrontPurgeUrl(parsed!), `https://site.test/base${STOREFRONT_PURGE_PATH}`)
})

await check('a 2xx purge posts the secret header and the reason', async () => {
  const { calls, fetchImpl } = stubFetch(new Response('{"success":true}', { status: 200 }))
  const result = await revalidateStorefront(target, { reason: 'menu.update', fetchImpl })
  assert.deepEqual(result, { attempted: true, ok: true, outcome: 'revalidated', status: 200 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.url, `http://localhost:4006${STOREFRONT_PURGE_PATH}`)
  assert.equal(calls[0]!.init.method, 'POST')
  const headers = calls[0]!.init.headers as Record<string, string>
  assert.equal(headers['x-revalidate-secret'], 'probe-secret')
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { reason: 'menu.update' })
  assert.ok(calls[0]!.init.signal instanceof AbortSignal, 'the request carries a timeout signal')
})

await check('a refused purge is reported, not thrown', async () => {
  const { fetchImpl } = stubFetch(new Response('{"code":"INVALID_REVALIDATE_SECRET"}', { status: 401 }))
  const result = await revalidateStorefront(target, { reason: 'settings.update', fetchImpl })
  assert.equal(result.attempted, true)
  assert.equal(result.ok, false)
  assert.equal(result.outcome, 'http-error')
  assert.equal(result.status, 401)
  assert.equal(result.detail, 'HTTP 401')
})

await check('a storefront that is down is reported, not thrown', async () => {
  const { fetchImpl } = stubFetch(new Error('connect ECONNREFUSED'))
  const result = await revalidateStorefront(target, { reason: 'menu.create', fetchImpl })
  assert.equal(result.attempted, true)
  assert.equal(result.ok, false)
  assert.equal(result.outcome, 'request-failed')
  assert.match(String(result.detail), /ECONNREFUSED/)
})

await check('the caller can shorten the timeout without changing the contract', async () => {
  const { calls, fetchImpl } = stubFetch(new Response('{}', { status: 200 }))
  await revalidateStorefront(target, { reason: 'menu.delete', fetchImpl, timeoutMs: 50 })
  assert.equal(calls.length, 1)
})

console.log(`\n${checks} checks`)
if (process.exitCode) {
  console.error(`\n${checks} passed, some failed`)
} else {
  console.log('All storefront revalidation checks passed')
}
