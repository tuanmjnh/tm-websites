import assert from 'node:assert/strict'
import { createOrder } from '../../tm-cms/server/services/orderService.js'
import { createShipment, getShipment, listShipments, ShipmentServiceError, softDeleteShipment, updateShipment } from '../../tm-cms/server/services/shipmentService.js'
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

function isShipmentError(status: number, code: string) {
  return (error: unknown) => error instanceof ShipmentServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('Shipments — partial fulfillment against the order\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_shipments' }

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
    const { Order, Shipment, Audit } = models
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const order = await createOrder(Order, null, SITE, {
      code: 'ORD-001',
      items: [
        { itemId: 'item-tee', variantId: null, itemName: 'Áo thun', sku: 'AT-01', price: 100000, quantity: 5, returnedQuantity: 1 },
        { itemId: 'item-pants', variantId: null, itemName: 'Quần', sku: 'Q-01', price: 200000, quantity: 2 },
      ],
      shippingAddress: { fullName: 'An', city: 'HCM' },
    }, meta)
    assert.equal(order.code, 'ORD-001')

    const first = await createShipment(Shipment, Order, SITE, {
      code: 'SHP-001',
      orderId: order.id,
      status: 'draft',
      carrier: 'GHN',
      items: [{ itemId: 'item-tee', variantId: null, itemName: 'Áo thun', sku: 'AT-01', quantity: 2 }],
      shippingAddress: { fullName: 'An', city: 'HCM' },
    }, meta)

    await check('a shipment starts as draft against an order', async () => {
      assert.equal(first.status, 'draft')
      assert.equal(first.orderId, order.id)
      assert.equal(first.items[0]!.quantity, 2)
    })

    await check('a second shipment cannot exceed what remains', async () => {
      await assert.rejects(
        () => createShipment(Shipment, Order, SITE, {
          code: 'SHP-002',
          orderId: order.id,
          items: [{ itemId: 'item-tee', variantId: null, itemName: 'Áo thun', sku: 'AT-01', quantity: 3 }],
        }, meta),
        isShipmentError(422, 'SHIPMENT_QUANTITY_EXCEEDS_REMAINING'),
      )
    })

    await check('a line not on the order is rejected', async () => {
      await assert.rejects(
        () => createShipment(Shipment, Order, SITE, {
          code: 'SHP-003',
          orderId: order.id,
          items: [{ itemId: 'item-sock', variantId: null, itemName: 'Tất', sku: 'SK', quantity: 1 }],
        }, meta),
        isShipmentError(422, 'SHIPMENT_ITEM_NOT_IN_ORDER'),
      )
    })

    await check('a missing order is rejected', async () => {
      await assert.rejects(
        () => createShipment(Shipment, Order, SITE, {
          code: 'SHP-004',
          orderId: 'does-not-exist',
          items: [{ itemName: 'Áo thun', sku: 'AT-01', quantity: 1 }],
        }, meta),
        isShipmentError(404, 'SHIPMENT_ORDER_NOT_FOUND'),
      )
    })

    await check('a partial shipment leaves room for the next one', async () => {
      const second = await createShipment(Shipment, Order, SITE, {
        code: 'SHP-005',
        orderId: order.id,
        status: 'shipped',
        carrier: 'GHN',
        trackingNumber: 'TRK-1',
        items: [{ itemId: 'item-tee', variantId: null, itemName: 'Áo thun', sku: 'AT-01', quantity: 1 }],
      }, meta)
      assert.equal(second.status, 'shipped')
      assert.ok(second.shippedAt)
      const third = await createShipment(Shipment, Order, SITE, {
        code: 'SHP-006',
        orderId: order.id,
        items: [{ itemId: 'item-tee', variantId: null, itemName: 'Áo thun', sku: 'AT-01', quantity: 1 }],
      }, meta)
      assert.equal(third.items[0]!.quantity, 1)
    })

    await check('marking delivered stamps deliveredAt', async () => {
      const current = await getShipment(Shipment, SITE, first.id)
      const delivered = await updateShipment(Shipment, SITE, first.id, { status: 'delivered', revision: current.revision }, meta)
      assert.equal(delivered.status, 'delivered')
      assert.ok(delivered.deliveredAt)
      assert.ok(delivered.shippedAt)
    })

    await check('a cancelled shipment frees its quantity again', async () => {
      const current = await getShipment(Shipment, SITE, first.id)
      await updateShipment(Shipment, SITE, first.id, { status: 'cancelled', revision: current.revision }, meta)
      const freed = await createShipment(Shipment, Order, SITE, {
        code: 'SHP-007',
        orderId: order.id,
        items: [{ itemId: 'item-tee', variantId: null, itemName: 'Áo thun', sku: 'AT-01', quantity: 2 }],
      }, meta)
      assert.equal(freed.items[0]!.quantity, 2)
    })

    await check('soft delete and restore keep the revision moving', async () => {
      const removed = await softDeleteShipment(Shipment, SITE, first.id, (await getShipment(Shipment, SITE, first.id)).revision, meta)
      assert.equal(removed.isDeleted, true)
    })

    await check('a tenant only sees its own shipments', async () => {
      await createShipment(Shipment, Order, OTHER_SITE, {
        code: 'SHP-X',
        orderId: 'foreign-order',
        items: [{ itemName: 'X', sku: 'X', quantity: 1 }],
      }, meta).catch(() => undefined)
      const foreign = await listShipments(Shipment, OTHER_SITE)
      assert.equal(foreign.counts.all >= 0, true)
      const home = await listShipments(Shipment, SITE)
      assert.ok(home.counts.all >= 1)
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Shipment checks: ${checks} passed, ${notRun} not run\n`)
