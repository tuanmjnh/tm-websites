import { readFile } from 'node:fs/promises'
import { Types } from 'mongoose'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'
import { normalizeCustomerCode } from '../../tm-cms/server/models/customer.js'
import { normalizeCustomerSegmentCode } from '../../tm-cms/server/models/customerSegment.js'
import { normalizeSupplierCode } from '../../tm-cms/server/models/supplier.js'
import { normalizeWarehouseCode } from '../../tm-cms/server/models/warehouse.js'
import {
  PAYMENT_METHODS,
} from '../../tm-cms/server/models/payment.js'
import {
  PURCHASE_PAYMENT_METHODS,
  PURCHASE_PAYMENT_STATUSES,
  type PurchaseOrderStatus,
} from '../../tm-cms/server/models/purchaseOrder.js'
import { type QuotationStatus } from '../../tm-cms/server/models/quotation.js'
import {
  asLegacyRecord,
  legacyCollectionState,
  legacyDate,
  legacyEmptyDatabaseWarning,
  legacyImageList,
  legacyImageUrl,
  legacyList,
  legacyNumber,
  legacyTenantBuckets,
  legacyText,
} from '../../tm-cms/server/utils/legacyImport.js'

/**
 * `pnpm migrate:crm --site <customerId> [--apply] [--identity-map <file>]`
 *
 * Copies the legacy commerce records into the v2 `crm_*` collections:
 * `customer_segments` → `crm_customer_segments`, `customers` → `crm_customers`,
 * `suppliers` → `crm_suppliers`, `warehouses` → `crm_warehouses`,
 * `inventories` → `crm_inventories`, `purchase_orders` → `crm_purchase_orders`,
 * `quotations` → `crm_quotations` and `payment_transactions` → `crm_payments`.
 * `migration:mapping` prints the field-level matrix for the same domains.
 *
 * Dry run unless `--apply`. Every record is matched on its own business key
 * (`code`, or item+variant+warehouse for a stock balance), so a rerun updates
 * the row it wrote before and never duplicates it, and nothing legacy is deleted.
 *
 * Customers are the one domain this command cannot map on its own. v2 links a
 * customer to a Hub subject, and the migration plan is explicit that legacy local
 * user ids are joined to Hub subjects through a reviewed identity table, never by
 * email (an email is not a stable join key). So `--identity-map` takes a JSON file
 * of `{ "<legacy userId or customer id>": "<Hub subject>" }`; a customer without an
 * entry is **not** imported and is named in the report, instead of being written
 * with an invented subject that would block the real identity later.
 *
 * Legacy status vocabularies differ from v2's. The mapping is printed, not silent:
 * `completed` → `received`, `submitted` → `sent`, and a cancelled quotation has no
 * v2 state so it becomes `rejected` (v2 has no quotation `cancelled`).
 */

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const siteId = flag('site') || process.env.TM_CUSTOMER_ID || ''
const tenant = flag('tenant') || 'default'
const uri = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'
const database = process.env.TM_MONGO_DB || ''
const apply = process.argv.includes('--apply')
const identityMapPath = flag('identity-map')

if (!siteId) throw new Error('Pass --site <customerId> or set TM_CUSTOMER_ID')
if (!database) throw new Error('Set TM_MONGO_DB to the customer database name')

const MAX_ITEMS = 200

type Raw = Record<string, unknown>

function text(value: unknown, max = 500): string {
  return legacyText(value).slice(0, max)
}

/**
 * An ObjectId is not a string, so `legacyText` drops it; a stored id (legacy
 * `userId`, `assignedStaffId`) has to survive as a historical reference.
 */
function idText(value: unknown): string {
  if (value && typeof value === 'object' && typeof (value as { toHexString?: unknown }).toHexString === 'function') {
    return (value as { toHexString: () => string }).toHexString()
  }
  return legacyText(value)
}

function clamp(value: unknown, min: number, max: number, fallback = min): number {
  const parsed = legacyNumber(value, fallback)
  return Math.min(Math.max(parsed, min), max)
}

