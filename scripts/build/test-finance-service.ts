import assert from 'node:assert/strict'
import { createCustomer } from '../../tm-cms/server/services/customerService.js'
import { createOrder, getOrder } from '../../tm-cms/server/services/orderService.js'
import { createSupplier, getSupplier } from '../../tm-cms/server/services/supplierService.js'
import { createPurchaseOrder, getPurchaseOrder } from '../../tm-cms/server/services/purchaseOrderService.js'
import {
  PaymentServiceError,
  getPayment,
  listPayments,
  recordPayment,
  voidPayment,
} from '../../tm-cms/server/services/paymentService.js'
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

function isPaymentError(status: number, code: string) {
  return (error: unknown) => error instanceof PaymentServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('Finance — payments against orders and purchase orders (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_finance_service' }

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
    const { Payment, Order, PurchaseOrder, Customer, CustomerSegment, Supplier, Audit } = await prepareDatabase(connection)
    const meta = { audit: { model: Audit, actor: ACTOR } }
    const targets = { order: Order, purchaseOrder: PurchaseOrder }

    const customer = await createCustomer(Customer, CustomerSegment, SITE, {
      subjectId: 'hub-subject-finance-test',
      fullName: 'Nguyễn Văn A',
      phone: '0900000001',
    }, meta)

    const order = await createOrder(Order, Customer, SITE, {
      customerId: customer.id,
      status: 'processing',
      items: [{ itemName: 'Sản phẩm', price: 100000, quantity: 2 }],
    }, meta)
    assert.equal(order.totalAmount, 200000)

    const first = await recordPayment(Payment, targets, SITE, {
      direction: 'receivable',
      referenceModel: 'Order',
      referenceId: order.id,
      amount: 50000,
      method: 'banking',
      note: 'Cọc',
    }, meta)

    await check('a partial payment applies to the order', async () => {
      assert.match(first.code, /^PAY-\d{6}-[0-9A-F]{6}$/)
      assert.equal(first.direction, 'receivable')
      assert.equal(first.referenceCode, order.code)
      assert.equal(first.partyId, customer.id)
      const current = await getOrder(Order, SITE, order.id)
      assert.equal(current.paidAmount, 50000)
      assert.equal(current.paymentStatus, 'partial')
    })

    await check('a payment cannot exceed the outstanding balance', async () => {
      await assert.rejects(
        () => recordPayment(Payment, targets, SITE, {
          direction: 'receivable',
          referenceModel: 'Order',
          referenceId: order.id,
          amount: 200000,
        }, meta),
        isPaymentError(409, 'PAYMENT_EXCEEDS_OUTSTANDING'),
      )
      const current = await getOrder(Order, SITE, order.id)
      assert.equal(current.paidAmount, 50000, 'a refused payment moves nothing')
    })

    await check('direction must match the document kind', async () => {
      await assert.rejects(
        () => recordPayment(Payment, targets, SITE, {
          direction: 'payable',
          referenceModel: 'Order',
          referenceId: order.id,
          amount: 1000,
        }, meta),
        isPaymentError(422, 'PAYMENT_DIRECTION_MISMATCH'),
      )
    })

    await check('the remaining balance settles the order', async () => {
      const second = await recordPayment(Payment, targets, SITE, {
        direction: 'receivable',
        referenceModel: 'Order',
        referenceId: order.id,
        amount: 150000,
        method: 'cash',
      }, meta)
      assert.equal(second.amount, 150000)
      const current = await getOrder(Order, SITE, order.id)
      assert.equal(current.paidAmount, 200000)
      assert.equal(current.paymentStatus, 'paid')
    })

    await check('an overpayment of zero or a negative amount is refused', async () => {
      await assert.rejects(
        () => recordPayment(Payment, targets, SITE, {
          direction: 'receivable',
          referenceModel: 'Order',
          referenceId: order.id,
          amount: 0,
        }, meta),
        isPaymentError(422, 'PAYMENT_AMOUNT_INVALID'),
      )
    })

    await check('an unknown reference is refused', async () => {
      await assert.rejects(
        () => recordPayment(Payment, targets, SITE, {
          direction: 'receivable',
          referenceModel: 'Order',
          referenceId: '64b000000000000000000000',
          amount: 1000,
        }, meta),
        isPaymentError(404, 'PAYMENT_REFERENCE_NOT_FOUND'),
      )
    })

    await check('voiding restores the balance it had before', async () => {
      const current = await getPayment(Payment, SITE, first.id)
      const voided = await voidPayment(Payment, targets, SITE, first.id, {
        revision: current.revision,
        reason: 'Khách đổi phương thức',
      }, meta)
      assert.equal(voided.state, 'voided')
      assert.equal(voided.voidReason, 'Khách đổi phương thức')
      const after = await getOrder(Order, SITE, order.id)
      assert.equal(after.paidAmount, 150000)
      assert.equal(after.paymentStatus, 'partial')
    })

    await check('a void payment cannot be voided twice', async () => {
      const current = await getPayment(Payment, SITE, first.id)
      await assert.rejects(
        () => voidPayment(Payment, targets, SITE, first.id, { revision: current.revision }, meta),
        isPaymentError(409, 'PAYMENT_ALREADY_VOIDED'),
      )
    })

    await check('payments are site-scoped', async () => {
      assert.equal((await listPayments(Payment, OTHER_SITE)).data.length, 0)
      await assert.rejects(() => getPayment(Payment, OTHER_SITE, first.id), isPaymentError(404, 'PAYMENT_NOT_FOUND'))
    })

    await check('the list filters and counts posted money', async () => {
      const all = await listPayments(Payment, SITE, { referenceModel: 'Order' })
      assert.equal(all.data.length, 2)
      assert.deepEqual(all.counts, { all: 2, posted: 1, voided: 1, postedAmount: 150000 })
      const page = await listPayments(Payment, SITE, { limit: 1 })
      assert.equal(page.data.length, 1)
      assert.equal(page.hasMore, true)
      const next = await listPayments(Payment, SITE, { limit: 1, cursor: page.nextCursor ?? undefined })
      assert.equal(next.data.length, 1)
      const posted = await listPayments(Payment, SITE, { state: 'posted' })
      assert.equal(posted.data.length, 1)
    })

    const supplier = await createSupplier(Supplier, SITE, { title: 'Nhà cung cấp A' }, meta)
    const purchaseOrder = await createPurchaseOrder(PurchaseOrder, Supplier, SITE, {
      supplierId: supplier.id,
      status: 'ordered',
      items: [{ itemName: 'Hàng', quantity: 10, unitCost: 20000 }],
    }, meta)

    await check('a payable payment settles a purchase order', async () => {
      assert.equal(purchaseOrder.totalAmount, 200000)
      const payment = await recordPayment(Payment, targets, SITE, {
        direction: 'payable',
        referenceModel: 'PurchaseOrder',
        referenceId: purchaseOrder.id,
        amount: 200000,
      }, meta)
      assert.equal(payment.direction, 'payable')
      const current = await getPurchaseOrder(PurchaseOrder, SITE, purchaseOrder.id)
      assert.equal(current.paidAmount, 200000)
      assert.equal(current.paymentStatus, 'paid')
      const storedSupplier = await getSupplier(Supplier, SITE, supplier.id)
      assert.equal(payment.partyId, storedSupplier.id)
    })

    await check('every payment mutation records an audit entry', async () => {
      const entries = await Audit.find({ siteId: SITE, resourceType: 'payment' }).lean<{ action: string, toStatus: string | null }[]>()
      assert.equal(entries.filter(entry => entry.action === 'create').length, 3)
      assert.ok(entries.some(entry => entry.toStatus === 'voided'))
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} Finance checks: ${checks} passed, ${notRun} not run\n`)
