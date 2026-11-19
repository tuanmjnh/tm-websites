import assert from 'node:assert/strict'
import {
  WarehouseServiceError,
  createWarehouse,
  getWarehouse,
  listWarehouses,
  restoreWarehouse,
  softDeleteWarehouse,
  updateWarehouse,
} from '../../tm-cms/server/services/warehouseService.js'
import {
  InventoryServiceError,
  adjustInventoryStock,
  createInventory,
  getInventory,
  listInventories,
  releaseInventoryStock,
  reserveInventoryStock,
  restoreInventory,
  softDeleteInventory,
  updateInventory,
} from '../../tm-cms/server/services/inventoryService.js'
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

function isWarehouseError(status: number, code: string) {
  return (error: unknown) => error instanceof WarehouseServiceError && error.statusCode === status && error.code === code
}
function isInventoryError(status: number, code: string) {
  return (error: unknown) => error instanceof InventoryServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('Inventory — warehouses and balances (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_inventory_service' }

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
    const { Warehouse, Inventory, Audit } = await prepareDatabase(connection)
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const firstWarehouse = await createWarehouse(Warehouse, SITE, {
      code: 'WH-001',
      title: 'Kho chính',
      status: 'active',
      address: 'Hà Nội',
    }, meta)

    await check('warehouse creates with revision 1', async () => {
      assert.equal(firstWarehouse.code, 'WH-001')
      assert.equal(firstWarehouse.revision, 1)
      assert.equal(firstWarehouse.siteId, SITE)
      assert.equal(firstWarehouse.status, 'active')
    })

    await check('duplicate warehouse code conflicts', async () => {
      await assert.rejects(
        () => createWarehouse(Warehouse, SITE, { code: 'WH-001', title: 'Khác' }, meta),
        isWarehouseError(409, 'WAREHOUSE_CODE_EXISTS'),
      )
    })

    await check('warehouse needs a title', async () => {
      await assert.rejects(
        () => createWarehouse(Warehouse, SITE, { code: 'WH-002', title: '' }, meta),
        isWarehouseError(422, 'WAREHOUSE_PAYLOAD_INVALID'),
      )
    })

    const secondWarehouse = await createWarehouse(Warehouse, SITE, {
      code: 'WH-002',
      title: 'Kho phụ',
      status: 'inactive',
    }, meta)

    await check('warehouse list filters by status and pages', async () => {
      const all = await listWarehouses(Warehouse, SITE, { limit: 10 })
      assert.equal(all.data.length, 2)
      assert.equal(all.counts.all, 2)
      const firstPage = await listWarehouses(Warehouse, SITE, { limit: 1 })
      assert.equal(firstPage.data.length, 1)
      assert.equal(firstPage.hasMore, true)
      const next = await listWarehouses(Warehouse, SITE, { limit: 1, cursor: firstPage.nextCursor })
      assert.equal(next.data.length, 1)
      const byStatus = await listWarehouses(Warehouse, SITE, { status: 'inactive' })
      assert.equal(byStatus.data.length, 1)
    })

    await check('warehouses are site-scoped', async () => {
      assert.equal((await listWarehouses(Warehouse, OTHER_SITE)).data.length, 0)
      await assert.rejects(() => getWarehouse(Warehouse, OTHER_SITE, firstWarehouse.id), isWarehouseError(404, 'WAREHOUSE_NOT_FOUND'))
    })

    await check('warehouse update merges and bumps revision', async () => {
      const updated = await updateWarehouse(Warehouse, SITE, firstWarehouse.id, {
        revision: firstWarehouse.revision,
        title: 'Kho chính đã sửa',
        sort: 5,
      }, meta)
      assert.equal(updated.revision, 2)
      assert.equal(updated.title, 'Kho chính đã sửa')
      assert.equal(updated.sort, 5)
      assert.equal(updated.address, 'Hà Nội', 'address kept')

      await assert.rejects(
        () => updateWarehouse(Warehouse, SITE, firstWarehouse.id, { revision: 1, title: 'x' }, meta),
        isWarehouseError(409, 'WAREHOUSE_REVISION_CONFLICT'),
      )
    })

    await check('warehouse soft delete hides, restore brings back', async () => {
      const live = await getWarehouse(Warehouse, SITE, secondWarehouse.id)
      const removed = await softDeleteWarehouse(Warehouse, SITE, secondWarehouse.id, live.revision, meta)
      assert.equal(removed.code, 'WH-002')
      const visible = await listWarehouses(Warehouse, SITE)
      assert.equal(visible.data.some(e => e.id === secondWarehouse.id), false)
      const restored = await restoreWarehouse(Warehouse, SITE, secondWarehouse.id, live.revision + 1, meta)
      assert.equal(restored.isDeleted, false)
    })

    // Inventory balances
    const firstBalance = await createInventory(Inventory, Warehouse, SITE, {
      itemId: 'item-1',
      variantId: null,
      warehouseId: firstWarehouse.id,
      sku: 'SKU-001',
      quantityOnHand: 10,
      quantityReserved: 2,
      lowStockThreshold: 3,
    }, meta)

    await check('inventory balance creates with available quantity', async () => {
      assert.equal(firstBalance.itemId, 'item-1')
      assert.equal(firstBalance.quantityOnHand, 10)
      assert.equal(firstBalance.quantityReserved, 2)
      assert.equal(firstBalance.quantityAvailable, 8)
      assert.equal(firstBalance.revision, 1)
    })

    await check('duplicate balance conflicts', async () => {
      await assert.rejects(
        () => createInventory(Inventory, Warehouse, SITE, {
          itemId: 'item-1',
          variantId: null,
          warehouseId: firstWarehouse.id,
          sku: 'SKU-001',
        }, meta),
        isInventoryError(409, 'INVENTORY_BALANCE_EXISTS'),
      )
    })

    await check('inventory needs valid warehouse', async () => {
      await assert.rejects(
        () => createInventory(Inventory, Warehouse, SITE, {
          itemId: 'item-2',
          variantId: null,
          warehouseId: '000000000000000000000000',
          sku: 'SKU-002',
        }, meta),
        isInventoryError(422, 'INVENTORY_WAREHOUSE_NOT_FOUND'),
      )
    })

    const secondBalance = await createInventory(Inventory, Warehouse, SITE, {
      itemId: 'item-2',
      variantId: 'v-1',
      warehouseId: secondWarehouse.id,
      sku: 'SKU-002',
      quantityOnHand: 5,
      lowStockThreshold: 10,
    }, meta)

    await check('inventory list filters by warehouse and pages', async () => {
      const all = await listInventories(Inventory, SITE, { limit: 10 })
      assert.equal(all.data.length, 2)
      assert.equal(all.counts.all, 2)
      const firstPage = await listInventories(Inventory, SITE, { limit: 1 })
      assert.equal(firstPage.data.length, 1)
      assert.equal(firstPage.hasMore, true)
      const next = await listInventories(Inventory, SITE, { limit: 1, cursor: firstPage.nextCursor })
      assert.equal(next.data.length, 1)
      const byWarehouse = await listInventories(Inventory, SITE, { warehouseId: secondWarehouse.id })
      assert.equal(byWarehouse.data.length, 1)
    })

    await check('inventories are site-scoped', async () => {
      assert.equal((await listInventories(Inventory, OTHER_SITE)).data.length, 0)
      await assert.rejects(() => getInventory(Inventory, OTHER_SITE, firstBalance.id), isInventoryError(404, 'INVENTORY_NOT_FOUND'))
    })

    await check('inventory update merges and bumps revision', async () => {
      const updated = await updateInventory(Inventory, Warehouse, SITE, firstBalance.id, {
        revision: firstBalance.revision,
        sku: 'SKU-001B',
        binLocation: 'A1',
      }, meta)
      assert.equal(updated.revision, 2)
      assert.equal(updated.sku, 'SKU-001B')
      assert.equal(updated.binLocation, 'A1')
      assert.equal(updated.quantityOnHand, 10, 'quantity kept')

      await assert.rejects(
        () => updateInventory(Inventory, Warehouse, SITE, firstBalance.id, { revision: 1, sku: 'x' }, meta),
        isInventoryError(409, 'INVENTORY_REVISION_CONFLICT'),
      )
    })

    await check('adjust stock changes on-hand atomically', async () => {
      const adjusted = await adjustInventoryStock(Inventory, SITE, firstBalance.id, -3, meta)
      assert.equal(adjusted.quantityOnHand, 7)
      await assert.rejects(
        () => adjustInventoryStock(Inventory, SITE, firstBalance.id, -100, meta),
        isInventoryError(409, 'INVENTORY_INSUFFICIENT_STOCK'),
      )
      const increased = await adjustInventoryStock(Inventory, SITE, firstBalance.id, 5, meta)
      assert.equal(increased.quantityOnHand, 12)
    })

    await check('reserve and release stock', async () => {
      await reserveInventoryStock(Inventory, SITE, 'item-1', null, firstWarehouse.id, 4)
      const reserved = await getInventory(Inventory, SITE, firstBalance.id)
      assert.equal(reserved.quantityReserved, 6)
      assert.equal(reserved.quantityAvailable, 6)

      await assert.rejects(
        () => reserveInventoryStock(Inventory, SITE, 'item-1', null, firstWarehouse.id, 100),
        isInventoryError(409, 'INVENTORY_INSUFFICIENT_AVAILABLE'),
      )

      await releaseInventoryStock(Inventory, SITE, 'item-1', null, firstWarehouse.id, 4)
      const released = await getInventory(Inventory, SITE, firstBalance.id)
      assert.equal(released.quantityReserved, 2)
    })

    await check('inventory soft delete/restore', async () => {
      const live = await getInventory(Inventory, SITE, secondBalance.id)
      const removed = await softDeleteInventory(Inventory, SITE, secondBalance.id, live.revision, meta)
      assert.equal(removed.itemId, 'item-2')
      const visible = await listInventories(Inventory, SITE)
      assert.equal(visible.data.some(e => e.id === secondBalance.id), false)
      const restored = await restoreInventory(Inventory, SITE, secondBalance.id, live.revision + 1, meta)
      assert.equal(restored.isDeleted, false)
    })

    await check('every inventory mutation records an audit entry', async () => {
      const warehouses = await Audit.find({ siteId: SITE, resourceType: 'warehouse' }).lean<{ action: string }[]>()
      const inventories = await Audit.find({ siteId: SITE, resourceType: 'inventory' }).lean<{ action: string }[]>()
      assert.ok(warehouses.some(e => e.action === 'create'))
      assert.ok(warehouses.some(e => e.action === 'update'))
      assert.ok(warehouses.some(e => e.action === 'delete'))
      assert.ok(warehouses.some(e => e.action === 'restore'))
      assert.ok(inventories.some(e => e.action === 'create'))
      assert.ok(inventories.some(e => e.action === 'update'))
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} Inventory service checks: ${checks} passed, ${notRun} not run\n`)
