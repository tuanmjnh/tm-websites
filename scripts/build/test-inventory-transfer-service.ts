import assert from 'node:assert/strict'
import { createWarehouse } from '../../tm-cms/server/services/warehouseService.js'
import { createInventory, getInventory } from '../../tm-cms/server/services/inventoryService.js'
import {
  InventoryTransferServiceError,
  cancelInventoryTransfer,
  createInventoryTransfer,
  getInventoryTransfer,
  listInventoryTransfers,
  receiveInventoryTransfer,
  restoreInventoryTransfer,
  shipInventoryTransfer,
  softDeleteInventoryTransfer,
} from '../../tm-cms/server/services/inventoryTransferService.js'
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

function isTransferError(status: number, code: string) {
  return (error: unknown) => error instanceof InventoryTransferServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('Inventory transfers — stock moves between warehouses (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_inventory_transfer_service' }

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
    const { Warehouse, Inventory, InventoryTransaction, InventoryTransfer, Audit } = await prepareDatabase(connection)
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const source = await createWarehouse(Warehouse, SITE, { code: 'WH-A', title: 'Kho A', status: 'active' }, meta)
    const destination = await createWarehouse(Warehouse, SITE, { code: 'WH-B', title: 'Kho B', status: 'active' }, meta)
    const third = await createWarehouse(Warehouse, SITE, { code: 'WH-C', title: 'Kho C', status: 'active' }, meta)

    await createInventory(Inventory, Warehouse, SITE, {
      itemId: 'item-1',
      variantId: null,
      warehouseId: source.id,
      sku: 'SKU-1',
      quantityOnHand: 20,
    }, meta)

    const transfer = await createInventoryTransfer(InventoryTransfer, Warehouse, SITE, {
      fromWarehouseId: source.id,
      toWarehouseId: destination.id,
      lines: [{ itemId: 'item-1', variantId: null, sku: 'SKU-1', itemName: 'Hàng 1', quantity: 8 }],
      note: 'Chuyển bổ sung',
    }, meta)

    await check('a draft transfer holds no stock', async () => {
      assert.match(transfer.code, /^TRF-\d{6}-[0-9A-F]{6}$/)
      assert.equal(transfer.status, 'draft')
      const stock = await getInventory(Inventory, SITE, (await Inventory.findOne({ siteId: SITE, warehouseId: source.id }).lean<{ _id: { toString(): string } }>())!._id.toString())
      assert.equal(stock.quantityOnHand, 20)
    })

    await check('a transfer needs two different warehouses', async () => {
      await assert.rejects(
        () => createInventoryTransfer(InventoryTransfer, Warehouse, SITE, {
          fromWarehouseId: source.id,
          toWarehouseId: source.id,
          lines: [{ itemId: 'item-1', quantity: 1 }],
        }, meta),
        isTransferError(422, 'INVENTORY_TRANSFER_SAME_WAREHOUSE'),
      )
    })

    await check('the same item cannot appear twice', async () => {
      await assert.rejects(
        () => createInventoryTransfer(InventoryTransfer, Warehouse, SITE, {
          fromWarehouseId: source.id,
          toWarehouseId: destination.id,
          lines: [{ itemId: 'item-1', quantity: 1 }, { itemId: 'item-1', quantity: 2 }],
        }, meta),
        isTransferError(422, 'INVENTORY_TRANSFER_DUPLICATE_LINE'),
      )
    })

    await check('an unknown warehouse is refused', async () => {
      await assert.rejects(
        () => createInventoryTransfer(InventoryTransfer, Warehouse, SITE, {
          fromWarehouseId: source.id,
          toWarehouseId: '64b000000000000000000000',
          lines: [{ itemId: 'item-1', quantity: 1 }],
        }, meta),
        isTransferError(404, 'INVENTORY_TRANSFER_WAREHOUSE_NOT_FOUND'),
      )
    })

    const shipped = await shipInventoryTransfer(InventoryTransfer, Inventory, InventoryTransaction, SITE, transfer.id, {
      revision: transfer.revision,
    }, meta)

    await check('shipping debits the source only', async () => {
      assert.equal(shipped.status, 'in_transit')
      const rows = await Inventory.find({ siteId: SITE }).lean<{ itemId: string, warehouseId: { toString(): string }, quantityOnHand: number }[]>()
      const atSource = rows.find(row => String(row.warehouseId) === source.id)!
      assert.equal(atSource.quantityOnHand, 12)
      assert.equal(rows.length, 1, 'the destination balance does not exist yet')
      const ledger = await InventoryTransaction.find({ siteId: SITE, referenceCode: transfer.code }).lean<{ type: string, quantityChange: number }[]>()
      assert.deepEqual(ledger.map(row => [row.type, row.quantityChange]), [['transfer_out', -8]])
    })

    await check('a transfer needs stock at the source', async () => {
      const tooBig = await createInventoryTransfer(InventoryTransfer, Warehouse, SITE, {
        fromWarehouseId: source.id,
        toWarehouseId: third.id,
        lines: [{ itemId: 'item-1', quantity: 15 }],
      }, meta)
      await assert.rejects(
        () => shipInventoryTransfer(InventoryTransfer, Inventory, InventoryTransaction, SITE, tooBig.id, { revision: tooBig.revision }, meta),
        isTransferError(422, 'INVENTORY_TRANSFER_STOCK_FAILED'),
      )
      const current = await getInventoryTransfer(InventoryTransfer, SITE, tooBig.id)
      assert.equal(current.status, 'draft', 'a failed shipment leaves the draft alone')
      const stock = await getInventory(Inventory, SITE, (await Inventory.findOne({ siteId: SITE, warehouseId: source.id }).lean<{ _id: { toString(): string } }>())!._id.toString())
      assert.equal(stock.quantityOnHand, 12, 'nothing else was debited')
    })

    await check('receiving credits the destination and creates its balance', async () => {
      const current = await getInventoryTransfer(InventoryTransfer, SITE, transfer.id)
      const received = await receiveInventoryTransfer(
        InventoryTransfer,
        Warehouse,
        Inventory,
        InventoryTransaction,
        SITE,
        transfer.id,
        { revision: current.revision, lines: [{ itemId: 'item-1', receivedQuantity: 8 }] },
        meta,
      )
      assert.equal(received.status, 'received')
      const rows = await Inventory.find({ siteId: SITE }).lean<{ warehouseId: { toString(): string }, quantityOnHand: number }[]>()
      const atDestination = rows.find(row => String(row.warehouseId) === destination.id)!
      assert.equal(atDestination.quantityOnHand, 8)
      const ledger = await InventoryTransaction.find({ siteId: SITE, referenceCode: transfer.code }).lean<{ type: string, quantityChange: number }[]>()
      assert.deepEqual(ledger.map(row => row.type).sort(), ['transfer_in', 'transfer_out'])
      const net = ledger.reduce((sum, row) => sum + row.quantityChange, 0)
      assert.equal(net, 0, 'the ledger nets to zero across warehouses')
    })

    await check('a received transfer refuses another receipt', async () => {
      const current = await getInventoryTransfer(InventoryTransfer, SITE, transfer.id)
      await assert.rejects(
        () => receiveInventoryTransfer(InventoryTransfer, Warehouse, Inventory, InventoryTransaction, SITE, transfer.id, {
          revision: current.revision,
          lines: [{ itemId: 'item-1', receivedQuantity: 8 }],
        }, meta),
        isTransferError(409, 'INVENTORY_TRANSFER_NOT_IN_TRANSIT'),
      )
    })

    const partial = await createInventoryTransfer(InventoryTransfer, Warehouse, SITE, {
      fromWarehouseId: source.id,
      toWarehouseId: third.id,
      lines: [{ itemId: 'item-1', quantity: 6 }],
    }, meta)
    await shipInventoryTransfer(InventoryTransfer, Inventory, InventoryTransaction, SITE, partial.id, { revision: partial.revision }, meta)

    await check('a partial receipt keeps the transfer in transit', async () => {
      const current = await getInventoryTransfer(InventoryTransfer, SITE, partial.id)
      const received = await receiveInventoryTransfer(InventoryTransfer, Warehouse, Inventory, InventoryTransaction, SITE, partial.id, {
        revision: current.revision,
        lines: [{ itemId: 'item-1', receivedQuantity: 2 }],
      }, meta)
      assert.equal(received.status, 'in_transit')
      assert.equal(received.lines[0]!.receivedQuantity, 2)
      const rows = await Inventory.find({ siteId: SITE }).lean<{ warehouseId: { toString(): string }, quantityOnHand: number }[]>()
      assert.equal(rows.find(row => String(row.warehouseId) === third.id)!.quantityOnHand, 2)
    })

    await check('cancelling an in-transit transfer returns what never arrived', async () => {
      const current = await getInventoryTransfer(InventoryTransfer, SITE, partial.id)
      const cancelled = await cancelInventoryTransfer(InventoryTransfer, Inventory, InventoryTransaction, SITE, partial.id, {
        revision: current.revision,
        reason: 'Mất hàng',
      }, meta)
      assert.equal(cancelled.status, 'cancelled')
      assert.equal(cancelled.cancelReason, 'Mất hàng')
      const rows = await Inventory.find({ siteId: SITE }).lean<{ warehouseId: { toString(): string }, quantityOnHand: number }[]>()
      assert.equal(rows.find(row => String(row.warehouseId) === source.id)!.quantityOnHand, 10, 'the 4 units that never arrived came back')
      assert.equal(rows.find(row => String(row.warehouseId) === third.id)!.quantityOnHand, 2, 'the received 2 stay put')
    })

    await check('a shipped transfer cannot be hidden but a cancelled one can', async () => {
      const inFlight = await createInventoryTransfer(InventoryTransfer, Warehouse, SITE, {
        fromWarehouseId: source.id,
        toWarehouseId: destination.id,
        lines: [{ itemId: 'item-1', quantity: 1 }],
      }, meta)
      const shippedRow = await shipInventoryTransfer(InventoryTransfer, Inventory, InventoryTransaction, SITE, inFlight.id, { revision: inFlight.revision }, meta)
      await assert.rejects(
        () => softDeleteInventoryTransfer(InventoryTransfer, SITE, inFlight.id, shippedRow.revision, meta),
        isTransferError(409, 'INVENTORY_TRANSFER_IN_FLIGHT'),
      )

      const current = await getInventoryTransfer(InventoryTransfer, SITE, partial.id)
      const removed = await softDeleteInventoryTransfer(InventoryTransfer, SITE, partial.id, current.revision, meta)
      assert.equal(removed.isDeleted, true)
      const restored = await restoreInventoryTransfer(InventoryTransfer, SITE, partial.id, removed.revision, meta)
      assert.equal(restored.isDeleted, false)
    })

    await check('transfers are site-scoped and listed with counts', async () => {
      assert.equal((await listInventoryTransfers(InventoryTransfer, OTHER_SITE)).data.length, 0)
      await assert.rejects(() => getInventoryTransfer(InventoryTransfer, OTHER_SITE, transfer.id), isTransferError(404, 'INVENTORY_TRANSFER_NOT_FOUND'))

      const all = await listInventoryTransfers(InventoryTransfer, SITE)
      assert.equal(all.data.length, 4)
      assert.deepEqual(all.counts, { all: 4, draft: 1, inTransit: 1, received: 1, cancelled: 1 })
      const page = await listInventoryTransfers(InventoryTransfer, SITE, { limit: 2 })
      assert.equal(page.data.length, 2)
      assert.equal(page.hasMore, true)
      const next = await listInventoryTransfers(InventoryTransfer, SITE, { limit: 2, cursor: page.nextCursor ?? undefined })
      assert.equal(next.data.length, 2)
      const byWarehouse = await listInventoryTransfers(InventoryTransfer, SITE, { warehouseId: third.id })
      assert.equal(byWarehouse.data.length, 2, 'both transfers that target the third warehouse')
      const byStatus = await listInventoryTransfers(InventoryTransfer, SITE, { status: 'received' })
      assert.equal(byStatus.data.length, 1)
    })

    await check('every transfer mutation records an audit entry', async () => {
      const entries = await Audit.find({ siteId: SITE, resourceType: 'inventory_transfer' }).lean<{ action: string }[]>()
      assert.ok(entries.filter(entry => entry.action === 'create').length >= 4)
      assert.ok(entries.some(entry => entry.action === 'delete'))
      assert.ok(entries.some(entry => entry.action === 'restore'))
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} Inventory transfer checks: ${checks} passed, ${notRun} not run\n`)
