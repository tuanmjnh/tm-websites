import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
import {
  WarehouseServiceError,
  createWarehouse,
} from '../../tm-cms/server/services/warehouseService.js'
import {
  InventoryServiceError,
  createInventory,
  getInventory,
} from '../../tm-cms/server/services/inventoryService.js'
import {
  InventoryTransactionServiceError,
  listInventoryTransactions,
  getInventoryTransaction,
  recordInventoryTransaction,
} from '../../tm-cms/server/services/inventoryTransactionService.js'
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

function isTransactionError(status: number, code: string) {
  return (error: unknown) => error instanceof InventoryTransactionServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('Inventory transactions — stock ledger (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_inventory_transaction_service')

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
    await dropTestDatabase(connection)
    const { Warehouse, Inventory, InventoryTransaction, Audit } = await prepareDatabase(connection)
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const warehouse = await createWarehouse(Warehouse, SITE, {
      code: 'WH-001',
      title: 'Kho chính',
      status: 'active',
    }, meta)

    const balance = await createInventory(Inventory, Warehouse, SITE, {
      itemId: 'item-1',
      variantId: null,
      warehouseId: warehouse.id,
      sku: 'SKU-001',
      quantityOnHand: 10,
      lowStockThreshold: 3,
    }, meta)

    const first = await recordInventoryTransaction(Inventory, InventoryTransaction, SITE, {
      inventoryId: balance.id,
      type: 'import',
      quantityChange: 5,
      unitCost: 100000,
      referenceModel: 'PurchaseOrder',
      referenceId: 'po-1',
      referenceCode: 'PO-001',
      reason: 'Nhập kho',
    }, meta)

    await check('transaction records and increases stock', async () => {
      assert.equal(first.type, 'import')
      assert.equal(first.quantityChange, 5)
      assert.equal(first.previousQuantity, 10)
      assert.equal(first.newQuantity, 15)
      assert.equal(first.totalValue, 500000)
      assert.equal(first.referenceModel, 'PurchaseOrder')
      const current = await getInventory(Inventory, SITE, balance.id)
      assert.equal(current.quantityOnHand, 15)
    })

    await check('transaction needs non-zero quantity', async () => {
      await assert.rejects(
        () => recordInventoryTransaction(Inventory, InventoryTransaction, SITE, {
          inventoryId: balance.id,
          type: 'adjustment_inc',
          quantityChange: 0,
        }, meta),
        isTransactionError(422, 'INVENTORY_TRANSACTION_QUANTITY_INVALID'),
      )
    })

    await check('transaction cannot drop below zero', async () => {
      await assert.rejects(
        () => recordInventoryTransaction(Inventory, InventoryTransaction, SITE, {
          inventoryId: balance.id,
          type: 'export',
          quantityChange: -1000,
        }, meta),
        isTransactionError(409, 'INVENTORY_INSUFFICIENT_STOCK'),
      )
    })

    const second = await recordInventoryTransaction(Inventory, InventoryTransaction, SITE, {
      itemId: 'item-1',
      variantId: null,
      warehouseId: warehouse.id,
      type: 'export',
      quantityChange: -3,
      unitCost: 100000,
      referenceModel: 'Order',
      referenceId: 'order-1',
      reason: 'Xuất kho',
    }, meta)

    await check('transaction resolves balance by item and warehouse', async () => {
      assert.equal(second.type, 'export')
      assert.equal(second.previousQuantity, 15)
      assert.equal(second.newQuantity, 12)
      const current = await getInventory(Inventory, SITE, balance.id)
      assert.equal(current.quantityOnHand, 12)
    })

    await check('transaction list filters by type and pages', async () => {
      const all = await listInventoryTransactions(InventoryTransaction, SITE, { limit: 10 })
      assert.equal(all.data.length, 2)
      assert.equal(all.counts.all, 2)
      const firstPage = await listInventoryTransactions(InventoryTransaction, SITE, { limit: 1 })
      assert.equal(firstPage.data.length, 1)
      assert.equal(firstPage.hasMore, true)
      const next = await listInventoryTransactions(InventoryTransaction, SITE, { limit: 1, cursor: firstPage.nextCursor })
      assert.equal(next.data.length, 1)
      const byType = await listInventoryTransactions(InventoryTransaction, SITE, { type: 'export' })
      assert.equal(byType.data.length, 1)
      const byReference = await listInventoryTransactions(InventoryTransaction, SITE, { referenceModel: 'PurchaseOrder' })
      assert.equal(byReference.data.length, 1)
    })

    await check('transactions are site-scoped', async () => {
      assert.equal((await listInventoryTransactions(InventoryTransaction, OTHER_SITE)).data.length, 0)
      await assert.rejects(() => getInventoryTransaction(InventoryTransaction, OTHER_SITE, first.id), isTransactionError(404, 'INVENTORY_TRANSACTION_NOT_FOUND'))
    })

    await check('transaction get returns stored row', async () => {
      const found = await getInventoryTransaction(InventoryTransaction, SITE, first.id)
      assert.equal(found.id, first.id)
      assert.equal(found.code, first.code)
    })

    await check('transaction records an audit entry', async () => {
      const transactions = await Audit.find({ siteId: SITE, resourceType: 'inventory_transaction' }).lean<{ action: string }[]>()
      assert.ok(transactions.some(e => e.action === 'create'))
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} Inventory transaction checks: ${checks} passed, ${notRun} not run\n`)
