import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
import { checkSupplierPrice, supplierPriceHistory, SupplierPriceError } from '../../tm-cms/server/services/supplierPriceService.js'
import { createPurchaseOrder } from '../../tm-cms/server/services/purchaseOrderService.js'
import { receivePurchaseOrder } from '../../tm-cms/server/services/purchaseOrderService.js'
import { createSupplier } from '../../tm-cms/server/services/supplierService.js'
import { createWarehouse } from '../../tm-cms/server/services/warehouseService.js'
import { createInventory } from '../../tm-cms/server/services/inventoryService.js'
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

function isPriceError(status: number, code: string) {
  return (error: unknown) => error instanceof SupplierPriceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date()
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY)

console.log('Supplier price history — what was actually paid, per receipt\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_supplier_prices')

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
    const { Warehouse, Inventory, InventoryTransaction, PurchaseOrder, Supplier, Audit } = await prepareDatabase(connection)
    const models = { PurchaseOrder, InventoryTransaction }
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const warehouse = await createWarehouse(Warehouse, SITE, { code: 'WH-001', title: 'Kho chính' }, meta)
    const supplier = await createSupplier(Supplier, SITE, { code: 'SUP-001', title: 'Nhà cung cấp A', status: 'active' }, meta)
    const otherSupplier = await createSupplier(Supplier, SITE, { code: 'SUP-002', title: 'Nhà cung cấp B', status: 'active' }, meta)

    for (const [itemId, variantId] of [['item-tee', null], ['item-tee', 'var-red'], ['item-bag', null]] as const) {
      await createInventory(Inventory, Warehouse, SITE, {
        itemId,
        variantId,
        warehouseId: warehouse.id,
        sku: `${itemId}-${variantId ?? 'base'}`,
        quantityOnHand: 0,
      }, meta)
    }

    const receive = async (code: string, supplierId: string, itemId: string, variantId: string | null, quantity: number, unitCost: number, when: Date) => {
      const order = await createPurchaseOrder(PurchaseOrder, Supplier, SITE, {
        code,
        supplierId,
        warehouseId: warehouse.id,
        items: [{ itemId, variantId, itemName: 'Áo thun', sku: `SKU-${itemId}`, quantity, unitCost }],
      }, meta)
      const ordered = await receivePurchaseOrder(PurchaseOrder, Inventory, InventoryTransaction, SITE, order.id, {
        revision: order.revision,
        lines: [{ itemId, variantId, receivedQuantity: quantity }],
      }, meta)
      assert.equal(ordered.status, 'received')
      // The service stamps receipts with "now"; move them back so the history has an order.
      const rows = await InventoryTransaction.find({ siteId: SITE, referenceId: order.id }).lean<{ _id: unknown }[]>()
      for (const row of rows) {
        await InventoryTransaction.collection.updateOne({ _id: row._id }, { $set: { createdAt: when, updatedAt: when } })
      }
    }

    await receive('PO-001', supplier.id, 'item-tee', null, 2, 100_000, daysAgo(20))
    await receive('PO-002', supplier.id, 'item-tee', null, 6, 120_000, daysAgo(5))
    await receive('PO-003', otherSupplier.id, 'item-tee', null, 3, 90_000, daysAgo(10))
    await receive('PO-004', supplier.id, 'item-tee', 'var-red', 4, 130_000, daysAgo(8))

    const history = await supplierPriceHistory(models, SITE)

    const teeBase = () => history.data.find(row => row.itemId === 'item-tee' && row.variantId === null && row.supplierId === supplier.id)!

    await check('groups receipts by supplier and item, newest price first', async () => {
      assert.equal(history.data.length, 3, 'two suppliers for the tee, one for the red variant')
      const row = teeBase()
      assert.equal(row.lastUnitCost, 120_000)
      assert.equal(row.lastQuantity, 6)
      assert.equal(row.observations, 2)
      assert.equal(row.sku, 'SKU-item-tee')
      assert.equal(row.history.length, 2)
      assert.equal(row.history.at(-1)!.purchaseOrderCode, 'PO-002')
    })

    await check('average is weighted by received quantity, not a plain mean', async () => {
      const row = teeBase()
      // (2 × 100k + 6 × 120k) / 8 = 115k, not (100k + 120k) / 2 = 110k.
      assert.equal(row.averageUnitCost, 115_000)
      assert.equal(row.totalQuantity, 8)
      assert.equal(row.totalValue, 920_000)
    })

    await check('min, max and the change from the previous distinct price', async () => {
      const row = teeBase()
      assert.equal(row.minUnitCost, 100_000)
      assert.equal(row.maxUnitCost, 120_000)
      assert.equal(row.previousUnitCost, 100_000)
      assert.equal(row.changePercent, 20)
    })

    await check('variants are their own price series', async () => {
      const variant = history.data.find(row => row.variantId === 'var-red')!
      assert.equal(variant.lastUnitCost, 130_000)
      assert.equal(variant.changePercent, null, 'no previous price to compare')
      assert.equal(variant.previousUnitCost, null)
    })

    await check('a supplier filter narrows the report to that supplier', async () => {
      const onlyB = await supplierPriceHistory(models, SITE, { supplierId: otherSupplier.id })
      assert.equal(onlyB.data.length, 1)
      assert.equal(onlyB.data[0]!.lastUnitCost, 90_000)
      assert.equal(onlyB.summary.suppliers, 1)
      assert.equal(onlyB.summary.observations, 1)
    })

    await check('an ordered-but-never-received line is a quote, not a price paid', async () => {
      const pending = await createPurchaseOrder(PurchaseOrder, Supplier, SITE, {
        code: 'PO-900',
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        status: 'ordered',
        items: [{ itemId: 'item-bag', variantId: null, itemName: 'Túi', sku: 'SKU-bag', quantity: 5, unitCost: 200_000 }],
      }, meta)
      assert.equal(pending.status, 'ordered')
      const after = await supplierPriceHistory(models, SITE, { itemId: 'item-bag' })
      assert.equal(after.data.length, 0)
    })

    await check('another tenant sees none of it', async () => {
      const foreign = await supplierPriceHistory(models, OTHER_SITE)
      assert.equal(foreign.data.length, 0)
      assert.equal(foreign.summary.items, 0)
    })

    await check('a receipt outside the window is left out', async () => {
      const narrow = await supplierPriceHistory(models, SITE, { from: daysAgo(15).toISOString().slice(0, 10) })
      const row = narrow.data.find(entry => entry.itemId === 'item-tee' && entry.variantId === null && entry.supplierId === supplier.id)!
      assert.equal(row.observations, 1)
      assert.equal(row.lastUnitCost, 120_000)
    })

    await check('price check flags a jump above the threshold', async () => {
      const result = await checkSupplierPrice(models, SITE, {
        supplierId: supplier.id,
        itemId: 'item-tee',
        unitCost: 150_000,
      })
      assert.equal(result.hasHistory, true)
      assert.equal(result.lastUnitCost, 120_000)
      assert.equal(result.changePercent, 25)
      assert.equal(result.needsReview, true)
      assert.match(result.reason, /tăng 25%/)
    })

    await check('price check passes a price within the threshold', async () => {
      const result = await checkSupplierPrice(models, SITE, {
        supplierId: supplier.id,
        itemId: 'item-tee',
        unitCost: 125_000,
        thresholdPercent: 10,
      })
      assert.equal(result.needsReview, false)
      assert.equal(result.changePercent, 4.2)
      assert.match(result.reason, /Trong ngưỡng/)
    })

    await check('a first purchase gets no verdict', async () => {
      const result = await checkSupplierPrice(models, SITE, {
        supplierId: supplier.id,
        itemId: 'item-bag',
        unitCost: 999_000,
      })
      assert.equal(result.hasHistory, false)
      assert.equal(result.needsReview, false)
      assert.equal(result.changePercent, null)
      assert.match(result.reason, /Chưa có lần nhập/)
    })

    await check('bad input is refused', async () => {
      await assert.rejects(
        () => supplierPriceHistory(models, SITE, { from: '2026-02-31' }),
        isPriceError(422, 'PRICE_RANGE_INVALID'),
      )
      await assert.rejects(
        () => supplierPriceHistory(models, SITE, { from: '2019-01-01', to: '2026-01-01' }),
        isPriceError(422, 'PRICE_RANGE_TOO_LONG'),
      )
      await assert.rejects(
        () => checkSupplierPrice(models, SITE, { itemId: '', unitCost: 1 }),
        isPriceError(422, 'PRICE_CHECK_ITEM_REQUIRED'),
      )
      await assert.rejects(
        () => checkSupplierPrice(models, SITE, { itemId: 'item-tee', unitCost: -1 }),
        isPriceError(422, 'PRICE_CHECK_COST_INVALID'),
      )
      await assert.rejects(
        () => checkSupplierPrice(models, SITE, { itemId: 'item-tee', unitCost: 1, thresholdPercent: 400 }),
        isPriceError(422, 'PRICE_CHECK_THRESHOLD_INVALID'),
      )
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Supplier price checks: ${checks} passed, ${notRun} not run\n`)
