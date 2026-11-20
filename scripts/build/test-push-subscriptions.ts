import assert from 'node:assert/strict'
import {
  PushSubscriptionServiceError,
  subscribePushSubscription,
  unsubscribePushSubscription,
  listPushSubscriptions,
} from '../../tm-cms/server/services/pushSubscriptionService.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'

let checks = 0
let notRun = 0

async function check(name: string, fn: () => Promise<void> | void) {
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

const SITE = 'sentuan'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }
const RECIPIENT = 'hub-subject-push'

console.log('Push subscriptions — recipient-owned endpoints\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_push_subscriptions' }

async function run() {
  let connection
  try {
    connection = await connectDatabase(binding)
  } catch {
    notRun++
    console.log(`   ⚠️  NOT RUN — no MongoDB reachable at ${URI}`)
    return
  }

  try {
    await connection.db!.dropDatabase()
    const models = await prepareDatabase(connection)
    const { PushSubscription, Audit } = models
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const sub = await subscribePushSubscription(PushSubscription, SITE, RECIPIENT, {
      endpoint: 'https://push.example.com/sub/1',
      p256dh: 'pkey',
      auth: 'authkey',
      userAgent: 'Chrome',
    }, meta)

    await check('subscribe stores the endpoint', async () => {
      assert.equal(sub.recipientId, RECIPIENT)
      assert.equal(sub.endpoint, 'https://push.example.com/sub/1')
      const list = await listPushSubscriptions(PushSubscription, SITE, RECIPIENT)
      assert.equal(list.length, 1)
    })

    await check('re-subscribing the same endpoint upserts', async () => {
      const again = await subscribePushSubscription(PushSubscription, SITE, RECIPIENT, {
        endpoint: 'https://push.example.com/sub/1',
        p256dh: 'pkey2',
        auth: 'authkey2',
      }, meta)
      assert.equal(again.p256dh, 'pkey2')
      const list = await listPushSubscriptions(PushSubscription, SITE, RECIPIENT)
      assert.equal(list.length, 1)
    })

    await check('another recipient cannot hijack an endpoint', async () => {
      await assert.rejects(
        () => subscribePushSubscription(PushSubscription, SITE, 'other-recipient', {
          endpoint: 'https://push.example.com/sub/1',
          p256dh: 'x',
          auth: 'y',
        }, meta),
        (error: unknown) => error instanceof PushSubscriptionServiceError && error.code === 'PUSH_SUBSCRIPTION_OWNED_BY_OTHER',
      )
    })

    await check('unsubscribe removes the endpoint', async () => {
      const result = await unsubscribePushSubscription(PushSubscription, SITE, RECIPIENT, 'https://push.example.com/sub/1', meta)
      assert.equal(result.removed, true)
      const list = await listPushSubscriptions(PushSubscription, SITE, RECIPIENT)
      assert.equal(list.length, 0)
    })

    await check('unsubscribing a missing endpoint is a no-op', async () => {
      const result = await unsubscribePushSubscription(PushSubscription, SITE, RECIPIENT, 'https://push.example.com/nope', meta)
      assert.equal(result.removed, false)
    })

    await check('subscriptions are site-scoped', async () => {
      await subscribePushSubscription(PushSubscription, SITE, RECIPIENT, {
        endpoint: 'https://push.example.com/sub/2',
        p256dh: 'p',
        auth: 'a',
      }, meta)
      const other = await listPushSubscriptions(PushSubscription, 'other-site', RECIPIENT)
      assert.equal(other.length, 0)
    })

    await check('payload validation rejects bad endpoints', async () => {
      await assert.rejects(
        () => subscribePushSubscription(PushSubscription, SITE, RECIPIENT, {
          endpoint: 'not-a-url',
          p256dh: 'p',
          auth: 'a',
        }, meta),
        (error: unknown) => error instanceof PushSubscriptionServiceError && error.code === 'PUSH_SUBSCRIPTION_PAYLOAD_INVALID',
      )
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Push subscription checks: ${checks} passed, ${notRun} not run\n`)