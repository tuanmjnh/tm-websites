import assert from 'node:assert/strict'
import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import {
  applyPurchaseOrderSupplierBackfill,
  normalizeSupplierBackfillMap,
  planPurchaseOrderSupplierBackfill,
  type SupplierBackfillOrder,
  type SupplierBackfillSupplier,
} from '../../tm-cms/server/services/purchaseOrderSupplierBackfill.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'

/**
 * The supplier backfill is a reviewed map over orders the import could not
 * resolve. These checks cover the plan (what an operator sees before any write)
 * and the guarded apply (revision bump, concurrent edit skipped, rerun no-op).
 */

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

const suppliers: SupplierBackfillSupplier[] = [
  { id: 'sup-1', code: 'SUP-SUPPLIER1', title: 'Supplier 01' },
  { id: 'sup-2', code: 'SUP-SUPPLIER2', title: 'Supplier 02' },
  { id: 'sup-3', code: 'SUP-SUPPLIER3', title: 'Supplier 03', isDeleted: true },
]

const order = (code: string, supplierId: string | null = null): SupplierBackfillOrder => ({
  id: `id-${code}`,
  code,
  supplierId,
})

console.log('Purchase order supplier backfill — reviewed map (live MongoDB)\n')

await check('the map trims, upper-cases keys and drops empty placeholders', () => {
  const map = normalizeSupplierBackfillMap({
    ' po-1 ': ' SUP-SUPPLIER1 ',
    'PO-2': '',
    'PO-3': 7,
    '': 'SUP-SUPPLIER2',
  })
  assert.deepEqual([...map.entries()], [['PO-1', 'SUP-SUPPLIER1']])
  assert.equal(normalizeSupplierBackfillMap(null).size, 0)
  assert.equal(normalizeSupplierBackfillMap(['PO-1']).size, 0)
})

await check('a supplier code or its id both resolve, case-insensitively', () => {
  const byCode = planPurchaseOrderSupplierBackfill({
    orders: [order('PO-1')],
    suppliers,
    map: new Map([['PO-1', 'sup-supplier2']]),
  })
  assert.equal(byCode.rows[0]?.status, 'assign')
  assert.equal(byCode.rows[0]?.supplierId, 'sup-2')

  const byId = planPurchaseOrderSupplierBackfill({
    orders: [order('PO-1')],
    suppliers,
    map: new Map([['PO-1', 'sup-1']]),
  })
  assert.equal(byId.rows[0]?.supplierId, 'sup-1')
  assert.equal(byId.assignable.length, 1)
})

await check('an order that already has a supplier is kept unless overwrite is asked for', () => {
  const kept = planPurchaseOrderSupplierBackfill({
    orders: [order('PO-1', 'sup-1')],
    suppliers,
    map: new Map([['PO-1', 'sup-2']]),
  })
  assert.equal(kept.rows[0]?.status, 'already-assigned')
  assert.equal(kept.rows[0]?.supplierCode, 'SUP-SUPPLIER1')
  assert.equal(kept.assignable.length, 0)

  const replaced = planPurchaseOrderSupplierBackfill({
    orders: [order('PO-1', 'sup-1')],
    suppliers,
    map: new Map([['PO-1', 'sup-2']]),
    overwrite: true,
  })
  assert.equal(replaced.rows[0]?.status, 'assign')
  assert.equal(replaced.rows[0]?.supplierId, 'sup-2')
})

await check('an order without a map entry is reported and never assigned', () => {
  const plan = planPurchaseOrderSupplierBackfill({
    orders: [order('PO-2')],
    suppliers,
    map: new Map([['PO-1', 'SUP-SUPPLIER1']]),
  })
  assert.equal(plan.rows[0]?.status, 'unmapped')
  assert.equal(plan.assignable.length, 0)
  assert.deepEqual(plan.unknownOrders, ['PO-1'])
  assert.equal(plan.invalid.length, 0)
})

await check('an unknown or deleted supplier invalidates the plan', () => {
  const unknown = planPurchaseOrderSupplierBackfill({
    orders: [order('PO-1')],
    suppliers,
    map: new Map([['PO-1', 'SUP-NOPE']]),
  })
  assert.equal(unknown.rows[0]?.status, 'unknown-supplier')
  assert.deepEqual(unknown.invalid.map(row => row.orderCode), ['PO-1'])

  const deleted = planPurchaseOrderSupplierBackfill({
    orders: [order('PO-1')],
    suppliers,
    map: new Map([['PO-1', 'SUP-SUPPLIER3']]),
  })
  assert.equal(deleted.rows[0]?.status, 'deleted-supplier')
  assert.equal(deleted.invalid.length, 1)
})

