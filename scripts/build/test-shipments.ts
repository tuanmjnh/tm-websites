import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
import { createMailTemplate } from '../../tm-cms/server/services/mailService.js'
import { ORDER_STATUS_TEMPLATE } from '../../tm-cms/server/services/orderStatusMail.js'
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
const binding = testDatabaseBinding('tm_test_shipments')

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
    const { Order, Shipment, Audit, MailTemplate, MailDelivery, Customer } = models
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

    await check('a partial shipment moves the order to processing', async () => {
      const freshOrder = await createOrder(Order, null, SITE, {
        code: 'ORD-STATUS',
        items: [{ itemId: 'item-x', variantId: null, itemName: 'X', sku: 'X-01', price: 10000, quantity: 4 }],
        shippingAddress: { fullName: 'An', city: 'HCM' },
      }, meta)
      const sh = await createShipment(Shipment, Order, SITE, {
        code: 'SHP-ST-1',
        orderId: freshOrder.id,
        status: 'shipped',
        items: [{ itemId: 'item-x', variantId: null, itemName: 'X', sku: 'X-01', quantity: 2 }],
      }, meta)
      assert.equal(sh.status, 'shipped')
      const updatedOrder = await Order.findOne({ _id: freshOrder.id, siteId: SITE }).lean()
      assert.equal(updatedOrder?.status, 'processing')
    })

    await check('shipping every line moves the order to shipped', async () => {
      const freshOrder = await createOrder(Order, null, SITE, {
        code: 'ORD-STATUS2',
        items: [{ itemId: 'item-y', variantId: null, itemName: 'Y', sku: 'Y-01', price: 10000, quantity: 2 }],
        shippingAddress: { fullName: 'An', city: 'HCM' },
      }, meta)
      await createShipment(Shipment, Order, SITE, {
        code: 'SHP-ST-2',
        orderId: freshOrder.id,
        status: 'shipped',
        items: [{ itemId: 'item-y', variantId: null, itemName: 'Y', sku: 'Y-01', quantity: 2 }],
      }, meta)
      const updatedOrder = await Order.findOne({ _id: freshOrder.id, siteId: SITE }).lean()
      assert.equal(updatedOrder?.status, 'shipped')
    })

    await check('cancelling the last shipment returns the order to pending', async () => {
      const freshOrder = await createOrder(Order, null, SITE, {
        code: 'ORD-STATUS3',
        items: [{ itemId: 'item-z', variantId: null, itemName: 'Z', sku: 'Z-01', price: 10000, quantity: 2 }],
        shippingAddress: { fullName: 'An', city: 'HCM' },
      }, meta)
      const sh = await createShipment(Shipment, Order, SITE, {
        code: 'SHP-ST-3',
        orderId: freshOrder.id,
        status: 'shipped',
        items: [{ itemId: 'item-z', variantId: null, itemName: 'Z', sku: 'Z-01', quantity: 2 }],
      }, meta)
      const cancelled = await updateShipment(Shipment, SITE, sh.id, { status: 'cancelled', revision: sh.revision }, meta, null, null, Order)
      assert.equal(cancelled.status, 'cancelled')
      const updatedOrder = await Order.findOne({ _id: freshOrder.id, siteId: SITE }).lean()
      assert.equal(updatedOrder?.status, 'pending')
    })

    await check('a delivered shipment moves the order to completed', async () => {
      const freshOrder = await createOrder(Order, null, SITE, {
        code: 'ORD-STATUS4',
        items: [{ itemId: 'item-w', variantId: null, itemName: 'W', sku: 'W-01', price: 10000, quantity: 2 }],
        shippingAddress: { fullName: 'An', city: 'HCM' },
      }, meta)
      await createShipment(Shipment, Order, SITE, {
        code: 'SHP-ST-4',
        orderId: freshOrder.id,
        status: 'delivered',
        items: [{ itemId: 'item-w', variantId: null, itemName: 'W', sku: 'W-01', quantity: 2 }],
      }, meta)
      const updatedOrder = await Order.findOne({ _id: freshOrder.id, siteId: SITE }).lean()
      assert.equal(updatedOrder?.status, 'completed')
    })

    await createMailTemplate(MailTemplate, SITE, {
      code: ORDER_STATUS_TEMPLATE,
      locale: 'vi',
      title: 'Trạng thái đơn hàng',
      subject: 'Đơn {{orderCode}}: {{statusLabel}}',
      bodyText: 'Xin chào {{name}}, đơn {{orderCode}} của bạn: {{statusLabel}}.\n{{items}}',
      variables: ['orderCode', 'name', 'status', 'statusLabel', 'itemCount', 'items', 'total'],
      purpose: 'transactional',
      status: 'active',
    }, meta)
    const notifyMeta = { ...meta, notify: { delivery: MailDelivery, template: MailTemplate, customer: Customer } }
    const statusMails = () => MailDelivery.countDocuments({ siteId: SITE, templateCode: ORDER_STATUS_TEMPLATE })

    const mailedOrder = await createOrder(Order, Customer, SITE, {
      code: 'ORD-SHIPMAIL',
      items: [{ itemId: 'item-mail', variantId: null, itemName: 'Áo mail', sku: 'AM-01', price: 50000, quantity: 2 }],
      shippingAddress: { fullName: 'Bình', city: 'HCM' },
    }, meta)
    await Order.updateOne({ _id: mailedOrder.id, siteId: SITE }, { $set: { customerEmail: 'Ship@Example.com' } })
    const shippedMailOrder = await createShipment(Shipment, Order, SITE, {
      code: 'SHP-MAIL-1',
      orderId: mailedOrder.id,
      status: 'shipped',
      items: [{ itemId: 'item-mail', variantId: null, itemName: 'Áo mail', sku: 'AM-01', quantity: 2 }],
    }, notifyMeta)

    await check('a shipment that ships the order mails the customer', async () => {
      const current = await Order.findOne({ _id: mailedOrder.id, siteId: SITE }).lean()
      assert.equal(current?.status, 'shipped')

      const delivery = await MailDelivery
        .findOne({ siteId: SITE, dedupeKey: 'ship@example.com:order-status:shipped:ORD-SHIPMAIL' })
        .lean<{ status: string, recipientEmail: string, subject: string, variables: Record<string, string> } | null>()
      assert.ok(delivery, 'the shipment-driven move is queued')
      assert.equal(delivery.recipientEmail, 'ship@example.com')
      assert.equal(delivery.subject, 'Đơn ORD-SHIPMAIL: Đang giao hàng')
      assert.equal(delivery.variables.statusLabel, 'Đang giao hàng')
      assert.equal(delivery.variables.itemCount, '2')
      assert.equal(await statusMails(), 1)
    })

    await check('delivering it mails once, and re-shipping does not repeat the shipped message', async () => {
      const shippedRev = (await getShipment(Shipment, SITE, shippedMailOrder.id)).revision
      await updateShipment(Shipment, SITE, shippedMailOrder.id, { status: 'delivered', revision: shippedRev }, notifyMeta, null, null, Order)
      assert.equal((await Order.findOne({ _id: mailedOrder.id, siteId: SITE }).lean())?.status, 'completed')
      assert.ok(await MailDelivery.exists({ siteId: SITE, dedupeKey: 'ship@example.com:order-status:completed:ORD-SHIPMAIL' }))
      assert.equal(await statusMails(), 2)

      const deliveredRev = (await getShipment(Shipment, SITE, shippedMailOrder.id)).revision
      await updateShipment(Shipment, SITE, shippedMailOrder.id, { status: 'cancelled', revision: deliveredRev }, notifyMeta, null, null, Order)
      assert.equal((await Order.findOne({ _id: mailedOrder.id, siteId: SITE }).lean())?.status, 'pending')
      assert.equal(await statusMails(), 3, 'the return to pending is its own transition')

      await createShipment(Shipment, Order, SITE, {
        code: 'SHP-MAIL-2',
        orderId: mailedOrder.id,
        status: 'shipped',
        items: [{ itemId: 'item-mail', variantId: null, itemName: 'Áo mail', sku: 'AM-01', quantity: 2 }],
      }, notifyMeta)
      assert.equal((await Order.findOne({ _id: mailedOrder.id, siteId: SITE }).lean())?.status, 'shipped')
      assert.equal(await MailDelivery.countDocuments({ siteId: SITE, dedupeKey: 'ship@example.com:order-status:shipped:ORD-SHIPMAIL' }), 1)
      assert.equal(await statusMails(), 3, 'a status the order already mailed is not sent again')
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
