import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
import {
  createOrder,
  getOrder,
  restoreOrder,
  softDeleteOrder,
  updateOrder,
  OrderServiceError,
} from '../../tm-cms/server/services/orderService.js'
import {
  createOrderReturn,
  updateOrderReturn,
} from '../../tm-cms/server/services/orderReturnService.js'
import { createInventory, getInventory, InventoryServiceError } from '../../tm-cms/server/services/inventoryService.js'
import { createWarehouse } from '../../tm-cms/server/services/warehouseService.js'
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
function isInventoryError(status: number, code: string) {
  return (error: unknown) => error instanceof InventoryServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }
const ITEM_A = '6af29168b8b81d8976380e01'
const ITEM_B = '6af29168b8b81d8976380e02'

console.log('Order stock — reserve, fulfil, release, restock (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_order_stock')

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
    const { Order, OrderReturn, Inventory, InventoryTransaction, Warehouse, Audit } = models
    const audit = { model: Audit, actor: ACTOR }
    const stock = { inventory: Inventory, transactions: InventoryTransaction }
    const meta = { audit, stock }

    const warehouse = await createWarehouse(Warehouse, SITE, {
      code: 'WH-STK-1',
      title: 'Kho bán hàng',
      status: 'active',
    }, { audit })
    const otherWarehouse = await createWarehouse(Warehouse, SITE, {
      code: 'WH-STK-2',
      title: 'Kho dự phòng',
      status: 'active',
    }, { audit })

    const balanceA = await createInventory(Inventory, Warehouse, SITE, {
      itemId: ITEM_A,
      variantId: 'SKU-A',
      warehouseId: warehouse.id,
      sku: 'SKU-A',
      quantityOnHand: 10,
    }, { audit })
    const balanceB = await createInventory(Inventory, Warehouse, SITE, {
      itemId: ITEM_B,
      variantId: null,
      warehouseId: warehouse.id,
      sku: 'SKU-B',
      quantityOnHand: 3,
    }, { audit })
    await createInventory(Inventory, Warehouse, SITE, {
      itemId: ITEM_A,
      variantId: 'SKU-A',
      warehouseId: otherWarehouse.id,
      sku: 'SKU-A',
      quantityOnHand: 5,
    }, { audit })

    const orderBody = (overrides: Record<string, unknown> = {}) => ({
      code: `ORD-STK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      status: 'pending',
      warehouseId: warehouse.id,
      items: [
        { itemId: ITEM_A, variantId: 'SKU-A', itemName: 'Sản phẩm A', sku: 'SKU-A', price: 100000, quantity: 2 },
      ],
      ...overrides,
    })

    const pending = await createOrder(Order, null, SITE, orderBody(), meta)
    const afterReserve = await getInventory(Inventory, SITE, balanceA.id)
    const afterReserveB = await getInventory(Inventory, SITE, balanceB.id)

    await check('a pending order reserves each line', async () => {
      assert.equal(afterReserve.quantityReserved, 2)
      assert.equal(afterReserve.quantityAvailable, 8)
      assert.equal(afterReserveB.quantityReserved, 0)
    })

    await check('reservation does not write an inventory transaction yet', async () => {
      assert.equal(await InventoryTransaction.countDocuments({ siteId: SITE }), 0)
    })

    await check('an order without a warehouse leaves stock untouched', async () => {
      const untouched = await createOrder(Order, null, SITE, orderBody({ warehouseId: null }), meta)
      assert.equal(untouched.warehouseId, null)
      const balance = await getInventory(Inventory, SITE, balanceA.id)
      assert.equal(balance.quantityReserved, 2)
    })

    await check('insufficient stock rejects and leaves no order behind', async () => {
      const before = await Order.countDocuments({ siteId: SITE })
      await assert.rejects(
        () => createOrder(Order, null, SITE, orderBody({
          code: 'ORD-STK-OVER',
          items: [{ itemId: ITEM_B, variantId: null, itemName: 'Sản phẩm B', sku: 'SKU-B', price: 50000, quantity: 99 }],
        }), meta),
        isInventoryError(409, 'ORDER_STOCK_INSUFFICIENT'),
      )
      const balance = await getInventory(Inventory, SITE, balanceB.id)
      assert.equal(balance.quantityReserved, 0)
      assert.equal(await Order.countDocuments({ siteId: SITE }), before, 'order document removed')
    })


    await check('cancelling an order releases its reservation', async () => {
      const cancelled = await updateOrder(Order, SITE, pending.id, { revision: pending.revision, status: 'cancelled' }, meta)
      assert.equal(cancelled.status, 'cancelled')
      const balance = await getInventory(Inventory, SITE, balanceA.id)
      assert.equal(balance.quantityReserved, 0)
      assert.equal(balance.quantityOnHand, 10)
    })

    await check('reactivating a cancelled order reserves again', async () => {
      const active = await updateOrder(Order, SITE, pending.id, { revision: pending.revision + 1, status: 'processing' }, meta)
      assert.equal(active.status, 'processing')
      const balance = await getInventory(Inventory, SITE, balanceA.id)
      assert.equal(balance.quantityReserved, 2)
    })

    await check('editing lines reconciles only the difference', async () => {
      const current = await getOrder(Order, SITE, pending.id)
      await updateOrder(Order, SITE, pending.id, {
        revision: current.revision,
        items: [
          { itemId: ITEM_A, variantId: 'SKU-A', itemName: 'Sản phẩm A', sku: 'SKU-A', price: 100000, quantity: 1 },
          { itemId: ITEM_B, variantId: null, itemName: 'Sản phẩm B', sku: 'SKU-B', price: 50000, quantity: 2 },
        ],
      }, meta)
      const a = await getInventory(Inventory, SITE, balanceA.id)
      const b = await getInventory(Inventory, SITE, balanceB.id)
      assert.equal(a.quantityReserved, 1)
      assert.equal(b.quantityReserved, 2)
    })

    await check('moving the order to another warehouse moves the reservation', async () => {
      const current = await getOrder(Order, SITE, pending.id)
      await updateOrder(Order, SITE, pending.id, {
        revision: current.revision,
        warehouseId: otherWarehouse.id,
        items: [{ itemId: ITEM_A, variantId: 'SKU-A', itemName: 'Sản phẩm A', sku: 'SKU-A', price: 100000, quantity: 2 }],
      }, meta)
      const oldBalance = await getInventory(Inventory, SITE, balanceA.id)
      const otherBalance = await Inventory.findOne({ siteId: SITE, itemId: ITEM_A, variantId: 'SKU-A', warehouseId: otherWarehouse.id }).lean<{ quantityReserved: number } | null>()
      assert.equal(oldBalance.quantityReserved, 0)
      assert.equal(otherBalance?.quantityReserved, 2)
    })

    await check('soft delete releases and restore reserves', async () => {
      const current = await getOrder(Order, SITE, pending.id)
      await softDeleteOrder(Order, SITE, pending.id, current.revision, meta)
      const other = await Inventory.findOne({ siteId: SITE, itemId: ITEM_A, variantId: 'SKU-A', warehouseId: otherWarehouse.id }).lean<{ quantityReserved: number } | null>()
      assert.equal(other?.quantityReserved, 0)

      await restoreOrder(Order, SITE, pending.id, current.revision + 1, meta)
      const restored = await Inventory.findOne({ siteId: SITE, itemId: ITEM_A, variantId: 'SKU-A', warehouseId: otherWarehouse.id }).lean<{ quantityReserved: number } | null>()
      assert.equal(restored?.quantityReserved, 2)
    })

    await check('shipping consumes the reservation and writes an export transaction', async () => {
      const current = await getOrder(Order, SITE, pending.id)
      await updateOrder(Order, SITE, pending.id, { revision: current.revision, status: 'shipped' }, meta)
      const other = await Inventory.findOne({ siteId: SITE, itemId: ITEM_A, variantId: 'SKU-A', warehouseId: otherWarehouse.id }).lean<{ quantityOnHand: number, quantityReserved: number } | null>()
      assert.equal(other?.quantityOnHand, 3)
      assert.equal(other?.quantityReserved, 0)
      const tx = await InventoryTransaction.find({ siteId: SITE, referenceModel: 'Order', type: 'export' }).lean<{ quantityChange: number }[]>()
      assert.equal(tx.length, 1)
      assert.equal(tx[0]!.quantityChange, -2)
    })

    await check('a completed POS order sells straight from stock', async () => {
      const pos = await createOrder(Order, null, SITE, orderBody({
        status: 'completed',
        items: [{ itemId: ITEM_B, variantId: null, itemName: 'Sản phẩm B', sku: 'SKU-B', price: 50000, quantity: 1 }],
      }), meta)
      assert.equal(pos.status, 'completed')
      const balance = await getInventory(Inventory, SITE, balanceB.id)
      assert.equal(balance.quantityOnHand, 2)
      assert.equal(balance.quantityReserved, 0)
    })

    await check('a completed order blocks checkout when stock is short', async () => {
      await assert.rejects(
        () => createOrder(Order, null, SITE, orderBody({
          status: 'completed',
          items: [{ itemId: ITEM_B, variantId: null, itemName: 'Sản phẩm B', sku: 'SKU-B', price: 50000, quantity: 50 }],
        }), meta),
        isInventoryError(409, 'ORDER_STOCK_INSUFFICIENT'),
      )
      const balance = await getInventory(Inventory, SITE, balanceB.id)
      assert.equal(balance.quantityOnHand, 2)
    })

    await check('an approved return restocks the shipped order', async () => {
      const shipped = await getOrder(Order, SITE, pending.id)
      const returned = await createOrderReturn(OrderReturn, Order, SITE, {
        code: 'RET-STK-001',
        orderId: shipped.id,
        status: 'approved',
        items: [{ itemId: ITEM_A, variantId: 'SKU-A', itemName: 'Sản phẩm A', sku: 'SKU-A', quantity: 1, unitPrice: 100000 }],
        refundAmount: 100000,
      }, meta)
      const other = await Inventory.findOne({ siteId: SITE, itemId: ITEM_A, variantId: 'SKU-A', warehouseId: otherWarehouse.id }).lean<{ quantityOnHand: number } | null>()
      assert.equal(other?.quantityOnHand, 4)

      await updateOrderReturn(OrderReturn, Order, SITE, returned.id, { status: 'cancelled', revision: returned.revision }, meta)
      const reversed = await Inventory.findOne({ siteId: SITE, itemId: ITEM_A, variantId: 'SKU-A', warehouseId: otherWarehouse.id }).lean<{ quantityOnHand: number } | null>()
      assert.equal(reversed?.quantityOnHand, 3)
    })

    await check('the order service surfaces reservation conflicts instead of silently skipping', async () => {
      const order = await createOrder(Order, null, SITE, orderBody({ code: 'ORD-STK-LOCK' }), meta)
      const current = await getOrder(Order, SITE, order.id)
      await assert.rejects(
        () => updateOrder(Order, SITE, order.id, { revision: current.revision + 5, status: 'cancelled' }, meta),
        isOrderError(409, 'ORDER_REVISION_CONFLICT'),
      )
      const balance = await getInventory(Inventory, SITE, balanceA.id)
      assert.equal(balance.quantityReserved, 2, 'failed update rolled the reservation back')
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Order stock checks: ${checks} passed, ${notRun} not run\n`)
