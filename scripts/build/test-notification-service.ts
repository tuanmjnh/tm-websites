import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
import {
  NotificationServiceError,
  archiveNotification,
  dispatchNotification,
  getNotification,
  listNotificationSubscriptions,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  setNotificationSubscription,
} from '../../tm-cms/server/services/notificationService.js'
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

function isNotificationError(status: number, code: string) {
  return (error: unknown) => error instanceof NotificationServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const RECIPIENT = 'subject-1'
const OTHER_RECIPIENT = 'subject-2'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('Notifications — a recipient-owned inbox with idempotent delivery (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_notification_service')

async function integration() {
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
    const { Notification, NotificationSubscription, Audit } = await prepareDatabase(connection)
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const first = await dispatchNotification(Notification, NotificationSubscription, SITE, {
      recipientId: RECIPIENT,
      type: 'order.paid',
      title: 'Đơn hàng đã thanh toán',
      body: 'Đơn ORD-1 đã được thanh toán.',
      link: '/admin/orders/1',
      severity: 'info',
      dedupeKey: 'order.paid:ord-1',
      data: { orderCode: 'ORD-1' },
    }, meta)

    await check('a dispatch lands in the recipient inbox unread', async () => {
      assert.equal(first.created, true)
      assert.equal(first.skipped, null)
      assert.equal(first.notification!.status, 'unread')
      assert.equal(first.notification!.readAt, null)
      assert.deepEqual(first.notification!.data, { orderCode: 'ORD-1' })

      const inbox = await listNotifications(Notification, SITE, RECIPIENT)
      assert.equal(inbox.data.length, 1)
      assert.deepEqual(inbox.counts, { all: 1, unread: 1, read: 0, archived: 0 })
    })

    await check('the same dedupe key never adds a second copy', async () => {
      const again = await dispatchNotification(Notification, NotificationSubscription, SITE, {
        recipientId: RECIPIENT,
        type: 'order.paid',
        title: 'Đơn hàng đã thanh toán',
        dedupeKey: 'order.paid:ord-1',
      }, meta)

      assert.equal(again.created, false)
      assert.equal(again.notification!.id, first.notification!.id)
      assert.equal(await Notification.countDocuments({ siteId: SITE }), 1)
    })

    await check('another recipient gets their own copy of the same event', async () => {
      const separate = await dispatchNotification(Notification, NotificationSubscription, SITE, {
        recipientId: OTHER_RECIPIENT,
        type: 'order.paid',
        title: 'Đơn hàng đã thanh toán',
        dedupeKey: 'order.paid:ord-1',
      }, meta)

      assert.equal(separate.created, true)
      assert.notEqual(separate.notification!.id, first.notification!.id)
      const theirs = await listNotifications(Notification, SITE, OTHER_RECIPIENT)
      assert.equal(theirs.data.length, 1)
    })

    await check('an absolute link is refused so an inbox cannot redirect off-site', async () => {
      for (const link of ['https://evil.example/x', '//evil.example/x', 'javascript:alert(1)']) {
        await assert.rejects(
          () => dispatchNotification(Notification, NotificationSubscription, SITE, {
            recipientId: RECIPIENT,
            type: 'order.paid',
            title: 'Đơn hàng',
            link,
          }, meta),
          isNotificationError(422, 'NOTIFICATION_LINK_INVALID'),
        )
      }
    })

    await check('an empty title and an oversized payload are refused', async () => {
      await assert.rejects(
        () => dispatchNotification(Notification, NotificationSubscription, SITE, {
          recipientId: RECIPIENT,
          type: 'order.paid',
          title: '   ',
        }, meta),
        isNotificationError(422, 'NOTIFICATION_PAYLOAD_INVALID'),
      )

      const bulky = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`k${index}`, index]))
      await assert.rejects(
        () => dispatchNotification(Notification, NotificationSubscription, SITE, {
          recipientId: RECIPIENT,
          type: 'order.paid',
          title: 'Đơn hàng',
          data: bulky,
        }, meta),
        isNotificationError(422, 'NOTIFICATION_DATA_TOO_LARGE'),
      )
    })

    await check('one recipient cannot read, mark or archive another one\'s notification', async () => {
      const id = first.notification!.id
      await assert.rejects(() => getNotification(Notification, SITE, OTHER_RECIPIENT, id), isNotificationError(404, 'NOTIFICATION_NOT_FOUND'))
      await assert.rejects(() => markNotificationRead(Notification, SITE, OTHER_RECIPIENT, id), isNotificationError(404, 'NOTIFICATION_NOT_FOUND'))
      await assert.rejects(() => archiveNotification(Notification, SITE, OTHER_RECIPIENT, id), isNotificationError(404, 'NOTIFICATION_NOT_FOUND'))

      const stillUnread = await getNotification(Notification, SITE, RECIPIENT, id)
      assert.equal(stillUnread.status, 'unread', 'the owner\'s row was untouched')
    })

    await check('marking read is idempotent and keeps the first timestamp', async () => {
      const read = await markNotificationRead(Notification, SITE, RECIPIENT, first.notification!.id)
      assert.equal(read.status, 'read')
      assert.ok(read.readAt)

      const again = await markNotificationRead(Notification, SITE, RECIPIENT, first.notification!.id)
      assert.equal(again.readAt, read.readAt)

      const counts = (await listNotifications(Notification, SITE, RECIPIENT)).counts
      assert.deepEqual(counts, { all: 1, unread: 0, read: 1, archived: 0 })
    })

    await check('mark all read scopes to the caller and honours a type filter', async () => {
      for (let index = 0; index < 3; index++) {
        await dispatchNotification(Notification, NotificationSubscription, SITE, {
          recipientId: RECIPIENT,
          type: index === 0 ? 'stock.low' : 'order.paid',
          title: `Sự kiện ${index}`,
        }, meta)
      }
      // The other recipient still has one unread row of their own.
      await dispatchNotification(Notification, NotificationSubscription, SITE, {
        recipientId: OTHER_RECIPIENT,
        type: 'stock.low',
        title: 'Sắp hết hàng',
      }, meta)

      const byType = await markAllNotificationsRead(Notification, SITE, RECIPIENT, { type: 'stock.low' })
      assert.equal(byType.updated, 1)
      const afterType = await listNotifications(Notification, SITE, RECIPIENT)
      assert.deepEqual(afterType.counts, { all: 4, unread: 2, read: 2, archived: 0 })

      const rest = await markAllNotificationsRead(Notification, SITE, RECIPIENT)
      assert.equal(rest.updated, 2)
      assert.deepEqual((await listNotifications(Notification, SITE, RECIPIENT)).counts, { all: 4, unread: 0, read: 4, archived: 0 })

      const theirs = await listNotifications(Notification, SITE, OTHER_RECIPIENT)
      assert.equal(theirs.counts.unread, 2, 'the other inbox was not swept')
    })

    await check('archived rows leave the inbox and archived is an explicit view', async () => {
      const archived = await archiveNotification(Notification, SITE, RECIPIENT, first.notification!.id)
      assert.equal(archived.status, 'archived')
      assert.ok(archived.archivedAt)

      const inbox = await listNotifications(Notification, SITE, RECIPIENT)
      assert.equal(inbox.data.length, 3)
      assert.deepEqual(inbox.counts, { all: 4, unread: 0, read: 3, archived: 1 })

      const archivedView = await listNotifications(Notification, SITE, RECIPIENT, { status: 'archived' })
      assert.deepEqual(archivedView.data.map(row => row.id), [first.notification!.id])

      const again = await archiveNotification(Notification, SITE, RECIPIENT, first.notification!.id)
      assert.equal(again.archivedAt, archived.archivedAt)
    })

    await check('a muted type is skipped without storing anything', async () => {
      const muted = await setNotificationSubscription(NotificationSubscription, SITE, RECIPIENT, 'marketing.promo', false, meta)
      assert.equal(muted.enabled, false)

      const subscriptions = await listNotificationSubscriptions(NotificationSubscription, SITE, RECIPIENT)
      assert.deepEqual(subscriptions.map(row => [row.type, row.enabled]), [['marketing.promo', false]])

      const before = await Notification.countDocuments({ siteId: SITE })
      const skipped = await dispatchNotification(Notification, NotificationSubscription, SITE, {
        recipientId: RECIPIENT,
        type: 'marketing.promo',
        title: 'Khuyến mãi',
      }, meta)
      assert.equal(skipped.skipped, 'muted')
      assert.equal(skipped.notification, null)
      assert.equal(skipped.created, false)
      assert.equal(await Notification.countDocuments({ siteId: SITE }), before)

      // A mute applies to one type only.
      const other = await dispatchNotification(Notification, NotificationSubscription, SITE, {
        recipientId: RECIPIENT,
        type: 'order.paid',
        title: 'Đơn hàng đã thanh toán',
      }, meta)
      assert.equal(other.created, true)
    })

    await check('re-enabling deletes the mute and delivery resumes', async () => {
      const enabled = await setNotificationSubscription(NotificationSubscription, SITE, RECIPIENT, 'marketing.promo', true, meta)
      assert.equal(enabled.enabled, true)
      assert.equal(await NotificationSubscription.countDocuments({ siteId: SITE, recipientId: RECIPIENT }), 0)
      assert.deepEqual(await listNotificationSubscriptions(NotificationSubscription, SITE, RECIPIENT), [])

      const delivered = await dispatchNotification(Notification, NotificationSubscription, SITE, {
        recipientId: RECIPIENT,
        type: 'marketing.promo',
        title: 'Khuyến mãi',
      }, meta)
      assert.equal(delivered.created, true)
    })

    await check('an invalid subscription type or state is refused', async () => {
      await assert.rejects(
        () => setNotificationSubscription(NotificationSubscription, SITE, RECIPIENT, 'Bad Type', false, meta),
        isNotificationError(422, 'NOTIFICATION_TYPE_INVALID'),
      )
      await assert.rejects(
        () => setNotificationSubscription(NotificationSubscription, SITE, RECIPIENT, 'order.paid', 'no' as unknown as boolean, meta),
        isNotificationError(422, 'NOTIFICATION_SUBSCRIPTION_INVALID'),
      )
    })

    await check('the inbox pages newest first with a stable cursor', async () => {
      const page = await listNotifications(Notification, SITE, RECIPIENT, { limit: 2 })
      assert.equal(page.data.length, 2)
      assert.equal(page.hasMore, true)
      assert.equal(page.counts.all, 6)

      const next = await listNotifications(Notification, SITE, RECIPIENT, { limit: 2, cursor: page.nextCursor ?? undefined })
      assert.equal(next.data.length, 2)
      const ids = [...page.data, ...next.data].map(row => row.id)
      assert.equal(new Set(ids).size, 4, 'pages do not overlap')
      assert.ok(page.data[0]!.createdAt! >= page.data[1]!.createdAt!)
    })

    await check('notifications are site-scoped', async () => {
      assert.deepEqual((await listNotifications(Notification, OTHER_SITE, RECIPIENT)).data, [])
      await assert.rejects(
        () => getNotification(Notification, OTHER_SITE, RECIPIENT, first.notification!.id),
        isNotificationError(404, 'NOTIFICATION_NOT_FOUND'),
      )
    })

    await check('dispatch and preferences are audited, read receipts are not', async () => {
      const dispatchRows = await Audit.find({ siteId: SITE, resourceType: 'notification', action: 'create' }).lean<{ toStatus: string }[]>()
      assert.ok(dispatchRows.length >= 6)
      assert.ok(dispatchRows.some(row => row.toStatus === 'muted'), 'a skipped dispatch is still visible to the operator')

      const preferenceRows = await Audit.find({ siteId: SITE, resourceType: 'notification_subscription' })
        .sort({ _id: 1 })
        .lean<{ fromStatus: string, toStatus: string }[]>()
      assert.deepEqual(preferenceRows.map(row => [row.fromStatus, row.toStatus]), [['enabled', 'muted'], ['muted', 'enabled']])

      const auditBefore = await Audit.countDocuments({ siteId: SITE })
      const target = (await listNotifications(Notification, SITE, RECIPIENT)).data.find(row => row.status === 'read' && !row.archivedAt)!
      await markNotificationRead(Notification, SITE, RECIPIENT, target.id)
      await archiveNotification(Notification, SITE, RECIPIENT, target.id)
      assert.equal(await Audit.countDocuments({ siteId: SITE }), auditBefore, 'inbox state changes write no audit row')
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} Notification checks: ${checks} passed, ${notRun} not run\n`)
