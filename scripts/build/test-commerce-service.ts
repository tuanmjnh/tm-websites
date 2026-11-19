import assert from 'node:assert/strict'
import {
  OrderServiceError,
  createOrder,
  getOrder,
  listOrders,
  restoreOrder,
  softDeleteOrder,
  updateOrder,
} from '../../tm-cms/server/services/orderService.js'
import {
  QuotationServiceError,
  convertQuotationToOrder,
  createQuotation,
  getQuotation,
  listQuotations,
  restoreQuotation,
  softDeleteQuotation,
  updateQuotation,
} from '../../tm-cms/server/services/quotationService.js'
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

function isOrderError(status: number, code: string) {
  return (error: unknown) => error instanceof OrderServiceError && error.statusCode === status && error.code === code
}
function isQuotationError(status: number, code: string) {
  return (error: unknown) => error instanceof QuotationServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('Commerce — orders and quotations (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_commerce_service' }

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
    const { Order, Quotation, Customer, Audit } = await prepareDatabase(connection)
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const orderItems = [{ itemName: 'Áo thun', sku: 'AT-01', price: 100000, quantity: 2 }]

    const firstOrder = await createOrder(Order, Customer, SITE, {
      code: 'ORD-001',
      customerId: null,
      channel: 'admin',
      status: 'pending',
      paymentMethod: 'cash',
      items: orderItems,
      shippingFee: 10000,
      discountAmount: 5000,
      note: 'Đơn test',
    }, meta)

    await check('create computes totals and starts at revision 1', async () => {
      assert.equal(firstOrder.code, 'ORD-001')
      assert.equal(firstOrder.revision, 1)
      assert.equal(firstOrder.siteId, SITE)
      assert.equal(firstOrder.itemsPrice, 200000)
      assert.equal(firstOrder.totalAmount, 205000)
      assert.equal(firstOrder.status, 'pending')
      assert.equal(firstOrder.paymentStatus, 'unpaid')
    })

    await check('a duplicate code is a conflict', async () => {
      await assert.rejects(
        () => createOrder(Order, Customer, SITE, { code: 'ORD-001', items: orderItems }, meta),
        isOrderError(409, 'ORDER_CODE_EXISTS'),
      )
    })

    await check('an order needs at least one item', async () => {
      await assert.rejects(
        () => createOrder(Order, Customer, SITE, { code: 'ORD-002', items: [] }, meta),
        isOrderError(422, 'ORDER_PAYLOAD_INVALID'),
      )
    })

    const secondOrder = await createOrder(Order, Customer, SITE, {
      code: 'ORD-002',
      items: [{ itemName: 'Quần jean', sku: 'QJ-01', price: 250000, quantity: 1 }],
      paidAmount: 250000,
    }, meta)
    await check('paid amount derives payment status', async () => {
      assert.equal(secondOrder.paymentStatus, 'paid')
    })

    await check('list filters by status and pages with cursor', async () => {
      const all = await listOrders(Order, SITE, { limit: 10 })
      assert.equal(all.data.length, 2)
      assert.equal(all.counts.all, 2)
      const firstPage = await listOrders(Order, SITE, { limit: 1 })
      assert.equal(firstPage.data.length, 1)
      assert.equal(firstPage.hasMore, true)
      const next = await listOrders(Order, SITE, { limit: 1, cursor: firstPage.nextCursor })
      assert.equal(next.data.length, 1)
      assert.notEqual(next.data[0]!.id, firstPage.data[0]!.id)
      const byStatus = await listOrders(Order, SITE, { status: 'pending' })
      assert.equal(byStatus.data.length, 2)
    })

    await check('orders are site-scoped', async () => {
      assert.equal((await listOrders(Order, OTHER_SITE)).data.length, 0)
      await assert.rejects(() => getOrder(Order, OTHER_SITE, firstOrder.id), isOrderError(404, 'ORDER_NOT_FOUND'))
    })

    await check('update merges and bumps revision; stale revision conflicts', async () => {
      const updated = await updateOrder(Order, SITE, firstOrder.id, {
        revision: firstOrder.revision,
        status: 'processing',
        note: 'Đang xử lý',
        paidAmount: 100000,
      }, meta)
      assert.equal(updated.revision, 2)
      assert.equal(updated.status, 'processing')
      assert.equal(updated.note, 'Đang xử lý')
      assert.equal(updated.paymentStatus, 'partial')
      assert.equal(updated.itemsPrice, 200000, 'items kept')

      await assert.rejects(
        () => updateOrder(Order, SITE, firstOrder.id, { revision: 1, status: 'shipped' }, meta),
        isOrderError(409, 'ORDER_REVISION_CONFLICT'),
      )
    })

    await check('items cannot change after shipping', async () => {
      const cur = await getOrder(Order, SITE, firstOrder.id)
      await updateOrder(Order, SITE, firstOrder.id, { revision: cur.revision, status: 'shipped' }, meta)
      const shipped = await getOrder(Order, SITE, firstOrder.id)
      await assert.rejects(
        () => updateOrder(Order, SITE, firstOrder.id, { revision: shipped.revision, items: [{ itemName: 'X', price: 1, quantity: 1 }] }, meta),
        isOrderError(409, 'ORDER_LOCKED'),
      )
    })

    await check('soft delete hides, restore brings back', async () => {
      const live = await getOrder(Order, SITE, secondOrder.id)
      const removed = await softDeleteOrder(Order, SITE, secondOrder.id, live.revision, meta)
      assert.equal(removed.code, 'ORD-002')
      const visible = await listOrders(Order, SITE)
      assert.equal(visible.data.some(e => e.id === secondOrder.id), false)
      const restored = await restoreOrder(Order, SITE, secondOrder.id, live.revision + 1, meta)
      assert.equal(restored.isDeleted, false)
    })

    // Quotation tests
    const qItems = [{ itemName: 'Áo thun', sku: 'AT-01', price: 100000, quantity: 3 }]
    const firstQuo = await createQuotation(Quotation, SITE, {
      code: 'QUO-001',
      customerId: null,
      status: 'draft',
      items: qItems,
      shippingFee: 15000,
      discountAmount: 0,
      adminNote: 'Báo giá test',
    }, meta)

    await check('quotation computes totals', async () => {
      assert.equal(firstQuo.code, 'QUO-001')
      assert.equal(firstQuo.itemsPrice, 300000)
      assert.equal(firstQuo.totalAmount, 315000)
      assert.equal(firstQuo.status, 'draft')
    })

    await check('quotation duplicate code conflict', async () => {
      await assert.rejects(
        () => createQuotation(Quotation, SITE, { code: 'QUO-001', items: qItems }, meta),
        isQuotationError(409, 'QUOTATION_CODE_EXISTS'),
      )
    })

    await check('quotation needs items', async () => {
      await assert.rejects(
        () => createQuotation(Quotation, SITE, { code: 'QUO-002', items: [] }, meta),
        isQuotationError(422, 'QUOTATION_PAYLOAD_INVALID'),
      )
    })

    await check('quotation update merges', async () => {
      const updated = await updateQuotation(Quotation, SITE, firstQuo.id, {
        revision: firstQuo.revision,
        status: 'sent',
        adminNote: 'Đã gửi',
      }, meta)
      assert.equal(updated.revision, 2)
      assert.equal(updated.status, 'sent')
      assert.equal(updated.adminNote, 'Đã gửi')
      assert.equal(updated.itemsPrice, 300000, 'items kept')
    })

    await check('converted quotation cannot be edited', async () => {
      // convert first
      const cur = await getQuotation(Quotation, SITE, firstQuo.id)
      const conv = await convertQuotationToOrder(Quotation, Order, Customer, SITE, firstQuo.id, cur.revision, meta)
      assert.ok(conv.orderId)
      const after = await getQuotation(Quotation, SITE, firstQuo.id)
      assert.equal(after.status, 'converted')
      assert.equal(after.convertedOrderId, conv.orderId)
      await assert.rejects(
        () => updateQuotation(Quotation, SITE, firstQuo.id, { revision: after.revision, adminNote: 'x' }, meta),
        isQuotationError(409, 'QUOTATION_CONVERTED'),
      )
    })

    await check('convert is idempotent (second call returns same order)', async () => {
      const cur = await getQuotation(Quotation, SITE, firstQuo.id)
      const conv2 = await convertQuotationToOrder(Quotation, Order, Customer, SITE, firstQuo.id, cur.revision, meta)
      assert.equal(conv2.orderId, (await getQuotation(Quotation, SITE, firstQuo.id)).convertedOrderId)
    })

    await check('quotation soft delete/restore', async () => {
      const q2 = await createQuotation(Quotation, SITE, { code: 'QUO-003', items: qItems }, meta)
      const live = await getQuotation(Quotation, SITE, q2.id)
      const removed = await softDeleteQuotation(Quotation, SITE, q2.id, live.revision, meta)
      assert.equal(removed.code, 'QUO-003')
      const restored = await restoreQuotation(Quotation, SITE, q2.id, live.revision + 1, meta)
      assert.equal(restored.isDeleted, false)
    })

    await check('quotations are site-scoped', async () => {
      assert.equal((await listQuotations(Quotation, OTHER_SITE)).data.length, 0)
      await assert.rejects(() => getQuotation(Quotation, OTHER_SITE, firstQuo.id), isQuotationError(404, 'QUOTATION_NOT_FOUND'))
    })

    await check('every commerce mutation records an audit entry', async () => {
      const orders = await Audit.find({ siteId: SITE, resourceType: 'order' }).lean<{ action: string }[]>()
      const quos = await Audit.find({ siteId: SITE, resourceType: 'quotation' }).lean<{ action: string }[]>()
      assert.ok(orders.some(e => e.action === 'create'))
      assert.ok(orders.some(e => e.action === 'update'))
      assert.ok(orders.some(e => e.action === 'delete'))
      assert.ok(orders.some(e => e.action === 'restore'))
      assert.ok(quos.some(e => e.action === 'create'))
      assert.ok(quos.some(e => e.action === 'update'))
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} Commerce service checks: ${checks} passed, ${notRun} not run\n`)
