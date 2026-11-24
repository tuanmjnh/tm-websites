import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
import { MailAnalyticsError } from '../../tm-cms/server/services/mailAnalyticsService.js'
import { mailDeliveryAnalytics, resolveMailRange } from '../../tm-cms/server/services/mailAnalyticsService.js'
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

function isMailAnalyticsError(status: number, code: string) {
  return (error: unknown) => error instanceof MailAnalyticsError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const NOW = new Date('2026-11-15T05:00:00.000Z')

console.log('Mail analytics — the queue, the templates, the failures, and what is stuck\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_mail_analytics')

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
    await dropTestDatabase(connection)
    const models = await prepareDatabase(connection)
    const { MailDelivery } = models

    const queue = (overrides: Record<string, unknown>) => MailDelivery.create({
      siteId: SITE,
      templateCode: 'WELCOME',
      recipientEmail: 'a@example.com',
      subject: 'Xin chào',
      nextAttemptAt: NOW,
      createdAt: NOW,
      ...overrides,
    })

    await queue({ status: 'queued', templateCode: 'WELCOME', lastError: null })
    await queue({ status: 'queued', templateCode: 'NEWS', nextAttemptAt: new Date(NOW.getTime() + 60 * 60 * 1000), lastError: null })
    await queue({ status: 'sending', templateCode: 'WELCOME', nextAttemptAt: NOW })
    await queue({ status: 'sent', templateCode: 'WELCOME', sentAt: NOW, lastError: null })
    await queue({ status: 'sent', templateCode: 'NEWS', sentAt: NOW, lastError: null })
    await queue({ status: 'failed', templateCode: 'WELCOME', lastError: 'SMTP 550 mailbox unavailable' })
    await queue({ status: 'failed', templateCode: 'NEWS', lastError: 'SMTP 550 mailbox unavailable' })
    await queue({ status: 'cancelled', templateCode: 'NEWS', lastError: null })
    await queue({ siteId: OTHER_SITE, status: 'sent', templateCode: 'WELCOME', recipientEmail: 'b@example.com' })

    await check('totals and per-template counts match the queue', async () => {
      const analytics = await mailDeliveryAnalytics(MailDelivery, SITE, { now: NOW })
      assert.deepEqual(analytics.totals, { all: 8, queued: 2, sending: 1, sent: 2, failed: 2, cancelled: 1 })
      const welcome = analytics.byTemplate.find(row => row.templateCode === 'WELCOME')!
      assert.equal(welcome.all, 4)
      assert.equal(welcome.sent, 1)
      assert.equal(welcome.failed, 1)
      const news = analytics.byTemplate.find(row => row.templateCode === 'NEWS')!
      assert.equal(news.all, 4)
      assert.equal(news.cancelled, 1)
    })

    await check('queue health says what is due and how old the oldest item is', async () => {
      const analytics = await mailDeliveryAnalytics(MailDelivery, SITE, { now: NOW })
      assert.equal(analytics.queueHealth.dueNow, 1)
      assert.equal(analytics.queueHealth.sending, 1)
      assert.ok(analytics.queueHealth.oldestQueuedAt)
      assert.equal(analytics.queueHealth.oldestQueuedAgeMinutes, 0)
    })

    await check('failure reasons are grouped and ranked', async () => {
      const analytics = await mailDeliveryAnalytics(MailDelivery, SITE, { now: NOW })
      assert.deepEqual(analytics.failureReasons, [{ reason: 'SMTP 550 mailbox unavailable', count: 2 }])
    })

    await check('a tenant only sees its own mail', async () => {
      const analytics = await mailDeliveryAnalytics(MailDelivery, OTHER_SITE, { now: NOW })
      assert.equal(analytics.totals.all, 1)
      assert.equal(analytics.totals.sent, 1)
    })

    await check('range validation refuses bad dates', async () => {
      await assert.rejects(
        () => mailDeliveryAnalytics(MailDelivery, SITE, { from: '2026-02-31', to: '2026-03-01', now: NOW }),
        isMailAnalyticsError(422, 'MAIL_RANGE_INVALID'),
      )
      await assert.rejects(
        () => mailDeliveryAnalytics(MailDelivery, SITE, { from: '2026-11-15', to: '2026-11-01', now: NOW }),
        isMailAnalyticsError(422, 'MAIL_RANGE_INVALID'),
      )
      await assert.rejects(
        () => mailDeliveryAnalytics(MailDelivery, SITE, { from: '2024-01-01', to: '2026-01-01', now: NOW }),
        isMailAnalyticsError(422, 'MAIL_RANGE_TOO_LONG'),
      )
    })

    await check('resolveMailRange defaults to the last 30 days', async () => {
      const range = resolveMailRange(undefined, undefined, NOW)
      assert.equal(range.to, '2026-11-15')
      assert.equal(range.from, '2026-10-17')
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Mail analytics checks: ${checks} passed, ${notRun} not run\n`)
