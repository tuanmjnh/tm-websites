import { readFile } from 'node:fs/promises'
import { connectDatabase } from '../../tm-cms/server/utils/database.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'
import {
  applyPurchaseOrderSupplierBackfill,
  normalizeSupplierBackfillMap,
  planPurchaseOrderSupplierBackfill,
} from '../../tm-cms/server/services/purchaseOrderSupplierBackfill.js'

/**
 * `pnpm backfill:po-suppliers --site <customerId> --map <file> [--apply] [--overwrite]`
 *
 * Assigns the supplier of purchase orders that were imported without one. The
 * legacy rows point at supplier ids that no longer exist in any local database,
 * so this command never guesses: it takes a reviewed map of
 * `"<purchase order code>": "<supplier code or id>"` and reports every order it
 * cannot resolve. Dry run unless `--apply`.
 *
 * An assigned order is kept unless `--overwrite` is passed. The write is guarded
 * on the supplier value the plan was built from, so a concurrent edit is skipped
 * rather than overwritten, and a rerun is a no-op.
 */

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const siteId = flag('site') || process.env.TM_CUSTOMER_ID || ''
const uri = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'
const database = process.env.TM_MONGO_DB || ''
const apply = process.argv.includes('--apply')
const overwrite = process.argv.includes('--overwrite')
const mapPath = flag('map') || ''

if (!siteId) throw new Error('Pass --site <customerId> or set TM_CUSTOMER_ID')
if (!database) throw new Error('Set TM_MONGO_DB to the customer database name')
if (!mapPath) throw new Error('Pass --map <file> (see scripts/ops/po-supplier-map.README.md)')

const rawMap = JSON.parse(await readFile(mapPath, 'utf8')) as unknown
const map = normalizeSupplierBackfillMap(rawMap)

interface LegacyPurchaseOrderRef {
  code?: string
  supplierId?: unknown
}

const connection = await connectDatabase({ uri, database })
try {
  const { PurchaseOrder, Supplier } = await prepareDatabase(connection)

  const orders = await PurchaseOrder.find({ siteId })
    .select({ code: 1, supplierId: 1 })
    .sort({ code: 1 })
    .lean<{ _id: unknown, code: string, supplierId?: string | null }[]>()
  const suppliers = await Supplier.find({ siteId })
    .select({ code: 1, title: 1, isDeleted: 1 })
    .lean<{ _id: unknown, code: string, title: string, isDeleted?: boolean }[]>()

  const legacyRefs = new Map<string, string>()
  const legacy = await connection.collection('purchase_orders')
    .find({ code: { $in: orders.map(order => order.code) } })
    .project({ code: 1, supplierId: 1 })
    .toArray() as LegacyPurchaseOrderRef[]
  for (const record of legacy) {
    const ref = record.supplierId ? String(record.supplierId) : ''
    if (record.code && ref) legacyRefs.set(record.code, ref)
  }

  const supplierIds = new Set(suppliers.map(supplier => String(supplier._id)))
  const plan = planPurchaseOrderSupplierBackfill({
    orders: orders.map(order => ({ id: String(order._id), code: order.code, supplierId: order.supplierId ?? null })),
    suppliers: suppliers.map(supplier => ({
      id: String(supplier._id),
      code: supplier.code,
      title: supplier.title,
      isDeleted: supplier.isDeleted,
    })),
    map,
    overwrite,
  })

  console.log(`purchase order supplier backfill site=${siteId} db=${database} apply=${apply} overwrite=${overwrite}`)
  console.log(`  suppliers in this site: ${suppliers.map(supplier => supplier.code).join(', ') || '(none)'}`)
  const listedEntries = rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap) ? Object.keys(rawMap).length : 0
  console.log(`  map entries: ${listedEntries} listed, ${map.size} filled (${mapPath})`)

  for (const row of plan.rows) {
    const target = row.supplierCode ? ` → ${row.supplierCode}` : ''
    console.log(`  ${row.orderCode}  ${row.status}${target}`)
    const legacyRef = legacyRefs.get(row.orderCode)
    if (legacyRef && row.status === 'unmapped' && !supplierIds.has(legacyRef)) {
      console.log(`      legacy supplier ${legacyRef} is absent from this database; the owner must name one`)
    }
  }

  if (plan.unknownOrders.length) {
    console.log(`  ⚠️  map names ${plan.unknownOrders.length} purchase order(s) this site does not have: ${plan.unknownOrders.join(', ')}`)
  }
  if (plan.invalid.length) {
    console.log(`  ✗ ${plan.invalid.length} map entr${plan.invalid.length === 1 ? 'y' : 'ies'} do not resolve to a live supplier: ${plan.invalid.map(row => row.orderCode).join(', ')}`)
  }

  if (!apply) {
    console.log(`  planned writes ${plan.assignable.length}; nothing was written (rerun with --apply)`)
  } else if (plan.invalid.length || plan.unknownOrders.length) {
    console.log('  nothing was written because the map is invalid')
    process.exitCode = 1
  } else {
    const result = await applyPurchaseOrderSupplierBackfill(PurchaseOrder, siteId, plan)
    console.log(`  updated ${result.updated} purchase order(s)${result.skipped ? `, skipped ${result.skipped} changed concurrently` : ''}`)
    if (!plan.assignable.length) console.log('  nothing to assign (every mapped order already has its supplier)')
  }
} finally {
  await connection.close()
}
