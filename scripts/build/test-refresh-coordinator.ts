import assert from 'node:assert/strict'
import { createRefreshCoordinator } from '../../tm-cms/server/utils/refreshCoordinator.js'

/**
 * The BFF renews one session token at a time. Hub rotates the refresh token, so a
 * second renewal racing with the same token is guaranteed to be rejected; these
 * checks pin the sharing, the cleanup and the retry-after-failure behaviour.
 */

let checks = 0

async function check(name: string, fn: () => Promise<void>) {
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

/** A renewal the test controls: it settles only when the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tokens = (accessToken: string) => ({ accessToken, refreshToken: `${accessToken}_refresh` })

console.log('🔍 Checking the refresh coordinator...\n')

await check('two callers with the same token share one renewal', async () => {
  const gate = deferred<ReturnType<typeof tokens>>()
  let calls = 0
  const renew = createRefreshCoordinator<string>(() => {
    calls++
    return gate.promise
  })

  const first = renew('ctx', 'token-a')
  const second = renew('ctx', 'token-a')
  assert.equal(calls, 1, `renew ran ${calls} times`)
  assert.equal(renew.pending(), 1)

  gate.resolve(tokens('fresh'))
  const [one, two] = await Promise.all([first, second])

  assert.equal(one.accessToken, 'fresh')
  assert.equal(two.accessToken, 'fresh')
  assert.equal(renew.pending(), 0, 'the shared entry was not cleared')
})

await check('different tokens renew independently', async () => {
  let calls = 0
  const renew = createRefreshCoordinator<string>(async (_ctx, token) => {
    calls++
    return tokens(token)
  })

  const [a, b] = await Promise.all([renew('ctx', 'token-a'), renew('ctx', 'token-b')])

  assert.equal(calls, 2)
  assert.equal(a.accessToken, 'token-a')
  assert.equal(b.accessToken, 'token-b')
})

await check('a failed renewal reaches every caller and is not cached', async () => {
  const gate = deferred<ReturnType<typeof tokens>>()
  let calls = 0
  const renew = createRefreshCoordinator<string>(() => {
    calls++
    return calls === 1 ? gate.promise : Promise.resolve(tokens('second-try'))
  })

  const first = renew('ctx', 'token-a')
  const second = renew('ctx', 'token-a')
  const settled = Promise.allSettled([first, second])
  gate.reject(new Error('refresh rejected'))
  const results = await settled

  assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected'])
  assert.equal(renew.pending(), 0, 'a failed renewal stayed in the map')

  const retried = await renew('ctx', 'token-a')
  assert.equal(calls, 2, 'the failure was reused instead of retried')
  assert.equal(retried.accessToken, 'second-try')
})

await check('a later request renews again instead of reusing the last result', async () => {
  let calls = 0
  const renew = createRefreshCoordinator<string>(async () => {
    calls++
    return tokens(`call-${calls}`)
  })

  assert.equal((await renew('ctx', 'token-a')).accessToken, 'call-1')
  assert.equal((await renew('ctx', 'token-a')).accessToken, 'call-2')
  assert.equal(renew.pending(), 0)
})

console.log(`\n${process.exitCode ? '⚠️' : '🎉'} ${checks} checks passed.`)
