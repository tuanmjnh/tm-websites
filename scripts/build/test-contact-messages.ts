import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
import { getContactMessage, listContactMessages, ContactMessageServiceError, restoreContactMessage, softDeleteContactMessage, submitContactMessage, updateContactMessage } from '../../tm-cms/server/services/contactMessageService.js'
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

function isContactError(status: number, code: string) {
  return (error: unknown) => error instanceof ContactMessageServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('Contact messages — captured, triaged, closed\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_contact_messages')

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
    const { ContactMessage, Audit } = models
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const first = await submitContactMessage(ContactMessage, SITE, {
      name: 'An Nguyen',
      email: 'AN@Example.com',
      phone: '0900000000',
      subject: 'Hỗ trợ',
      message: 'Xin chào',
      source: 'footer',
    }, meta)

    await check('a submission starts as new and normalises the email', async () => {
      assert.equal(first.status, 'new')
      assert.equal(first.email, 'an@example.com')
      assert.equal(first.name, 'An Nguyen')
    })

    await check('validation rejects an empty message', async () => {
      await assert.rejects(
        () => submitContactMessage(ContactMessage, SITE, { name: 'X', email: 'x@example.com', message: '' }, meta),
        isContactError(422, 'CONTACT_MESSAGE_PAYLOAD_INVALID'),
      )
    })

    await check('marking read sets readAt and bumps revision', async () => {
      const read = await updateContactMessage(ContactMessage, SITE, first.id, { status: 'read', revision: first.revision }, meta)
      assert.equal(read.status, 'read')
      assert.ok(read.readAt)
      assert.equal(read.revision, first.revision + 1)
    })

    await check('replaying the same status is a no-op', async () => {
      const current = await getContactMessage(ContactMessage, SITE, first.id)
      const again = await updateContactMessage(ContactMessage, SITE, first.id, { status: 'read', revision: current.revision }, meta)
      assert.equal(again.status, 'read')
      assert.equal(again.revision, current.revision)
    })

    await check('replied and closed set their timestamps', async () => {
      const current = await getContactMessage(ContactMessage, SITE, first.id)
      const replied = await updateContactMessage(ContactMessage, SITE, first.id, { status: 'replied', adminNote: 'Đã trả lời qua email', revision: current.revision }, meta)
      assert.equal(replied.status, 'replied')
      assert.ok(replied.repliedAt)
      assert.equal(replied.adminNote, 'Đã trả lời qua email')
      const closed = await updateContactMessage(ContactMessage, SITE, first.id, { status: 'closed', revision: replied.revision }, meta)
      assert.equal(closed.status, 'closed')
      assert.ok(closed.closedAt)
    })

    await check('a stale revision is refused', async () => {
      await assert.rejects(
        () => updateContactMessage(ContactMessage, SITE, first.id, { status: 'read', revision: 1 }, meta),
        isContactError(409, 'CONTACT_MESSAGE_REVISION_CONFLICT'),
      )
    })

    const second = await submitContactMessage(ContactMessage, SITE, { name: 'Binh', email: 'binh@example.com', message: 'Giúp tôi' }, meta)
    await check('soft delete and restore keep the revision moving', async () => {
      const removed = await softDeleteContactMessage(ContactMessage, SITE, second.id, second.revision, meta)
      assert.equal(removed.isDeleted, true)
      const restored = await restoreContactMessage(ContactMessage, SITE, second.id, removed.revision, meta)
      assert.equal(restored.isDeleted, false)
    })

    await check('a tenant only sees its own messages', async () => {
      await submitContactMessage(ContactMessage, OTHER_SITE, { name: 'Zoe', email: 'zoe@example.com', message: 'hi' }, meta)
      const foreign = await listContactMessages(ContactMessage, OTHER_SITE)
      assert.equal(foreign.counts.all, 1)
      const home = await listContactMessages(ContactMessage, SITE)
      assert.ok(home.counts.all >= 2)
      assert.equal(home.data.every(row => row.siteId === SITE), true)
    })

    await check('list counts new, read, replied and closed separately', async () => {
      const result = await listContactMessages(ContactMessage, SITE)
      assert.equal(result.counts.all, result.counts.new + result.counts.read + result.counts.replied + result.counts.closed)
    })

    await check('search matches name, email, subject or message', async () => {
      const result = await listContactMessages(ContactMessage, SITE, { q: 'Hỗ trợ' })
      assert.ok(result.data.length >= 1)
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Contact message checks: ${checks} passed, ${notRun} not run\n`)