function integer(value: unknown, min: number, fallback = min): number {
  return Math.max(min, Math.trunc(legacyNumber(value, fallback)))
}

/** A legacy transition timestamp may be a number, a Long or a date. */
function legacyDateMs(value: unknown): Date | null {
  if (typeof value === 'number' || typeof value === 'string') return legacyDate(value)
  const record = asLegacyRecord(value)
  if (typeof record.low === 'number' && typeof record.high === 'number') {
    // BSON Long as the driver's relaxed JSON (`{ low, high }`).
    const combined = (BigInt(record.high) << 32n) + BigInt(record.low >>> 0)
    return legacyDate(Number(combined))
  }
  return legacyDate(value)
}

async function readIdentityMap(path: string | undefined): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (!path) return map
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
  for (const [legacyId, subject] of Object.entries(asLegacyRecord(raw))) {
    const value = legacyText(subject)
    if (value) map.set(legacyId, value)
  }
  return map
}

/**
 * Legacy item references are legacy `items` ids; the catalog importer kept the
 * same value in `catalog_items.legacyId`, and a v2 variant keeps only its SKU, so
 * a variant reference resolves through the SKU.
 */
interface CatalogIndex {
  items: Map<string, { id: Types.ObjectId; skus: Set<string> }>
}

async function loadCatalogIndex(connection: Awaited<ReturnType<typeof connectDatabase>>): Promise<CatalogIndex> {
  const rows = await connection.collection('catalog_items')
    .find({ siteId, legacyId: { $ne: null } }, { projection: { _id: 1, legacyId: 1, variants: 1 } })
    .toArray()
  const items = new Map<string, { id: Types.ObjectId; skus: Set<string> }>()
  for (const row of rows) {
    const skus = new Set<string>()
    for (const entry of legacyList(row.variants)) {
      const sku = text(asLegacyRecord(entry).sku, 120)
      if (sku) skus.add(sku)
    }
    items.set(String(row.legacyId), { id: row._id as Types.ObjectId, skus })
  }
  return { items }
}

const connection = await connectDatabase({ uri, database })
let failed = false

