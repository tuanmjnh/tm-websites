import assert from 'node:assert/strict'
import { confirmNewsletterSubscription, getNewsletterSubscription, listNewsletterSubscriptions, NewsletterServiceError, restoreNewsletterSubscription, softDeleteNewsletterSubscription, subscribeNewsletter, unsubscribeNewsletter } from '../../tm-cms/server/services/newsletterService.js'
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

function isNewsletterError(status: number, code: string) {
  return (error: unknown) => error instanceof NewsletterServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('Newsletter consent lifecycle — double opt-in, never by accident\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_newsletter' }

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
    const { NewsletterSubscription, Audit } = models
    const meta = { audit: { model: Audit, actor: ACTOR } }

    await check('subscribing requires consent', async () => {
      await assert.rejects(
        () => subscribeNewsletter(NewsletterSubscription, SITE, { email: 'a@example.com', consent: false }, meta),
        isNewsletterError(422, 'NEWSLETTER_CONSENT_REQUIRED'),
      )
    })

    const first = await subscribeNewsletter(NewsletterSubscription, SITE, { email: 'A@Example.com', name: 'An', consent: true, source: 'footer' }, meta)
    await check('a new subscription is pending and carries a confirmation token', async () => {
      assert.equal(first.subscription.status, 'pending')
      assert.equal(first.subscription.email, 'a@example.com')
      assert.equal(first.confirmRequired, true)
      assert.ok(first.confirmToken)
    })

    await check('confirming the token promotes the subscription', async () => {
      const confirmed = await confirmNewsletterSubscription(NewsletterSubscription, SITE, first.confirmToken!, meta)
      assert.equal(confirmed.status, 'confirmed')
      assert.ok(confirmed.confirmedAt)
    })

    await check('a confirmed address re-subscribing needs no new confirmation', async () => {
      const again = await subscribeNewsletter(NewsletterSubscription, SITE, { email: 'a@example.com', consent: true }, meta)
      assert.equal(again.subscription.status, 'confirmed')
      assert.equal(again.confirmRequired, false)
      assert.equal(again.confirmToken, null)
    })

    await check('re-subscribing a pending address refreshes its token', async () => {
      const pending = await subscribeNewsletter(NewsletterSubscription, SITE, { email: 'b@example.com', consent: true }, meta)
      const token1 = pending.confirmToken!
      const refreshed = await subscribeNewsletter(NewsletterSubscription, SITE, { email: 'b@example.com', consent: true }, meta)
      assert.notEqual(refreshed.confirmToken, token1)
      await assert.rejects(
        () => confirmNewsletterSubscription(NewsletterSubscription, SITE, token1, meta),
        isNewsletterError(404, 'NEWSLETTER_TOKEN_NOT_FOUND'),
      )
      assert.equal((await confirmNewsletterSubscription(NewsletterSubscription, SITE, refreshed.confirmToken!, meta)).status, 'confirmed')
    })

    await check('unsubscribing by email closes the subscription', async () => {
      const removed = await unsubscribeNewsletter(NewsletterSubscription, SITE, { email: 'a@example.com' }, meta)
      assert.equal(removed.status, 'unsubscribed')
      assert.ok(removed.unsubscribedAt)
    })

    await check('a previously unsubscribed address must consent again to come back', async () => {
      const revived = await subscribeNewsletter(NewsletterSubscription, SITE, { email: 'a@example.com', consent: true }, meta)
      assert.equal(revived.subscription.status, 'pending')
      assert.ok(revived.confirmToken)
    })

    await check('an invalid confirmation token is rejected', async () => {
      await assert.rejects(
        () => confirmNewsletterSubscription(NewsletterSubscription, SITE, 'not-a-real-token', meta),
        isNewsletterError(404, 'NEWSLETTER_TOKEN_NOT_FOUND'),
      )
    })

    await check('unsubscribing needs an email or a token', async () => {
      await assert.rejects(
        () => unsubscribeNewsletter(NewsletterSubscription, SITE, {}, meta),
        isNewsletterError(422, 'NEWSLETTER_UNSUBSCRIBE_TARGET_REQUIRED'),
      )
    })

    await check('soft delete and restore keep the revision moving', async () => {
      const sub = await subscribeNewsletter(NewsletterSubscription, SITE, { email: 'c@example.com', consent: true }, meta)
      const live = await getNewsletterSubscription(NewsletterSubscription, SITE, sub.subscription.id)
      const removed = await softDeleteNewsletterSubscription(NewsletterSubscription, SITE, sub.subscription.id, live.revision, meta)
      assert.equal(removed.isDeleted, true)
      const restored = await restoreNewsletterSubscription(NewsletterSubscription, SITE, sub.subscription.id, removed.revision, meta)
      assert.equal(restored.isDeleted, false)
    })

    await check('a tenant only sees its own subscriptions', async () => {
      await subscribeNewsletter(NewsletterSubscription, OTHER_SITE, { email: 'z@example.com', consent: true }, meta)
      const foreign = await listNewsletterSubscriptions(NewsletterSubscription, OTHER_SITE)
      assert.equal(foreign.counts.all, 1)
      const home = await listNewsletterSubscriptions(NewsletterSubscription, SITE)
      assert.ok(home.counts.all >= 2)
      assert.equal(home.data.every(row => row.siteId === SITE), true)
    })

    await check('list counts pending, confirmed and unsubscribed separately', async () => {
      const result = await listNewsletterSubscriptions(NewsletterSubscription, SITE)
      assert.ok(typeof result.counts.pending === 'number')
      assert.ok(typeof result.counts.confirmed === 'number')
      assert.ok(typeof result.counts.unsubscribed === 'number')
      assert.equal(result.counts.all, result.counts.pending + result.counts.confirmed + result.counts.unsubscribed)
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Newsletter checks: ${checks} passed, ${notRun} not run\n`)