await check('an invalid map refuses to write anything', async () => {
  const plan = planPurchaseOrderSupplierBackfill({
    orders: [order('PO-1')],
    suppliers,
    map: new Map([['PO-1', 'SUP-NOPE']]),
  })
  await assert.rejects(
    () => applyPurchaseOrderSupplierBackfill(null as never, SITE, plan),
    /do not resolve/,
  )
})

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_po_supplier_backfill')

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
    const { PurchaseOrder, Supplier } = await prepareDatabase(connection)

    const supplierA = await Supplier.create({ siteId: SITE, code: 'SUP-SUPPLIER1', title: 'Supplier 01', revision: 1 })
    const supplierB = await Supplier.create({ siteId: SITE, code: 'SUP-SUPPLIER2', title: 'Supplier 02', revision: 1 })
    await Supplier.create({ siteId: SITE, code: 'SUP-DELETED', title: 'Deleted', revision: 1, isDeleted: true })
    const po1 = await PurchaseOrder.create({ siteId: SITE, code: 'PO-2605-0001', revision: 1 })
    const po2 = await PurchaseOrder.create({ siteId: SITE, code: 'PO-2605-0002', revision: 1 })

    const liveSuppliers = await Supplier.find({ siteId: SITE })
      .lean<{ _id: unknown, code: string, title: string, isDeleted?: boolean }[]>()
    const liveOrders = await PurchaseOrder.find({ siteId: SITE })
      .lean<{ _id: unknown, code: string, supplierId?: string | null }[]>()

    const plan = planPurchaseOrderSupplierBackfill({
      orders: liveOrders.map(entry => ({ id: String(entry._id), code: entry.code, supplierId: entry.supplierId ?? null })),
      suppliers: liveSuppliers.map(entry => ({
        id: String(entry._id),
        code: entry.code,
        title: entry.title,
        isDeleted: entry.isDeleted,
      })),
      map: new Map([
        ['PO-2605-0001', 'SUP-SUPPLIER1'],
        ['PO-2605-0002', 'SUP-SUPPLIER2'],
      ]),
    })

    await check('the apply writes the planned supplier and bumps the revision', async () => {
      const result = await applyPurchaseOrderSupplierBackfill(PurchaseOrder, SITE, plan)
      assert.equal(result.updated, 2)
      assert.equal(result.skipped, 0)
      const stored = await PurchaseOrder.findById(po1._id).lean<{ supplierId: string, revision: number } | null>()
      assert.equal(stored?.supplierId, String(supplierA._id))
      assert.equal(stored?.revision, 2)
      const second = await PurchaseOrder.findById(po2._id).lean<{ supplierId: string } | null>()
      assert.equal(second?.supplierId, String(supplierB._id))
    })

    await check('a rerun plans nothing to assign and writes nothing', async () => {
      const orders = await PurchaseOrder.find({ siteId: SITE })
        .lean<{ _id: unknown, code: string, supplierId?: string | null }[]>()
      const rerun = planPurchaseOrderSupplierBackfill({
        orders: orders.map(entry => ({ id: String(entry._id), code: entry.code, supplierId: entry.supplierId ?? null })),
        suppliers: liveSuppliers.map(entry => ({
          id: String(entry._id),
          code: entry.code,
          title: entry.title,
          isDeleted: entry.isDeleted,
        })),
        map: new Map([['PO-2605-0001', 'SUP-SUPPLIER1']]),
      })
      assert.equal(rerun.assignable.length, 0)
      assert.ok(rerun.rows.every(row => row.status === 'already-assigned'))
      const result = await applyPurchaseOrderSupplierBackfill(PurchaseOrder, SITE, rerun)
      assert.equal(result.updated, 0)
    })

    await check('a supplier changed after planning is skipped, not overwritten', async () => {
      // Only the second order moves away from the value the plan was built from.
      await PurchaseOrder.updateOne({ _id: po1._id }, { $set: { supplierId: null } })
      await PurchaseOrder.updateOne({ _id: po2._id }, { $set: { supplierId: String(supplierA._id) } })
      const result = await applyPurchaseOrderSupplierBackfill(PurchaseOrder, SITE, plan)
      assert.equal(result.updated, 1, 'the row that still matched the plan is written')
      assert.equal(result.skipped, 1, 'the row a colleague changed is skipped')
      const stored = await PurchaseOrder.findById(po2._id).lean<{ supplierId: string } | null>()
      assert.equal(stored?.supplierId, String(supplierA._id), 'the concurrent value survives')
    })

    await check('a deleted supplier is refused before any write', async () => {
      const deletedPlan = planPurchaseOrderSupplierBackfill({
        orders: liveOrders.map(entry => ({ id: String(entry._id), code: entry.code, supplierId: entry.supplierId ?? null })),
        suppliers: liveSuppliers.map(entry => ({
          id: String(entry._id),
          code: entry.code,
          title: entry.title,
          isDeleted: entry.isDeleted,
        })),
        map: new Map([['PO-2605-0001', 'SUP-DELETED']]),
        overwrite: true,
      })
      assert.equal(deletedPlan.invalid.length, 1)
      await assert.rejects(() => applyPurchaseOrderSupplierBackfill(PurchaseOrder, SITE, deletedPlan), /do not resolve/)
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Purchase order supplier backfill checks: ${checks} passed, ${notRun} not run\n`)
