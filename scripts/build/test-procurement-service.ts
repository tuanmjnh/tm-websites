import assert from 'node:assert/strict'
import {
  SupplierServiceError,
  createSupplier,
  getSupplier,
  listSuppliers,
  restoreSupplier,
  softDeleteSupplier,
  updateSupplier,
} from '../../tm-cms/server/services/supplierService.js'
import {
  PurchaseOrderServiceError,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  receivePurchaseOrder,
  restorePurchaseOrder,
  softDeletePurchaseOrder,
  updatePurchaseOrder,
} from '../../tm-cms/server/services/purchaseOrderService.js'
import { createWarehouse, listWarehouses } from '../../tm-cms/server/services/warehouseService.js'
import { createInventory, getInventory } from '../../tm-cms/server/services/inventoryService.js'
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

function isSupplierError(status: number, code: string) {
  return (error: unknown) => error instanceof SupplierServiceError && error.statusCode === status && error.code === code
}
function isPurchaseOrderError(status: number, code: string) {
  return (error: unknown) => error instanceof PurchaseOrderServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('Procurement — suppliers and purchase orders (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_procurement_service' }

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
    const { Supplier, PurchaseOrder, Warehouse, Inventory, InventoryTransaction, Audit } = await prepareDatabase(connection)
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const firstSupplier = await createSupplier(Supplier, SITE, {
      code: 'SUP-001',
      title: 'Nhà cung cấp A',
      status: 'active',
      email: 'a@example.com',
    }, meta)

    await check('supplier creates with revision 1', async () => {
      assert.equal(firstSupplier.code, 'SUP-001')
      assert.equal(firstSupplier.revision, 1)
      assert.equal(firstSupplier.siteId, SITE)
      assert.equal(firstSupplier.status, 'active')
    })

    await check('duplicate supplier code conflicts', async () => {
      await assert.rejects(
        () => createSupplier(Supplier, SITE, { code: 'SUP-001', title: 'Khác' }, meta),
        isSupplierError(409, 'SUPPLIER_CODE_EXISTS'),
      )
    })

    await check('supplier needs a title', async () => {
      await assert.rejects(
        () => createSupplier(Supplier, SITE, { code: 'SUP-002', title: '' }, meta),
        isSupplierError(422, 'SUPPLIER_PAYLOAD_INVALID'),
      )
    })

    const secondSupplier = await createSupplier(Supplier, SITE, {
      code: 'SUP-002',
      title: 'Nhà cung cấp B',
      status: 'inactive',
    }, meta)

    await check('supplier list filters by status and pages', async () => {
      const all = await listSuppliers(Supplier, SITE, { limit: 10 })
      assert.equal(all.data.length, 2)
      assert.equal(all.counts.all, 2)
      const firstPage = await listSuppliers(Supplier, SITE, { limit: 1 })
      assert.equal(firstPage.data.length, 1)
      assert.equal(firstPage.hasMore, true)
      const next = await listSuppliers(Supplier, SITE, { limit: 1, cursor: firstPage.nextCursor })
      assert.equal(next.data.length, 1)
      const byStatus = await listSuppliers(Supplier, SITE, { status: 'inactive' })
      assert.equal(byStatus.data.length, 1)
    })

    await check('suppliers are site-scoped', async () => {
      assert.equal((await listSuppliers(Supplier, OTHER_SITE)).data.length, 0)
      await assert.rejects(() => getSupplier(Supplier, OTHER_SITE, firstSupplier.id), isSupplierError(404, 'SUPPLIER_NOT_FOUND'))
    })

    await check('supplier update merges and bumps revision', async () => {
      const updated = await updateSupplier(Supplier, SITE, firstSupplier.id, {
        revision: firstSupplier.revision,
        title: 'Nhà cung cấp A đã sửa',
        rating: 4.5,
      }, meta)
      assert.equal(updated.revision, 2)
      assert.equal(updated.title, 'Nhà cung cấp A đã sửa')
      assert.equal(updated.rating, 4.5)
      assert.equal(updated.email, 'a@example.com', 'email kept')

      await assert.rejects(
        () => updateSupplier(Supplier, SITE, firstSupplier.id, { revision: 1, title: 'x' }, meta),
        isSupplierError(409, 'SUPPLIER_REVISION_CONFLICT'),
      )
    })

    await check('supplier soft delete/restore', async () => {
      const live = await getSupplier(Supplier, SITE, secondSupplier.id)
      const removed = await softDeleteSupplier(Supplier, SITE, secondSupplier.id, live.revision, meta)
      assert.equal(removed.code, 'SUP-002')
      const visible = await listSuppliers(Supplier, SITE)
      assert.equal(visible.data.some(e => e.id === secondSupplier.id), false)
      const restored = await restoreSupplier(Supplier, SITE, secondSupplier.id, live.revision + 1, meta)
      assert.equal(restored.isDeleted, false)
    })

    // Purchase orders
    const poItems = [{ itemName: 'Áo thun', sku: 'AT-01', quantity: 2, unitCost: 100000 }]
    const firstPo = await createPurchaseOrder(PurchaseOrder, Supplier, SITE, {
      code: 'PO-001',
      supplierId: firstSupplier.id,
      status: 'draft',
      items: poItems,
      paidAmount: 0,
    }, meta)

    await check('purchase order computes totals', async () => {
      assert.equal(firstPo.code, 'PO-001')
      assert.equal(firstPo.totalAmount, 200000)
      assert.equal(firstPo.orderedTotalAmount, 200000)
      assert.equal(firstPo.revision, 1)
      assert.equal(firstPo.supplierId, firstSupplier.id)
    })

    await check('purchase order duplicate code conflicts', async () => {
      await assert.rejects(
        () => createPurchaseOrder(PurchaseOrder, Supplier, SITE, { code: 'PO-001', items: poItems }, meta),
        isPurchaseOrderError(409, 'PURCHASE_ORDER_CODE_EXISTS'),
      )
    })

    await check('purchase order needs items', async () => {
      await assert.rejects(
        () => createPurchaseOrder(PurchaseOrder, Supplier, SITE, { code: 'PO-002', items: [] }, meta),
        isPurchaseOrderError(422, 'PURCHASE_ORDER_PAYLOAD_INVALID'),
      )
    })

    await check('purchase order rejects unknown supplier', async () => {
      await assert.rejects(
        () => createPurchaseOrder(PurchaseOrder, Supplier, SITE, {
          code: 'PO-003',
          supplierId: '000000000000000000000000',
          items: poItems,
        }, meta),
        isPurchaseOrderError(422, 'PURCHASE_ORDER_SUPPLIER_NOT_FOUND'),
      )
    })

    const secondPo = await createPurchaseOrder(PurchaseOrder, Supplier, SITE, {
      code: 'PO-002',
      items: [{ itemName: 'Quần jean', sku: 'QJ-01', quantity: 1, unitCost: 250000 }],
      paidAmount: 250000,
    }, meta)

    await check('paid amount derives payment status', async () => {
      assert.equal(secondPo.paymentStatus, 'paid')
    })

    await check('purchase order list filters by status and pages', async () => {
      const all = await listPurchaseOrders(PurchaseOrder, SITE, { limit: 10 })
      assert.equal(all.data.length, 2)
      assert.equal(all.counts.all, 2)
      const firstPage = await listPurchaseOrders(PurchaseOrder, SITE, { limit: 1 })
      assert.equal(firstPage.data.length, 1)
      assert.equal(firstPage.hasMore, true)
      const next = await listPurchaseOrders(PurchaseOrder, SITE, { limit: 1, cursor: firstPage.nextCursor })
      assert.equal(next.data.length, 1)
      const byStatus = await listPurchaseOrders(PurchaseOrder, SITE, { status: 'draft' })
      assert.equal(byStatus.data.length, 2)
    })

    await check('purchase orders are site-scoped', async () => {
      assert.equal((await listPurchaseOrders(PurchaseOrder, OTHER_SITE)).data.length, 0)
      await assert.rejects(() => getPurchaseOrder(PurchaseOrder, OTHER_SITE, firstPo.id), isPurchaseOrderError(404, 'PURCHASE_ORDER_NOT_FOUND'))
    })

    await check('purchase order update merges and bumps revision', async () => {
      const updated = await updatePurchaseOrder(PurchaseOrder, Supplier, SITE, firstPo.id, {
        revision: firstPo.revision,
        status: 'ordered',
        reconcileNote: 'Đã đặt',
      }, meta)
      assert.equal(updated.revision, 2)
      assert.equal(updated.status, 'ordered')
      assert.equal(updated.reconcileNote, 'Đã đặt')
      assert.equal(updated.totalAmount, 200000, 'items kept')

      await assert.rejects(
        () => updatePurchaseOrder(PurchaseOrder, Supplier, SITE, firstPo.id, { revision: 1, status: 'received' }, meta),
        isPurchaseOrderError(409, 'PURCHASE_ORDER_REVISION_CONFLICT'),
      )
    })

    await check('purchase order items locked after receipt', async () => {
      const cur = await getPurchaseOrder(PurchaseOrder, SITE, firstPo.id)
      await updatePurchaseOrder(PurchaseOrder, Supplier, SITE, firstPo.id, { revision: cur.revision, status: 'received' }, meta)
      const received = await getPurchaseOrder(PurchaseOrder, SITE, firstPo.id)
      await assert.rejects(
        () => updatePurchaseOrder(PurchaseOrder, Supplier, SITE, firstPo.id, { revision: received.revision, items: [{ itemName: 'X', quantity: 1, unitCost: 1 }] }, meta),
        isPurchaseOrderError(409, 'PURCHASE_ORDER_LOCKED'),
      )
    })

    await check('purchase order soft delete/restore', async () => {
      const live = await getPurchaseOrder(PurchaseOrder, SITE, secondPo.id)
      const removed = await softDeletePurchaseOrder(PurchaseOrder, SITE, secondPo.id, live.revision, meta)
      assert.equal(removed.code, 'PO-002')
      const visible = await listPurchaseOrders(PurchaseOrder, SITE)
      assert.equal(visible.data.some(e => e.id === secondPo.id), false)
      const restored = await restorePurchaseOrder(PurchaseOrder, SITE, secondPo.id, live.revision + 1, meta)
      assert.equal(restored.isDeleted, false)
    })

    // Partial receipt with stock integration
    await createWarehouse(Warehouse, SITE, { code: 'WH-RCV', title: 'Kho nhận', status: 'active' }, meta)
    const receiptWarehouse = (await listWarehouses(Warehouse, SITE)).data.find(w => w.code === 'WH-RCV')!
    const balance = await createInventory(Inventory, Warehouse, SITE, {
      itemId: 'item-bulk',
      variantId: null,
      warehouseId: receiptWarehouse.id,
      sku: 'BULK-01',
      quantityOnHand: 0,
    }, meta)

    const receiptPo = await createPurchaseOrder(PurchaseOrder, Supplier, SITE, {
      code: 'PO-RCV',
      supplierId: firstSupplier.id,
      warehouseId: receiptWarehouse.id,
      status: 'ordered',
      items: [{ itemId: 'item-bulk', variantId: null, itemName: 'Hàng nhận', sku: 'BULK-01', quantity: 5, unitCost: 50000 }],
    }, meta)

    await check('a partial receipt moves stock and marks the order partial', async () => {
      const received = await receivePurchaseOrder(PurchaseOrder, Inventory, InventoryTransaction, SITE, receiptPo.id, {
        revision: receiptPo.revision,
        lines: [{ itemId: 'item-bulk', variantId: null, receivedQuantity: 2 }],
      }, meta)
      assert.equal(received.status, 'partial')
      assert.equal(received.items[0]!.receivedQuantity, 2)
      const stock = await getInventory(Inventory, SITE, balance.id)
      assert.equal(stock.quantityOnHand, 2)
      const ledger = await InventoryTransaction.find({ siteId: SITE, referenceModel: 'PurchaseOrder' }).lean<{ quantityChange: number }[]>()
      assert.equal(ledger.length, 1)
      assert.equal(ledger[0]!.quantityChange, 2)
    })

    await check('receipt cannot exceed the ordered quantity', async () => {
      const current = await getPurchaseOrder(PurchaseOrder, SITE, receiptPo.id)
      await assert.rejects(
        () => receivePurchaseOrder(PurchaseOrder, Inventory, InventoryTransaction, SITE, receiptPo.id, {
          revision: current.revision,
          lines: [{ itemId: 'item-bulk', variantId: null, receivedQuantity: 9 }],
        }, meta),
        isPurchaseOrderError(409, 'PURCHASE_ORDER_RECEIPT_EXCEEDS_ORDER'),
      )
    })

    await check('replaying the same receipt moves no stock', async () => {
      const current = await getPurchaseOrder(PurchaseOrder, SITE, receiptPo.id)
      const replay = await receivePurchaseOrder(PurchaseOrder, Inventory, InventoryTransaction, SITE, receiptPo.id, {
        revision: current.revision,
        lines: [{ itemId: 'item-bulk', variantId: null, receivedQuantity: 2 }],
      }, meta)
      assert.equal(replay.status, 'partial')
      const stock = await getInventory(Inventory, SITE, balance.id)
      assert.equal(stock.quantityOnHand, 2)
      const ledger = await InventoryTransaction.find({ siteId: SITE, referenceModel: 'PurchaseOrder' }).lean<unknown[]>()
      assert.equal(ledger.length, 1)
    })

    await check('a receipt total cannot be lowered', async () => {
      const current = await getPurchaseOrder(PurchaseOrder, SITE, receiptPo.id)
      await assert.rejects(
        () => receivePurchaseOrder(PurchaseOrder, Inventory, InventoryTransaction, SITE, receiptPo.id, {
          revision: current.revision,
          lines: [{ itemId: 'item-bulk', variantId: null, receivedQuantity: 1 }],
        }, meta),
        isPurchaseOrderError(409, 'PURCHASE_ORDER_RECEIPT_REGRESSION'),
      )
    })

    await check('a complete receipt closes the order and books the rest', async () => {
      const current = await getPurchaseOrder(PurchaseOrder, SITE, receiptPo.id)
      const received = await receivePurchaseOrder(PurchaseOrder, Inventory, InventoryTransaction, SITE, receiptPo.id, {
        revision: current.revision,
        lines: [{ itemId: 'item-bulk', variantId: null, receivedQuantity: 4, rejectedQuantity: 1, note: '1 hỏng' }],
        reconcileNote: 'Nhận 4, trả 1',
      }, meta)
      assert.equal(received.status, 'received')
      assert.equal(received.items[0]!.rejectedQuantity, 1)
      assert.equal(received.reconcileNote, 'Nhận 4, trả 1')
      const stock = await getInventory(Inventory, SITE, balance.id)
      assert.equal(stock.quantityOnHand, 4, 'only received units enter stock')
    })

    await check('a closed order refuses another receipt', async () => {
      const current = await getPurchaseOrder(PurchaseOrder, SITE, receiptPo.id)
      await assert.rejects(
        () => receivePurchaseOrder(PurchaseOrder, Inventory, InventoryTransaction, SITE, receiptPo.id, {
          revision: current.revision,
          lines: [{ itemId: 'item-bulk', variantId: null, receivedQuantity: 5 }],
        }, meta),
        isPurchaseOrderError(409, 'PURCHASE_ORDER_LOCKED'),
      )
    })

    await check('every procurement mutation records an audit entry', async () => {
      const suppliers = await Audit.find({ siteId: SITE, resourceType: 'supplier' }).lean<{ action: string }[]>()
      const pos = await Audit.find({ siteId: SITE, resourceType: 'purchase_order' }).lean<{ action: string }[]>()
      assert.ok(suppliers.some(e => e.action === 'create'))
      assert.ok(suppliers.some(e => e.action === 'update'))
      assert.ok(suppliers.some(e => e.action === 'delete'))
      assert.ok(suppliers.some(e => e.action === 'restore'))
      assert.ok(pos.some(e => e.action === 'create'))
      assert.ok(pos.some(e => e.action === 'update'))
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} Procurement service checks: ${checks} passed, ${notRun} not run\n`)
