import assert from 'node:assert/strict'
import {
  CustomerServiceError,
  createCustomer,
  getCustomer,
  listCustomers,
  restoreCustomer,
  softDeleteCustomer,
  updateCustomer,
} from '../../tm-cms/server/services/customerService.js'
import {
  CustomerSegmentServiceError,
  createCustomerSegment,
  listCustomerSegments,
  restoreCustomerSegment,
  softDeleteCustomerSegment,
} from '../../tm-cms/server/services/customerSegmentService.js'
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

function isCustomerError(status: number, code: string) {
  return (error: unknown) => error instanceof CustomerServiceError && error.statusCode === status && error.code === code
}

function isSegmentError(status: number, code: string) {
  return (error: unknown) => error instanceof CustomerSegmentServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('CRM — customer and segment commands (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_crm_service' }

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
    const { Customer, CustomerSegment, Audit } = await prepareDatabase(connection)
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const vip = await createCustomerSegment(CustomerSegment, SITE, {
      code: 'vip',
      title: 'Khách VIP',
      defaultDiscountPercent: 5,
      sort: 2,
    }, meta)
    const retail = await createCustomerSegment(CustomerSegment, SITE, {
      code: 'le',
      title: 'Khách lẻ',
      sort: 1,
    }, meta)

    const first = await createCustomer(Customer, CustomerSegment, SITE, {
      subjectId: 'hub_subject_001',
      fullName: 'Nguyễn Văn A',
      email: 'a@example.com',
      phone: '0900000001',
      customerSegmentId: vip.id,
      addresses: [
        { street: '1 Lê Lợi', city: 'Hà Nội', isDefault: true },
        { street: '2 Trần Phú', city: 'Đà Nẵng', isDefault: true },
      ],
    }, meta)

    await check('create folds the generated code, keeps one default address and starts at revision 1', async () => {
      assert.match(first.code, /^CUS-[A-Z0-9]{8}$/)
      assert.equal(first.revision, 1)
      assert.equal(first.siteId, SITE)
      assert.equal(first.customerSegmentId, vip.id)
      assert.equal(first.addresses.length, 2)
      assert.equal(first.addresses[0]!.isDefault, true)
      assert.equal(first.addresses[1]!.isDefault, false, 'a second default is demoted, not rejected')
      assert.equal(first.metrics.totalOrders, 0)
    })

    await check('the Hub subject is unique per site and a second profile is a conflict', async () => {
      await assert.rejects(
        () => createCustomer(Customer, CustomerSegment, SITE, { subjectId: 'hub_subject_001', fullName: 'Trùng' }, meta),
        isCustomerError(409, 'CUSTOMER_SUBJECT_EXISTS'),
      )
    })

    await check('an explicit code is normalized and cannot be reused', async () => {
      const coded = await createCustomer(Customer, CustomerSegment, SITE, {
        code: ' kh-002 ',
        subjectId: 'hub_subject_002',
        fullName: 'Trần Thị B',
      }, meta)
      assert.equal(coded.code, 'KH-002')
      await assert.rejects(
        () => createCustomer(Customer, CustomerSegment, SITE, { code: 'kh-002', subjectId: 'hub_subject_003' }, meta),
        isCustomerError(409, 'CUSTOMER_CODE_EXISTS'),
      )
    })

    await check('a customer needs a subject id', async () => {
      await assert.rejects(
        () => createCustomer(Customer, CustomerSegment, SITE, { fullName: 'Không chủ thể' }, meta),
        isCustomerError(422, 'CUSTOMER_SUBJECT_REQUIRED'),
      )
    })

    await check('a segment from another site or a deleted one is refused', async () => {
      await assert.rejects(
        () => createCustomer(Customer, CustomerSegment, SITE, { subjectId: 'hub_subject_004', customerSegmentId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, meta),
        isCustomerError(422, 'CUSTOMER_SEGMENT_NOT_FOUND'),
      )

      const temp = await createCustomerSegment(CustomerSegment, SITE, { code: 'tam', title: 'Tạm' }, meta)
      await softDeleteCustomerSegment(CustomerSegment, SITE, temp.id, temp.revision, meta)
      await assert.rejects(
        () => createCustomer(Customer, CustomerSegment, SITE, { subjectId: 'hub_subject_005', customerSegmentId: temp.id }, meta),
        isCustomerError(422, 'CUSTOMER_SEGMENT_DELETED'),
      )
    })

    await check('the list filters by keyword and segment, paging with a cursor', async () => {
      const all = await listCustomers(Customer, SITE, { limit: 2 })
      assert.equal(all.data.length, 2)
      assert.equal(all.hasMore, false)
      assert.equal(all.counts.all, 2)
      assert.equal(all.counts.active, 2)

      const firstPage = await listCustomers(Customer, SITE, { limit: 1 })
      assert.equal(firstPage.data.length, 1)
      assert.equal(firstPage.hasMore, true)
      const next = await listCustomers(Customer, SITE, { limit: 1, cursor: firstPage.nextCursor })
      assert.equal(next.data.length, 1)
      assert.notEqual(next.data[0]!.id, firstPage.data[0]!.id)
      assert.equal(next.hasMore, false)

      const bySegment = await listCustomers(Customer, SITE, { segmentId: vip.id })
      assert.deepEqual(bySegment.data.map(entry => entry.code), [first.code])

      const byKeyword = await listCustomers(Customer, SITE, { q: 'trần thị' })
      assert.deepEqual(byKeyword.data.map(entry => entry.code), ['KH-002'])

      const none = await listCustomers(Customer, SITE, { q: 'không có ai' })
      assert.equal(none.data.length, 0)
    })

    await check('customers and segments are site-scoped', async () => {
      assert.equal((await listCustomers(Customer, OTHER_SITE)).data.length, 0)
      assert.equal((await listCustomerSegments(CustomerSegment, OTHER_SITE)).length, 0)
      await assert.rejects(() => getCustomer(Customer, OTHER_SITE, first.id), isCustomerError(404, 'CUSTOMER_NOT_FOUND'))
    })

    await check('update merges fields under an optimistic lock and never relinks the subject', async () => {
      const updated = await updateCustomer(Customer, CustomerSegment, SITE, first.id, {
        revision: first.revision,
        fullName: 'Nguyễn Văn A (VIP)',
        loyaltyPoints: 120,
        customerSegmentId: retail.id,
        note: 'Khách quen',
      }, meta)
      assert.equal(updated.revision, 2)
      assert.equal(updated.loyaltyPoints, 120)
      assert.equal(updated.customerSegmentId, retail.id)
      assert.equal(updated.email, 'a@example.com', 'an omitted field keeps its value')
      assert.equal(updated.addresses.length, 2, 'an omitted address list keeps its value')

      await assert.rejects(
        () => updateCustomer(Customer, CustomerSegment, SITE, first.id, { revision: 1, fullName: 'Cũ' }, meta),
        isCustomerError(409, 'CUSTOMER_REVISION_CONFLICT'),
      )
      await assert.rejects(
        () => updateCustomer(Customer, CustomerSegment, SITE, first.id, { revision: 2, subjectId: 'hub_subject_999' }, meta),
        isCustomerError(422, 'CUSTOMER_SUBJECT_IMMUTABLE'),
      )
    })

    await check('a segment still used by customers cannot be deleted, and can be after the move', async () => {
      await assert.rejects(
        () => softDeleteCustomerSegment(CustomerSegment, SITE, retail.id, retail.revision, { ...meta, customers: Customer }),
        (error: unknown) => {
          assert.ok(isSegmentError(409, 'CUSTOMER_SEGMENT_IN_USE')(error))
          assert.equal(((error as CustomerSegmentServiceError).details as { customers: number }).customers, 1)
          return true
        },
      )

      const current = await getCustomer(Customer, SITE, first.id)
      const moved = await updateCustomer(Customer, CustomerSegment, SITE, first.id, {
        revision: current.revision,
        customerSegmentId: vip.id,
      }, meta)
      assert.equal(moved.customerSegmentId, vip.id)

      const removed = await softDeleteCustomerSegment(CustomerSegment, SITE, retail.id, retail.revision, { ...meta, customers: Customer })
      assert.equal(removed.code, 'LE')
      assert.equal((await listCustomerSegments(CustomerSegment, SITE)).some(entry => entry.id === retail.id), false)
      assert.equal((await listCustomerSegments(CustomerSegment, SITE, true)).some(entry => entry.id === retail.id), true)

      const restored = await restoreCustomerSegment(CustomerSegment, SITE, retail.id, retail.revision + 1, meta)
      assert.equal(restored.isDeleted, false)
    })

    await check('deleting a customer hides it, keeps it restorable and is audited', async () => {
      const live = await getCustomer(Customer, SITE, first.id)
      const removed = await softDeleteCustomer(Customer, SITE, first.id, live.revision, meta)
      assert.equal(removed.code, first.code)

      const visible = await listCustomers(Customer, SITE)
      assert.equal(visible.data.some(entry => entry.id === first.id), false)
      assert.equal(visible.counts.deleted, 1)

      const hidden = await listCustomers(Customer, SITE, { includeDeleted: true })
      assert.equal(hidden.data.length, 2)

      const restored = await restoreCustomer(Customer, SITE, first.id, live.revision + 1, meta)
      assert.equal(restored.isDeleted, false)
      assert.equal(restored.isActive, true)
    })

    await check('every CRM mutation records an audit entry with the actor', async () => {
      const customers = await Audit.find({ siteId: SITE, resourceType: 'customer' }).lean<{ action: string, actor: { email: string } }[]>()
      const segments = await Audit.find({ siteId: SITE, resourceType: 'customer_segment' }).lean<{ action: string, actor: { email: string } }[]>()
      assert.ok(customers.some(entry => entry.action === 'create'))
      assert.ok(customers.some(entry => entry.action === 'update'))
      assert.ok(customers.some(entry => entry.action === 'delete'))
      assert.ok(customers.some(entry => entry.action === 'restore'))
      assert.ok(segments.some(entry => entry.action === 'create'))
      assert.ok([...customers, ...segments].every(entry => entry.actor.email === ACTOR.email))
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} CRM service checks: ${checks} passed, ${notRun} not run\n`)