try {
  const db = connection.db!
  const tenantMatcher = { $or: [{ tenantId: tenant }, { tenantId: { $exists: false } }] }
  const legacyCollections = [
    'customer_segments', 'customers', 'users', 'suppliers', 'warehouses',
    'inventories', 'purchase_orders', 'quotations', 'payment_transactions', 'items',
  ]
  const legacyTenants = await legacyTenantBuckets(connection, legacyCollections)
  const legacyState = await legacyCollectionState(connection, legacyCollections)

  console.log(`crm migration site=${siteId} db=${database} tenant=${tenant} apply=${apply}`)
  console.log(`  legacy tenants ${JSON.stringify(legacyTenants)}`)

  const segments = await db.collection('customer_segments').find(tenantMatcher).toArray()
  const customers = await db.collection('customers').find(tenantMatcher).toArray()
  const users = await db.collection('users').find({}).toArray()
  const suppliers = await db.collection('suppliers').find(tenantMatcher).toArray()
  const warehouses = await db.collection('warehouses').find(tenantMatcher).toArray()
  const inventories = await db.collection('inventories').find(tenantMatcher).toArray()
  const purchaseOrders = await db.collection('purchase_orders').find(tenantMatcher).toArray()
  const quotations = await db.collection('quotations').find(tenantMatcher).toArray()
  const payments = await db.collection('payment_transactions').find(tenantMatcher).toArray()
  const catalog = await loadCatalogIndex(connection)
  const identityMap = await readIdentityMap(identityMapPath)

  if (!Object.keys(legacyTenants).length) {
    console.log(`  ⚠️  ${legacyEmptyDatabaseWarning(legacyState, database, 'crm')}`)
  }

  const userById = new Map(users.map(user => [String(user._id), user]))

  // ---------------------------------------------------------------- segments
  const segmentRows = segments.map((record) => {
    const code = normalizeCustomerSegmentCode(legacyText(record.code) || legacyText(record.title))
    const criteria = asLegacyRecord(record.autoJoinCriteria)
    return {
      legacyId: String(record._id),
      filter: { siteId, code },
      doc: {
        siteId,
        code,
        title: text(record.title, 200) || code,
        description: text(record.description, 1000),
        defaultDiscountPercent: clamp(record.defaultDiscountPercent, 0, 100),
        freeShipping: record.freeShipping === true,
        thumbnail: legacyImageUrl(record.thumbnail)?.slice(0, 500) ?? null,
        gallery: legacyImageList(record.gallery).map(url => url.slice(0, 500)).slice(0, 20),
        autoJoinCriteria: {
          minSpent: Math.max(0, legacyNumber(criteria.minSpent)),
          minOrders: integer(criteria.minOrders, 0, 0),
        },
        sort: integer(record.sort, 0, 0),
        isActive: record.isDeleted !== true,
        isDeleted: record.isDeleted === true,
        deletedAt: legacyDate(record.deletedAt),
      },
    }
  }).filter(row => row.doc.code)

  // --------------------------------------------------------------- customers
  const unmappedCustomers: string[] = []
  const customerRows: { legacyId: string, filter: Raw, doc: Raw }[] = []
  const usedSubjects = new Set<string>()

  for (const record of customers) {
    const legacyId = String(record._id)
    const legacyUserId = String(record.userId ?? '')
    const subject = identityMap.get(legacyUserId) ?? identityMap.get(legacyId) ?? ''
    if (!subject) {
      unmappedCustomers.push(`${legacyText(record.code) || legacyId} (userId ${legacyUserId || '-'})`)
      continue
    }
    if (usedSubjects.has(subject)) {
      unmappedCustomers.push(`${legacyText(record.code) || legacyId} (Hub subject already used by another row)`)
      continue
    }
    usedSubjects.add(subject)

    const user = userById.get(legacyUserId)
    const profile = asLegacyRecord(user?.profile)
    const addresses = legacyList(record.addresses).slice(0, 10).map((entry, index) => {
      const address = asLegacyRecord(entry)
      return {
        fullName: text(address.recipientName ?? address.fullName, 200),
        phone: text(address.phone, 40),
        street: text(address.street, 300),
        ward: text(address.ward, 120),
        district: text(address.district, 120),
        city: text(address.city, 120),
        country: text(address.country, 120),
        isDefault: address.isDefault === true && index === 0,
        sort: integer(address.sort, 0, 0),
      }
    })
    const metrics = asLegacyRecord(record.metrics)
    const code = normalizeCustomerCode(legacyText(record.code))

    customerRows.push({
      legacyId,
      filter: { siteId, code },
      doc: {
        siteId,
        code,
        subjectId: subject,
        email: text(user?.email, 200),
        fullName: text(profile.fullName, 200),
        phone: text(profile.phone, 40),
        addresses,
        customerSegmentId: null, // filled after the segments are written
        loyaltyPoints: integer(record.loyaltyPoints, 0, 0),
        metrics: {
          totalOrders: integer(metrics.totalOrders, 0, 0),
          totalSpent: Math.max(0, legacyNumber(metrics.totalSpent)),
          lastOrderAt: null,
        },
        note: text(record.note, 2000),
        isActive: record.isActive !== false,
        isDeleted: record.isDeleted === true,
        deletedAt: legacyDate(record.deletedAt),
      },
    })
  }

  // --------------------------------------------------------------- suppliers
  const supplierRows = suppliers.map((record) => {
    const code = normalizeSupplierCode(legacyText(record.code))
    const status = legacyText(record.status) === 'inactive' ? 'inactive' : 'active'
    return {
      legacyId: String(record._id),
      filter: { siteId, code },
      doc: {
        siteId,
        code,
        title: text(record.title, 200) || code,
        email: text(record.email, 200),
        phone: text(record.phone, 40),
        status,
        rating: clamp(record.rating, 0, 5),
        itemsSupplied: legacyList(record.itemsSupplied)
          .map(entry => text(entry, 64))
          .filter(Boolean)
          .slice(0, 500),
        avatar: legacyImageUrl(record.avatar)?.slice(0, 500) ?? null,
        note: text(record.note, 2000),
        isDeleted: record.isDeleted === true,
        deletedAt: legacyDate(record.deletedAt),
      },
    }
  }).filter(row => row.doc.code)

  // -------------------------------------------------------------- warehouses
  const warehouseRows = warehouses.map((record) => {
    const code = normalizeWarehouseCode(legacyText(record.code))
    return {
      legacyId: String(record._id),
      filter: { siteId, code },
      doc: {
        siteId,
        code,
        title: text(record.title, 200) || code,
        address: text(record.address, 500),
        phone: text(record.phone, 40),
        status: legacyText(record.status) === 'inactive' ? 'inactive' : 'active',
        description: text(record.description, 2000),
        avatar: legacyImageUrl(record.avatar)?.slice(0, 500) ?? null,
        sort: integer(record.sort, 0, 0),
        isDeleted: record.isDeleted === true,
        deletedAt: legacyDate(record.deletedAt),
      },
    }
  }).filter(row => row.doc.code)

  if (!apply) {
    console.log('\n  planned rows')
    console.log(`    customer segments  ${segmentRows.length}`)
    console.log(`    customers          ${customerRows.length}${unmappedCustomers.length ? ` (${unmappedCustomers.length} skipped: ${identityMap.size ? 'no Hub subject in the identity map' : 'pass --identity-map'})` : ''}`)
    console.log(`    suppliers          ${supplierRows.length}`)
    console.log(`    warehouses         ${warehouseRows.length}`)
    console.log(`    inventories        ${inventories.length} legacy rows (resolved on apply)`)
    console.log(`    purchase orders    ${purchaseOrders.length}`)
    console.log(`    quotations         ${quotations.length}`)
    console.log(`    payments           ${payments.length}`)
    for (const entry of unmappedCustomers.slice(0, 10)) console.log(`      skipped customer ${entry}`)
    console.log('  nothing was written; rerun with --apply')
  } else {
    const { CustomerSegment, Customer, Supplier, Warehouse, Inventory, PurchaseOrder, Quotation, Payment } = await prepareDatabase(connection)

    const segmentIdByLegacy = new Map<string, Types.ObjectId>()
    for (const row of segmentRows) {
      const written = await CustomerSegment.findOneAndUpdate(
        row.filter,
        { $set: row.doc, $setOnInsert: { revision: 1 } },
        { upsert: true, returnDocument: 'after' },
      ).lean<{ _id: Types.ObjectId } | null>()
      if (written?._id) segmentIdByLegacy.set(row.legacyId, written._id)
    }

    const segmentByLegacy = new Map(segments.map(record => [String(record._id), String(record._id)]))
    for (const row of customerRows) {
      const legacy = customers.find(record => String(record._id) === row.legacyId)
      const legacySegment = String(legacy?.customerSegment ?? '')
      if (legacySegment && segmentByLegacy.has(legacySegment)) {
        row.doc.customerSegmentId = segmentIdByLegacy.get(legacySegment) ?? null
      }
      await Customer.updateOne(row.filter, { $set: row.doc, $setOnInsert: { revision: 1 } }, { upsert: true })
    }

    const supplierIdByLegacy = new Map<string, Types.ObjectId>()
    for (const row of supplierRows) {
      const written = await Supplier.findOneAndUpdate(
        row.filter,
        { $set: row.doc, $setOnInsert: { revision: 1 } },
        { upsert: true, returnDocument: 'after' },
      ).lean<{ _id: Types.ObjectId } | null>()
      if (written?._id) supplierIdByLegacy.set(row.legacyId, written._id)
    }

    const warehouseIdByLegacy = new Map<string, Types.ObjectId>()
    for (const row of warehouseRows) {
      const written = await Warehouse.findOneAndUpdate(
        row.filter,
        { $set: row.doc, $setOnInsert: { revision: 1 } },
        { upsert: true, returnDocument: 'after' },
      ).lean<{ _id: Types.ObjectId } | null>()
      if (written?._id) warehouseIdByLegacy.set(row.legacyId, written._id)
    }

    const customerIdByLegacy = new Map<string, Types.ObjectId>()
    for (const record of customers) {
      const written = await Customer.findOne({ siteId, code: normalizeCustomerCode(legacyText(record.code)) })
        .select({ _id: 1 })
        .lean<{ _id: Types.ObjectId } | null>()
      if (written?._id) customerIdByLegacy.set(String(record._id), written._id)
    }

    // ------------------------------------------------------------ inventories
    const unresolved = { item: 0, warehouse: 0, variant: 0 }
    let inventoryWritten = 0
    const seenBalances = new Set<string>()

    for (const record of inventories) {
      const item = catalog.items.get(String(record.itemId))
      if (!item) {
        unresolved.item++
        continue
      }
      const warehouseId = warehouseIdByLegacy.get(String(record.warehouseId))
      if (!warehouseId) {
        unresolved.warehouse++
        continue
      }
      const legacyVariant = String(record.variantId ?? '')
      let variantId: string | null = null
      if (legacyVariant) {
        const sku = text(record.sku, 120)
        if (sku && item.skus.has(sku)) variantId = sku
        else unresolved.variant++
      }
      const key = `${item.id}:${variantId ?? '-'}:${warehouseId}`
      if (seenBalances.has(key)) continue
      seenBalances.add(key)

      const quantityOnHand = Math.max(0, legacyNumber(record.quantityOnHand))
      await Inventory.updateOne(
        { siteId, itemId: String(item.id), variantId, warehouseId: String(warehouseId) },
        {
          $set: {
            siteId,
            itemId: String(item.id),
            variantId,
            warehouseId: String(warehouseId),
            sku: text(record.sku, 120),
            quantityOnHand,
            quantityReserved: Math.max(0, legacyNumber(record.quantityReserved)),
            binLocation: text(record.binLocation, 120),
            lowStockThreshold: integer(record.lowStockThreshold, 0, 0),
            isDeleted: false,
            deletedAt: null,
          },
          $setOnInsert: { revision: 1 },
        },
        { upsert: true },
      )
      inventoryWritten++
    }

    // -------------------------------------------------------- purchase orders
    const PO_STATUS: Record<string, PurchaseOrderStatus> = {
      draft: 'draft',
      pending: 'ordered',
      ordered: 'ordered',
      partial: 'partial',
      received: 'received',
      completed: 'received',
      cancelled: 'cancelled',
    }
    const statusNotes = new Set<string>()
    let poWritten = 0
    let unresolvedSuppliers = 0

    for (const record of purchaseOrders) {
      const code = text(record.code, 32)
      if (!code) continue
      const rawStatus = legacyText(record.status)
      const status = PO_STATUS[rawStatus] ?? 'draft'
      if (!PO_STATUS[rawStatus]) statusNotes.add(`purchase order status "${rawStatus || '(empty)'}" → draft`)

      const items = legacyList(record.items).slice(0, MAX_ITEMS).map((entry) => {
        const item = asLegacyRecord(entry)
        const mapped = catalog.items.get(String(item.itemId ?? ''))
        const title = asLegacyRecord(item.title)
        const quantity = Math.max(1, integer(item.quantity, 1, 1))
        const sku = text(item.sku, 120)
        return {
          itemId: mapped ? String(mapped.id) : null,
          variantId: mapped && sku && mapped.skus.has(sku) ? sku : null,
          itemName: (text(title.vi, 300) || text(title.en, 300) || sku || 'Legacy item'),
          sku,
          quantity,
          unitCost: Math.max(0, legacyNumber(item.purchasePrice ?? item.price)),
          receivedQuantity: Math.max(0, legacyNumber(item.receivedQuantity)),
          rejectedQuantity: Math.max(0, legacyNumber(item.rejectedQuantity)),
          note: text(item.note, 500),
        }
      }).filter(item => item.itemName)

      const paymentStatus = PURCHASE_PAYMENT_STATUSES.includes(legacyText(record.paymentStatus) as never)
        ? legacyText(record.paymentStatus) as (typeof PURCHASE_PAYMENT_STATUSES)[number]
        : 'unpaid'
      const paymentMethod = PURCHASE_PAYMENT_METHODS.includes(legacyText(record.paymentMethod) as never)
        ? legacyText(record.paymentMethod) as (typeof PURCHASE_PAYMENT_METHODS)[number]
        : 'other'
      const delivery = legacyDateMs(record.expectedDeliveryDate)
      if (record.supplierId && !supplierIdByLegacy.has(String(record.supplierId))) unresolvedSuppliers++

      await PurchaseOrder.updateOne(
        { siteId, code },
        {
          $set: {
            siteId,
            code,
            supplierId: supplierIdByLegacy.get(String(record.supplierId ?? ''))?.toString() ?? null,
            warehouseId: warehouseIdByLegacy.get(String(record.warehouseId ?? ''))?.toString() ?? null,
            status,
            paymentStatus,
            paymentMethod,
            items,
            totalAmount: Math.max(0, legacyNumber(record.totalAmount)),
            orderedTotalAmount: Math.max(0, legacyNumber(record.orderedTotalAmount)),
            paidAmount: Math.max(0, legacyNumber(record.paidAmount)),
            expectedDeliveryDate: delivery ? delivery.toISOString() : null,
            reconcileNote: text(record.reconcileNote, 2000),
            note: text(record.note, 2000),
            isDeleted: record.isDeleted === true,
            deletedAt: legacyDate(record.deletedAt),
          },
          $setOnInsert: { revision: 1 },
        },
        { upsert: true },
      )
      poWritten++
    }

    // ------------------------------------------------------------ quotations
    const QUOTE_STATUS: Record<string, QuotationStatus> = {
      draft: 'draft',
      submitted: 'sent',
      sent: 'sent',
      accepted: 'accepted',
      rejected: 'rejected',
      cancelled: 'rejected',
      expired: 'expired',
      converted: 'converted',
    }
    let quoteWritten = 0
    let unmappedQuoteCustomers = 0

    for (const record of quotations) {
      const code = text(record.code, 32)
      if (!code) continue
      const rawStatus = legacyText(record.status)
      const status = QUOTE_STATUS[rawStatus] ?? 'draft'
      if (!QUOTE_STATUS[rawStatus]) statusNotes.add(`quotation status "${rawStatus || '(empty)'}" → draft`)

      if (record.customerId && !customerIdByLegacy.has(String(record.customerId))) unmappedQuoteCustomers++
      const items = legacyList(record.items).slice(0, MAX_ITEMS).map((entry) => {
        const item = asLegacyRecord(entry)
        const mapped = catalog.items.get(String(item.itemId ?? ''))
        const sku = text(item.sku, 120)
        const attributes: Record<string, string> = {}
        for (const attribute of legacyList(item.attributes)) {
          const pair = asLegacyRecord(attribute)
          const key = text(pair.k ?? pair.key, 60)
          const value = text(pair.v ?? pair.value, 200)
          if (key && value) attributes[key] = value
        }
        return {
          itemId: mapped ? String(mapped.id) : null,
          variantId: mapped && sku && mapped.skus.has(sku) ? sku : null,
          itemName: text(item.itemName, 300) || text(item.name, 300) || sku || 'Legacy item',
          sku,
          attributes,
          price: Math.max(0, legacyNumber(item.quotedPrice ?? item.basePrice)),
          quantity: Math.max(1, integer(item.quantity, 1, 1)),
          thumbnail: legacyImageUrl(item.thumbnail)?.slice(0, 500) ?? null,
        }
      }).filter(item => item.itemName)

      const address = asLegacyRecord(record.shippingAddress)
      const validUntil = record.validUntil === null || record.validUntil === undefined
        ? null
        : Math.max(0, Math.trunc(legacyNumber(record.validUntil)))

      await Quotation.updateOne(
        { siteId, code },
        {
          $set: {
            siteId,
            code,
            customerId: customerIdByLegacy.get(String(record.customerId ?? '')) ?? null,
            userId: idText(record.userId).slice(0, 128),
            channel: legacyText(record.channel) === 'portal' ? 'portal' : 'admin',
            status,
            currency: 'VND',
            items,
            itemsPrice: Math.max(0, legacyNumber(record.itemsPrice)),
            shippingFee: Math.max(0, legacyNumber(record.shippingFee)),
            discountAmount: Math.max(0, legacyNumber(record.discountAmount)),
            totalAmount: Math.max(0, legacyNumber(record.totalAmount)),
            shippingAddress: {
              fullName: text(address.fullName, 200),
              phone: text(address.phone, 40),
              street: text(address.street, 300),
              ward: text(address.ward, 120),
              district: text(address.district, 120),
              city: text(address.city, 120),
              country: text(address.country, 120),
            },
            adminNote: text(record.adminNote, 2000),
            customerNote: text(record.customerNote, 2000),
            internalNote: text(record.internalNote, 2000),
            assignedStaffId: idText(record.assignedStaffId).slice(0, 128) || null,
            warehouseId: warehouseIdByLegacy.get(String(record.warehouseId ?? ''))?.toString() ?? null,
            validUntil,
            convertedOrderId: null,
            estimatedCost: Math.max(0, legacyNumber(record.estimatedCost)),
            estimatedProfit: legacyNumber(record.estimatedProfit),
            version: Math.max(1, integer(record.version, 1, 1)),
            isDeleted: record.isDeleted === true,
            deletedAt: legacyDate(record.deletedAt),
          },
          $setOnInsert: { revision: 1 },
        },
        { upsert: true },
      )
      quoteWritten++
    }

    // ---------------------------------------------------------------- payments
    // The legacy ledger stores one row per money movement; v2 keeps the same row
    // plus an allocation list, so a single-document payment has one entry.
    const poIdByCode = new Map<string, Types.ObjectId>()
    for (const row of await connection.collection('crm_purchase_orders')
      .find({ siteId }, { projection: { _id: 1, code: 1 } })
      .toArray()) {
      poIdByCode.set(String(row.code), row._id as Types.ObjectId)
    }
    let paymentWritten = 0
    let skippedPayments = 0

    for (const record of payments) {
      const code = text(record.code, 32)
      const referenceCode = text(record.referenceCode, 40)
      const referenceId = poIdByCode.get(referenceCode)
      if (!code || legacyText(record.referenceModel) !== 'PurchaseOrder' || !referenceId) {
        skippedPayments++
        continue
      }
      const amount = Math.max(0, legacyNumber(record.amount))
      if (amount <= 0) {
        skippedPayments++
        continue
      }
      const method = PAYMENT_METHODS.includes(legacyText(record.method) as never)
        ? legacyText(record.method) as (typeof PAYMENT_METHODS)[number]
        : 'other'
      const direction = legacyText(record.type) === 'in' ? 'receivable' : 'payable'
      const paidAt = legacyDateMs(record.createdAt) ?? new Date()

      await Payment.updateOne(
        { siteId, code },
        {
          $set: {
            siteId,
            code,
            direction,
            referenceModel: 'PurchaseOrder',
            referenceId,
            referenceCode,
            partyId: supplierIdByLegacy.get(String(record.partnerId ?? '')) ?? null,
            allocations: [{ referenceModel: 'PurchaseOrder', referenceId, referenceCode, amount }],
            amount,
            currency: 'VND',
            method,
            state: legacyText(record.status) === 'completed' ? 'posted' : 'voided',
            note: text(record.note, 1000),
            paidAt,
            performerId: idText(record.createdBy).slice(0, 128) || null,
            voidedAt: null,
            voidedBy: null,
            voidReason: '',
            reconciledAt: null,
            reconciliationRef: '',
          },
          $setOnInsert: { revision: 1 },
        },
        { upsert: true },
      )
      paymentWritten++
    }

    // A write loop can stop half-way and still print a healthy line, so re-read
    // what the plan expects and fail the command when the database lacks it.
    const expected = {
      customers: customerRows.map(row => row.doc.code as string),
      segments: segmentRows.map(row => row.doc.code),
      suppliers: supplierRows.map(row => row.doc.code),
      warehouses: warehouseRows.map(row => row.doc.code),
      purchaseOrders: purchaseOrders.map(row => text(row.code, 32)).filter(Boolean),
      quotations: quotations.map(row => text(row.code, 32)).filter(Boolean),
      payments: payments.map(row => text(row.code, 32)).filter(Boolean),
    }
    const found = {
      customers: await Customer.countDocuments({ siteId, code: { $in: expected.customers } }),
      segments: await CustomerSegment.countDocuments({ siteId, code: { $in: expected.segments } }),
      suppliers: await Supplier.countDocuments({ siteId, code: { $in: expected.suppliers } }),
      warehouses: await Warehouse.countDocuments({ siteId, code: { $in: expected.warehouses } }),
      purchaseOrders: await PurchaseOrder.countDocuments({ siteId, code: { $in: expected.purchaseOrders } }),
      quotations: await Quotation.countDocuments({ siteId, code: { $in: expected.quotations } }),
      payments: await Payment.countDocuments({ siteId, code: { $in: expected.payments } }),
    }

    console.log(`\n  wrote        segments ${segmentRows.length}, customers ${customerRows.length}, suppliers ${supplierRows.length}, warehouses ${warehouseRows.length}, inventory ${inventoryWritten}, purchase orders ${poWritten}, quotations ${quoteWritten}, payments ${paymentWritten}`)
    console.log(`  verified     segments ${found.segments}/${expected.segments.length}, customers ${found.customers}/${expected.customers.length}, suppliers ${found.suppliers}/${expected.suppliers.length}, warehouses ${found.warehouses}/${expected.warehouses.length}, purchase orders ${found.purchaseOrders}/${expected.purchaseOrders.length}, quotations ${found.quotations}/${expected.quotations.length}, payments ${found.payments}/${expected.payments.length}`)
    if (Object.entries(found).some(([key, value]) => value < expected[key as keyof typeof expected].length)) failed = true
    if (skippedPayments) {
      console.log(`  ⚠️  ${skippedPayments} legacy payment row(s) skipped: no migrated reference document, an unknown reference model, or an amount of zero`)
    }

    if (unmappedCustomers.length) {
      console.log(`  ⚠️  ${unmappedCustomers.length} customer(s) not imported without a reviewed Hub subject:`)
      for (const entry of unmappedCustomers.slice(0, 20)) console.log(`      ${entry}`)
      console.log('      add them to the identity map and rerun; the rows are not written with an invented subject')
    }
    if (unresolved.item || unresolved.warehouse || unresolved.variant) {
      console.log(`  ⚠️  unresolved references: ${unresolved.item} item, ${unresolved.warehouse} warehouse, ${unresolved.variant} variant (rows skipped or stored with variantId null)`)
    }
    if (unresolvedSuppliers) {
      console.log(`  ⚠️  ${unresolvedSuppliers} purchase order(s) point at a supplier that no longer exists in the legacy collection; supplierId is null`)
    }
    if (unmappedQuoteCustomers) {
      console.log(`  ⚠️  ${unmappedQuoteCustomers} quotation(s) point at a customer not migrated (no Hub subject); customerId is null`)
    }
    if (statusNotes.size) {
      console.log('  status mapping applied')
      for (const note of statusNotes) console.log(`      ${note}`)
    }
    if (failed) process.exitCode = 1
  }

  // Legacy keys with no v2 destination are reported, never silently dropped.
  const notes: string[] = []
  if (customers.some(row => asLegacyRecord(row).history && legacyList(asLegacyRecord(row).history).length)) notes.push('customers.history')
  if (purchaseOrders.some(row => row.createdBy)) notes.push('purchase_orders.createdBy (historical actor id)')
  if (quotations.some(row => row.history && legacyList(row.history as unknown[]).length)) notes.push('quotations.history')
  if (quotations.some(row => legacyList(row.items).some(item => asLegacyRecord(item).supplierId))) notes.push('quotations.items[].supplierId / importPrice')
  if (inventories.some(row => row.history && legacyList(row.history as unknown[]).length)) notes.push('inventories.history')
  if (notes.length) {
    console.log(`  ℹ️  legacy fields with no v2 destination: ${notes.join(', ')}`)
  }
} finally {
  await closeDatabaseConnections()
}
