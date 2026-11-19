import assert from 'node:assert/strict'
import {
  MailServiceError,
  cancelDelivery,
  createMailTemplate,
  drainMailQueue,
  getMailDelivery,
  getMailTemplate,
  listMailDeliveries,
  listMailTemplates,
  queueMail,
  retryDelivery,
  sendDelivery,
  softDeleteMailTemplate,
  updateMailTemplate,
  restoreMailTemplate,
} from '../../tm-cms/server/services/mailService.js'
import { MailTransportError, resolveMailTransport } from '../../tm-cms/server/services/mailTransport.js'
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

function isMailError(status: number, code: string) {
  return (error: unknown) => error instanceof MailServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('Mail — templates, a delivery queue and an explicit provider boundary (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_mail_service' }

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
    await connection.db!.dropDatabase()
    const { MailTemplate, MailDelivery, Audit } = await prepareDatabase(connection)
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const template = await createMailTemplate(MailTemplate, SITE, {
      code: 'order.paid',
      locale: 'vi',
      title: 'Đơn hàng đã thanh toán',
      subject: 'Đơn {{orderCode}} đã thanh toán',
      bodyText: 'Xin chào {{name}}, đơn {{orderCode}} đã được thanh toán.',
      bodyHtml: '<p>Xin chào <strong>{{name}}</strong>, đơn {{orderCode}} đã được thanh toán.</p>',
      variables: ['orderCode', 'name'],
      purpose: 'transactional',
      status: 'active',
    }, meta)

    await check('a template is created active with the variables it declares', async () => {
      assert.equal(template.status, 'active')
      assert.deepEqual(template.variables, ['orderCode', 'name'])
      assert.equal(template.revision, 1)

      const listed = await listMailTemplates(MailTemplate, SITE)
      assert.equal(listed.data.length, 1)
      assert.deepEqual(listed.counts, { all: 1, draft: 0, active: 1, archived: 0 })
    })

    await check('an empty body, an undeclared variable and a duplicate code are refused', async () => {
      await assert.rejects(
        () => createMailTemplate(MailTemplate, SITE, {
          code: 'empty.body',
          title: 'Rỗng',
          subject: 'Rỗng',
          status: 'active',
        }, meta),
        isMailError(422, 'MAIL_TEMPLATE_BODY_REQUIRED'),
      )

      await assert.rejects(
        () => createMailTemplate(MailTemplate, SITE, {
          code: 'undeclared.var',
          title: 'Thiếu khai báo',
          subject: 'Xin chào {{name}}',
          bodyText: 'Nội dung',
          variables: [],
        }, meta),
        isMailError(422, 'MAIL_TEMPLATE_VARIABLE_UNDECLARED'),
      )

      await assert.rejects(
        () => createMailTemplate(MailTemplate, SITE, {
          code: 'order.paid',
          locale: 'vi',
          title: 'Trùng',
          subject: 'Trùng',
          bodyText: 'Nội dung',
        }, meta),
        isMailError(409, 'MAIL_TEMPLATE_CODE_EXISTS'),
      )
    })

    await check('an update bumps the revision and a stale revision is refused', async () => {
      const updated = await updateMailTemplate(MailTemplate, SITE, template.id, {
        revision: 1,
        title: 'Đơn hàng đã thanh toán (mới)',
      }, meta)
      assert.equal(updated.revision, 2)
      assert.equal(updated.subject, template.subject, 'fields not sent are kept')

      await assert.rejects(
        () => updateMailTemplate(MailTemplate, SITE, template.id, { revision: 1, title: 'Cũ' }, meta),
        isMailError(409, 'MAIL_TEMPLATE_REVISION_CONFLICT'),
      )
    })

    const queued = await queueMail(MailDelivery, MailTemplate, SITE, {
      templateCode: 'order.paid',
      to: 'Customer@Example.com',
      recipientSubjectId: 'subject-1',
      variables: { orderCode: 'ORD-1', name: '<script>alert(1)</script>' },
      dedupeKey: 'order.paid:ORD-1',
    }, meta)

    await check('a queued message is rendered and snapshotted', async () => {
      assert.equal(queued.created, true)
      const delivery = queued.delivery
      assert.equal(delivery.status, 'queued')
      assert.equal(delivery.to, 'customer@example.com', 'addresses are normalised')
      assert.equal(delivery.subject, 'Đơn ORD-1 đã thanh toán')
      assert.equal(delivery.attempts, 0)

      const stored = await MailDelivery.findById(delivery.id).lean<{ bodyText: string, bodyHtml: string, subject: string }>()
      assert.match(stored!.bodyText, /Xin chào <script>alert\(1\)<\/script>/, 'the text body carries the raw value')
      assert.match(stored!.bodyHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'the HTML body escapes it')

      // A later template edit must not rewrite a message that already exists.
      await updateMailTemplate(MailTemplate, SITE, template.id, { revision: 2, subject: 'Đổi tiêu đề {{orderCode}}' }, meta)
      const after = await getMailDelivery(MailDelivery, SITE, delivery.id)
      assert.equal(after.subject, 'Đơn ORD-1 đã thanh toán')
    })

    await check('the same recipient and dedupe key never queues twice', async () => {
      const again = await queueMail(MailDelivery, MailTemplate, SITE, {
        templateCode: 'order.paid',
        to: 'customer@example.com',
        variables: { orderCode: 'ORD-1', name: 'Khách' },
        dedupeKey: 'order.paid:ORD-1',
      }, meta)
      assert.equal(again.created, false)
      assert.equal(again.delivery.id, queued.delivery.id)
      assert.equal(await MailDelivery.countDocuments({ siteId: SITE }), 1)

      const otherPerson = await queueMail(MailDelivery, MailTemplate, SITE, {
        templateCode: 'order.paid',
        to: 'second@example.com',
        variables: { orderCode: 'ORD-1', name: 'Người thứ hai' },
        dedupeKey: 'order.paid:ORD-1',
      }, meta)
      assert.equal(otherPerson.created, true, 'one event addressed to two people is two emails')
    })

    await check('a draft template, a missing variable and a bad address are refused', async () => {
      await createMailTemplate(MailTemplate, SITE, {
        code: 'draft.only',
        title: 'Nháp',
        subject: 'Nháp',
        bodyText: 'Nội dung',
        status: 'draft',
      }, meta)
      await assert.rejects(
        () => queueMail(MailDelivery, MailTemplate, SITE, {
          templateCode: 'draft.only',
          to: 'customer@example.com',
        }, meta),
        isMailError(404, 'MAIL_TEMPLATE_NOT_FOUND'),
      )

      await assert.rejects(
        () => queueMail(MailDelivery, MailTemplate, SITE, {
          templateCode: 'order.paid',
          to: 'customer@example.com',
          variables: { orderCode: 'ORD-2' },
        }, meta),
        (error: unknown) => error instanceof MailServiceError
          && error.statusCode === 422
          && error.code === 'MAIL_VARIABLES_MISSING'
          && JSON.stringify(error.details) === JSON.stringify({ missing: ['name'] }),
      )

      await assert.rejects(
        () => queueMail(MailDelivery, MailTemplate, SITE, {
          templateCode: 'order.paid',
          to: 'not-an-email',
          variables: { orderCode: 'ORD-2', name: 'Khách' },
        }, meta),
        isMailError(422, 'MAIL_QUEUE_PAYLOAD_INVALID'),
      )
    })

    await check('marketing mail needs an explicit consent assertion', async () => {
      await createMailTemplate(MailTemplate, SITE, {
        code: 'marketing.promo',
        title: 'Khuyến mãi',
        subject: 'Ưu đãi {{month}}',
        bodyText: 'Ưu đãi tháng {{month}}',
        variables: ['month'],
        purpose: 'marketing',
        status: 'active',
      }, meta)

      await assert.rejects(
        () => queueMail(MailDelivery, MailTemplate, SITE, {
          templateCode: 'marketing.promo',
          to: 'customer@example.com',
          variables: { month: '11' },
        }, meta),
        isMailError(422, 'MAIL_CONSENT_REQUIRED'),
      )

      const consented = await queueMail(MailDelivery, MailTemplate, SITE, {
        templateCode: 'marketing.promo',
        to: 'customer@example.com',
        variables: { month: '11' },
        consent: true,
      }, meta)
      assert.equal(consented.created, true)
    })

    await check('no provider configured means queued, never a fake send', async () => {
      assert.equal(resolveMailTransport({}), null)
      assert.equal(resolveMailTransport({ TM_MAIL_PROVIDER: 'console' })?.name, 'console')

      await assert.rejects(
        () => sendDelivery(MailDelivery, null, SITE, queued.delivery.id, meta),
        isMailError(503, 'MAIL_PROVIDER_NOT_CONFIGURED'),
      )
      const untouched = await getMailDelivery(MailDelivery, SITE, queued.delivery.id)
      assert.equal(untouched.status, 'queued')
      assert.equal(untouched.attempts, 0, 'a missing provider does not burn an attempt')
    })

    await check('a provider failure is counted, reasoned and retried with backoff', async () => {
      const failing = {
        name: 'failing',
        async send() {
          throw new MailTransportError('PROVIDER_DOWN', 'Provider is down')
        },
      }

      const attempt = await sendDelivery(MailDelivery, failing, SITE, queued.delivery.id, meta)
      assert.equal(attempt.status, 'queued')
      assert.equal(attempt.attempts, 1)
      assert.match(attempt.lastError ?? '', /Provider is down/)
      assert.ok(attempt.nextAttemptAt)

      await assert.rejects(
        () => sendDelivery(MailDelivery, failing, SITE, queued.delivery.id, meta),
        isMailError(409, 'MAIL_DELIVERY_NOT_DUE'),
      )
    })

    await check('a non-retryable provider error fails the message at once', async () => {
      const rejected = await queueMail(MailDelivery, MailTemplate, SITE, {
        templateCode: 'order.paid',
        to: 'bounce@example.com',
        variables: { orderCode: 'ORD-3', name: 'Khách' },
      }, meta)

      const strict = {
        name: 'strict',
        async send() {
          throw new MailTransportError('ADDRESS_REJECTED', 'Mailbox does not exist', { retryable: false })
        },
      }

      const failed = await sendDelivery(MailDelivery, strict, SITE, rejected.delivery.id, meta)
      assert.equal(failed.status, 'failed')
      assert.equal(failed.attempts, 1)
    })

    await check('exhausted attempts end as failed, a manual retry sends', async () => {
      const row = await MailDelivery.findById(queued.delivery.id).lean<{ attempts: number, maxAttempts: number }>()
      // Simulate a queue that already burned its allowance.
      await MailDelivery.updateOne({ _id: queued.delivery.id }, { $set: { attempts: row!.maxAttempts - 1, nextAttemptAt: new Date() } })

      const failing = {
        name: 'failing',
        async send() {
          throw new MailTransportError('PROVIDER_DOWN', 'Provider is down')
        },
      }
      const exhausted = await sendDelivery(MailDelivery, failing, SITE, queued.delivery.id, meta)
      assert.equal(exhausted.status, 'failed')

      await assert.rejects(
        () => sendDelivery(MailDelivery, failing, SITE, queued.delivery.id, meta),
        isMailError(409, 'MAIL_DELIVERY_FAILED'),
      )

      const retried = await retryDelivery(MailDelivery, SITE, queued.delivery.id, meta)
      assert.equal(retried.status, 'queued')
      assert.equal(retried.attempts, 0)

      const sent = await sendDelivery(MailDelivery, { name: 'fake', async send() { return { providerId: 'fake:1' } } }, SITE, queued.delivery.id, meta)
      assert.equal(sent.status, 'sent')
      assert.equal(sent.providerId, 'fake:1')
      assert.ok(sent.sentAt)

      await assert.rejects(
        () => sendDelivery(MailDelivery, { name: 'fake', async send() { return { providerId: 'fake:2' } } }, SITE, queued.delivery.id, meta),
        isMailError(409, 'MAIL_DELIVERY_ALREADY_SENT'),
      )
    })

    await check('only a queued message can be cancelled, and a cancelled one can be retried', async () => {
      const pending = await queueMail(MailDelivery, MailTemplate, SITE, {
        templateCode: 'order.paid',
        to: 'cancel@example.com',
        variables: { orderCode: 'ORD-4', name: 'Khách' },
      }, meta)

      const cancelled = await cancelDelivery(MailDelivery, SITE, pending.delivery.id, meta)
      assert.equal(cancelled.status, 'cancelled')

      await assert.rejects(
        () => cancelDelivery(MailDelivery, SITE, pending.delivery.id, meta),
        isMailError(409, 'MAIL_DELIVERY_NOT_QUEUED'),
      )

      const requeued = await retryDelivery(MailDelivery, SITE, pending.delivery.id, meta)
      assert.equal(requeued.status, 'queued')
    })

    await check('a drain sends what is due and reports per-message outcomes', async () => {
      const working = { name: 'fake', async send() { return { providerId: 'fake:drain' } } }
      const result = await drainMailQueue(MailDelivery, working, SITE, { limit: 10 }, meta)
      assert.equal(result.provider, 'fake')
      assert.equal(result.processed, result.sent + result.failed + result.requeued)
      assert.ok(result.sent >= 1)

      const left = await listMailDeliveries(MailDelivery, SITE, { status: 'queued' })
      assert.equal(left.data.length, 0, 'nothing is left due after a successful drain')
      assert.ok((await listMailDeliveries(MailDelivery, SITE, { status: 'sent' })).data.length >= 1)

      await assert.rejects(
        () => drainMailQueue(MailDelivery, null, SITE, {}, meta),
        isMailError(503, 'MAIL_PROVIDER_NOT_CONFIGURED'),
      )
    })

    await check('templates and deliveries are site-scoped', async () => {
      assert.deepEqual((await listMailTemplates(MailTemplate, OTHER_SITE)).data, [])
      assert.deepEqual((await listMailDeliveries(MailDelivery, OTHER_SITE)).data, [])
      await assert.rejects(
        () => getMailDelivery(MailDelivery, OTHER_SITE, queued.delivery.id),
        isMailError(404, 'MAIL_DELIVERY_NOT_FOUND'),
      )
      await assert.rejects(
        () => getMailTemplate(MailTemplate, OTHER_SITE, template.id),
        isMailError(404, 'MAIL_TEMPLATE_NOT_FOUND'),
      )
    })

    await check('a template is hidden and restored without touching queued mail', async () => {
      const removed = await softDeleteMailTemplate(MailTemplate, SITE, template.id, 3, meta)
      assert.equal(removed.isDeleted, true)
      assert.equal((await listMailTemplates(MailTemplate, SITE)).data.length, 2)
      assert.equal((await listMailTemplates(MailTemplate, SITE, { includeDeleted: true })).data.length, 3)

      const restored = await restoreMailTemplate(MailTemplate, SITE, template.id, removed.revision, meta)
      assert.equal(restored.isDeleted, false)
      assert.equal((await listMailTemplates(MailTemplate, SITE)).data.length, 3)
    })

    await check('deliveries page newest first and count every state', async () => {
      const all = await listMailDeliveries(MailDelivery, SITE)
      assert.deepEqual(all.counts, { all: 5, queued: 0, sending: 0, sent: 4, failed: 1, cancelled: 0 })

      const page = await listMailDeliveries(MailDelivery, SITE, { limit: 2 })
      assert.equal(page.data.length, 2)
      assert.equal(page.hasMore, true)
      const next = await listMailDeliveries(MailDelivery, SITE, { limit: 2, cursor: page.nextCursor ?? undefined })
      assert.equal(next.data.length, 2)
      assert.equal(new Set([...page.data, ...next.data].map(row => row.id)).size, 4)

      const byTemplate = await listMailDeliveries(MailDelivery, SITE, { templateCode: 'marketing.promo' })
      assert.equal(byTemplate.data.length, 1)
    })

    await check('every template and delivery mutation is audited', async () => {
      const templateRows = await Audit.find({ siteId: SITE, resourceType: 'mail_template' }).lean<{ action: string }[]>()
      const actions = templateRows.map(row => row.action)
      for (const expected of ['create', 'update', 'delete', 'restore']) {
        assert.ok(actions.includes(expected), `no ${expected} audit row`)
      }

      const deliveryRows = await Audit.find({ siteId: SITE, resourceType: 'mail_delivery' }).lean<{ toStatus: string }[]>()
      assert.ok(deliveryRows.some(row => row.toStatus === 'queued'))
      assert.ok(deliveryRows.some(row => row.toStatus === 'sent'))
      assert.ok(deliveryRows.some(row => row.toStatus === 'failed'))
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} Mail checks: ${checks} passed, ${notRun} not run\n`)
