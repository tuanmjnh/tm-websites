import assert from 'node:assert/strict'
import { createOrder } from '../../tm-cms/server/services/orderService.js'
import { createShipment, getShipment, updateShipment, softDeleteShipment } from '../../tm-cms/server/services/shipmentService.js'
import { registerSerialNumbers } from '../../tm-cms/server/services/serialNumberService.js'
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

const SITE = 'sentuan'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('Shipment stock movements — ship/cancel/return/delete + serial sync\\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_shipment_movements' }

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
    const { Order, Shipment, Inventory, InventoryTransaction, SerialNumber, Audit } = models
    const meta = { audit: { model: Audit, actor: ACTOR } }

    await Inventory.create({ siteId: SITE, itemId: 'item-tee', variantId: null, warehouseId: 'wh-1', sku: 'AT-01', quantityOnHand: 10, revision: 1 })

    await registerSerialNumbers(SerialNumber, SITE, SITE, [
      { serial: 'SHIP-S1', itemId: 'item-tee', variantId: null, warehouseId: 'wh-1' },
    ], meta)

    const order = await createOrder(Order, null, SITE, {
      code: 'ORD-MV',
      warehouseId: 'wh-1',
      items: [{ itemId: 'item-tee', variantId: null, itemName: 'Áo thun', sku: 'AT-01', price: 100000, quantity: 5 }],
    }, meta)

    await check('ship decrements balance, records export tx and marks serial sold', async () => {
      const shipment = await createShipment(Shipment, Order, SITE, {
        code: 'SHP-MV1',
        orderId: order.id,
        status: 'shipped',
        items: [{ itemId: 'item-tee', variantId: null, itemName: 'Áo thun', sku: 'AT-01', quantity: 2, serials: ['SHIP-S1'] }],
      }, { audit: meta.audit, serialNumberModel: SerialNumber }, Inventory, InventoryTransaction)

      const inv = await Inventory.findOne({ siteId: SITE, itemId: 'item-tee', warehouseId: 'wh-1' }).lean()
      assert.equal(inv?.quantityOnHand, 8)

      const txs = await InventoryTransaction.find({ siteId: SITE, referenceModel: 'Shipment' }).lean()
      assert.equal(txs.length, 1)
      assert.equal(txs[0].type, 'export')
      assert.equal(txs[0].quantityChange, -2)

      const serial = await SerialNumber.findOne({ siteId: SITE, serial: 'SHIP-S1' }).lean()
      assert.equal(serial?.status, 'sold')
      assert.equal(serial?.orderId, order.id)
    })

    await check('cancel restores balance and records import tx', async () => {
      const current = await getShipment(Shipment, SITE, (await Shipment.findOne({ siteId: SITE, code: 'SHP-MV1' }).lean())!._id.toString())
      const cancelled = await updateShipment(Shipment, SITE, current.id, { status: 'cancelled', revision: current.revision }, {
        audit: meta.audit, serialNumberModel: SerialNumber,
      }, Inventory, InventoryTransaction, Order)

      assert.equal(cancelled.status, 'cancelled')

      const inv = await Inventory.findOne({ siteId: SITE, itemId: 'item-tee', warehouseId: 'wh-1' }).lean()
      assert.equal(inv?.quantityOnHand, 10)

      const txs = await InventoryTransaction.find({ siteId: SITE, referenceModel: 'Shipment' }).lean()
      assert.equal(txs.length, 2)
      assert.ok(txs.some(t => t.type === 'import'))
    })

    // Fresh balance/serial for return + delete paths
    await Inventory.updateOne({ siteId: SITE, itemId: 'item-tee', warehouseId: 'wh-1' }, { $set: { quantityOnHand: 10, revision: 2 } })
    await registerSerialNumbers(SerialNumber, SITE, SITE, [
      { serial: 'SHIP-S2', itemId: 'item-tee', variantId: null, warehouseId: 'wh-1' },
    ], meta)

    const order2 = await createOrder(Order, null, SITE, {
      code: 'ORD-MV2',
      warehouseId: 'wh-1',
      items: [{ itemId: 'item-tee', variantId: null, itemName: 'Áo thun', sku: 'AT-01', price: 100000, quantity: 5 }],
    }, meta)

    await check('return restores balance via return_in and marks serial returned', async () => {
      const shipment = await createShipment(Shipment, Order, SITE, {
        code: 'SHP-MV2',
        orderId: order2.id,
        status: 'shipped',
        items: [{ itemId: 'item-tee', variantId: null, itemName: 'Áo thun', sku: 'AT-01', quantity: 1, serials: ['SHIP-S2'] }],
      }, { audit: meta.audit, serialNumberModel: SerialNumber }, Inventory, InventoryTransaction)

      const cur = await getShipment(Shipment, SITE, shipment.id)
      await updateShipment(Shipment, SITE, shipment.id, { status: 'returned', revision: cur.revision }, {
        audit: meta.audit, serialNumberModel: SerialNumber,
      }, Inventory, InventoryTransaction, Order)

      const inv = await Inventory.findOne({ siteId: SITE, itemId: 'item-tee', warehouseId: 'wh-1' }).lean()
      assert.equal(inv?.quantityOnHand, 10)

      const serial = await SerialNumber.findOne({ siteId: SITE, serial: 'SHIP-S2' }).lean()
      assert.equal(serial?.status, 'returned')
    })

    await registerSerialNumbers(SerialNumber, SITE, SITE, [
      { serial: 'SHIP-S3', itemId: 'item-tee', variantId: null, warehouseId: 'wh-1' },
    ], meta)

    const order3 = await createOrder(Order, null, SITE, {
      code: 'ORD-MV3',
      warehouseId: 'wh-1',
      items: [{ itemId: 'item-tee', variantId: null, itemName: 'Áo thun', sku: 'AT-01', price: 100000, quantity: 5 }],
    }, meta)

    await check('soft delete restores balance', async () => {
      const shipment = await createShipment(Shipment, Order, SITE, {
        code: 'SHP-MV3',
        orderId: order3.id,
        status: 'shipped',
        items: [{ itemId: 'item-tee', variantId: null, itemName: 'Áo thun', sku: 'AT-01', quantity: 1, serials: ['SHIP-S3'] }],
      }, { audit: meta.audit, serialNumberModel: SerialNumber }, Inventory, InventoryTransaction)

      const invBefore = await Inventory.findOne({ siteId: SITE, itemId: 'item-tee', warehouseId: 'wh-1' }).lean()
      assert.equal(invBefore?.quantityOnHand, 9)

      const cur = await getShipment(Shipment, SITE, shipment.id)
      await softDeleteShipment(Shipment, SITE, shipment.id, cur.revision, {
        audit: meta.audit, serialNumberModel: SerialNumber,
      }, Inventory, InventoryTransaction, Order)

      const invAfter = await Inventory.findOne({ siteId: SITE, itemId: 'item-tee', warehouseId: 'wh-1' }).lean()
      assert.equal(invAfter?.quantityOnHand, 10)
    })

    await check('shipment without tracked balance still succeeds (best-effort)', async () => {
      const order4 = await createOrder(Order, null, SITE, {
        code: 'ORD-MV4',
        warehouseId: 'wh-999',
        items: [{ itemId: 'item-ghost', variantId: null, itemName: 'Ghost', sku: 'G', price: 1, quantity: 2 }],
      }, meta)
      const shipment = await createShipment(Shipment, Order, SITE, {
        code: 'SHP-MV4',
        orderId: order4.id,
        status: 'shipped',
        items: [{ itemId: 'item-ghost', variantId: null, itemName: 'Ghost', sku: 'G', quantity: 1 }],
      }, { audit: meta.audit, serialNumberModel: SerialNumber }, Inventory, InventoryTransaction)
      assert.equal(shipment.status, 'shipped')
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\\n${process.exitCode ? '❌' : '✅'} Shipment movement checks: ${checks} passed, ${notRun} not run\\n`)