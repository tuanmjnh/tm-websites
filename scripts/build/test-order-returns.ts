import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
import { createOrder } from '../../tm-cms/server/services/orderService.js'
import { createOrderReturn, getOrderReturn, listOrderReturns, OrderReturnServiceError, restoreOrderReturn, softDeleteOrderReturn, updateOrderReturn } from '../../tm-cms/server/services/orderReturnService.js'
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

function isReturnError(status: number, code: string) {
  return (error: unknown) => error instanceof OrderReturnServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('Order returns — refund quantity against the order\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_order_returns')

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
    const { Order, OrderReturn, Audit } = models
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const order = await createOrder(Order, null, SITE, {
      code: 'ORD-R-001',
      items: [
        { itemId: 'item-tee', variantId: null, itemName: 'Áo thun', sku: 'AT-01', price: 100000, quantity: 5 },
        { itemId: 'item-pants', variantId: null, itemName: 'Quần', sku: 'Q-01', price: 200000, quantity: 2 },
      ],
    }, meta)

    const first = await createOrderReturn(OrderReturn, Order, SITE, {
      code: 'RET-001',
      orderId: order.id,
      status: 'approved',
      items: [{ itemId: 'item-tee', variantId: null, itemName: 'Áo thun', sku: 'AT-01', quantity: 2, unitPrice: 100000 }],
      refundAmount: 200000,
    }, meta)

    await check('an approved return records the lines and stamps approvedAt', async () => {
      assert.equal(first.status, 'approved')
      assert.ok(first.approvedAt)
      assert.equal(first.items[0]!.quantity, 2)
    })

    await check('the order returnedQuantity moves with the return', async () => {
      const current = await Order.findOne({ _id: order.id }).lean<{ items: { itemId: string | null, returnedQuantity: number }[] }>()
      const tee = current!.items.find(item => item.itemId === 'item-tee')!
      assert.equal(tee.returnedQuantity, 2)
    })

    await check('a second return cannot exceed what remains', async () => {
      await assert.rejects(
        () => createOrderReturn(OrderReturn, Order, SITE, {
          code: 'RET-002',
          orderId: order.id,
          status: 'approved',
          items: [{ itemId: 'item-tee', variantId: null, itemName: 'Áo thun', sku: 'AT-01', quantity: 4 }],
        }, meta),
        isReturnError(422, 'ORDER_RETURN_QUANTITY_EXCEEDS_REMAINING'),
      )
    })

    await check('a line not on the order is rejected', async () => {
      await assert.rejects(
        () => createOrderReturn(OrderReturn, Order, SITE, {
          code: 'RET-003',
          orderId: order.id,
          status: 'draft',
          items: [{ itemId: 'item-sock', variantId: null, itemName: 'Tất', sku: 'SK', quantity: 1 }],
        }, meta),
        isReturnError(422, 'ORDER_RETURN_ITEM_NOT_IN_ORDER'),
      )
    })

    await check('a missing order is rejected', async () => {
      await assert.rejects(
        () => createOrderReturn(OrderReturn, Order, SITE, {
          code: 'RET-004',
          orderId: 'does-not-exist',
          items: [{ itemName: 'Áo thun', sku: 'AT-01', quantity: 1 }],
        }, meta),
        isReturnError(404, 'ORDER_RETURN_ORDER_NOT_FOUND'),
      )
    })

    const draft = await createOrderReturn(OrderReturn, Order, SITE, {
      code: 'RET-005',
      orderId: order.id,
      status: 'draft',
      items: [{ itemId: 'item-tee', variantId: null, itemName: 'Áo thun', sku: 'AT-01', quantity: 1 }],
    }, meta)

    await check('approving a draft moves the order quantity', async () => {
      const approved = await updateOrderReturn(OrderReturn, Order, SITE, draft.id, { status: 'approved', revision: draft.revision }, meta)
      assert.equal(approved.status, 'approved')
      assert.ok(approved.approvedAt)
      const current = await Order.findOne({ _id: order.id }).lean<{ items: { itemId: string | null, returnedQuantity: number }[] }>()
      const tee = current!.items.find(item => item.itemId === 'item-tee')!
      assert.equal(tee.returnedQuantity, 3)
    })

    await check('cancelling restores the quantity', async () => {
      const current = await getOrderReturn(OrderReturn, SITE, draft.id)
      const cancelled = await updateOrderReturn(OrderReturn, Order, SITE, draft.id, { status: 'cancelled', revision: current.revision }, meta)
      assert.equal(cancelled.status, 'cancelled')
      assert.ok(cancelled.cancelledAt)
      const orderNow = await Order.findOne({ _id: order.id }).lean<{ items: { itemId: string | null, returnedQuantity: number }[] }>()
      const tee = orderNow!.items.find(item => item.itemId === 'item-tee')!
      assert.equal(tee.returnedQuantity, 2)
    })

    await check('a tenant only sees its own returns', async () => {
      const foreign = await listOrderReturns(OrderReturn, OTHER_SITE)
      assert.equal(foreign.counts.all, 0)
      const home = await listOrderReturns(OrderReturn, SITE)
      assert.ok(home.counts.all >= 2)
    })

    await check('soft delete and restore keep the revision moving', async () => {
      const removed = await softDeleteOrderReturn(OrderReturn, Order, SITE, first.id, first.revision, meta)
      assert.equal(removed.isDeleted, true)
      const restored = await restoreOrderReturn(OrderReturn, Order, SITE, first.id, removed.revision, meta)
      assert.equal(restored.isDeleted, false)
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Order return checks: ${checks} passed, ${notRun} not run\n`)
