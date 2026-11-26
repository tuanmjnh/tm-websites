import type { Model } from 'mongoose'
import type { PurchaseOrderDocument } from '../models/purchaseOrder'

/**
 * Purchase-order supplier backfill.
 *
 * The legacy `purchase_orders` rows carry a `supplierId`, but the suppliers they
 * point at are gone: the ids are absent from every collection in every local
 * database. The migration therefore wrote the orders with `supplierId: null`
 * instead of inventing one. This module turns a reviewed map
 * (`purchase order code → supplier code or id`) into a plan and applies it, so
 * the owner decides the supplier exactly as they do for the customer identity
 * map.
 *
 * The plan is pure: it never touches the database. The applier refuses a plan
 * that has an unresolvable entry, so a typo cannot assign a supplier silently.
 */

export type SupplierBackfillStatus =
  | 'assign'
  | 'already-assigned'
  | 'unmapped'
  | 'unknown-supplier'
  | 'deleted-supplier'

export interface SupplierBackfillOrder {
  id: string
  code: string
  supplierId: string | null
}

export interface SupplierBackfillSupplier {
  id: string
  code: string
  title: string
  isDeleted?: boolean
}

export interface SupplierBackfillRow {
  orderId: string
  orderCode: string
  currentSupplierId: string | null
  status: SupplierBackfillStatus
  supplierId: string | null
  supplierCode: string | null
}

export interface SupplierBackfillPlan {
  rows: SupplierBackfillRow[]
  /** Rows an apply would write. */
  assignable: SupplierBackfillRow[]
  /** Map keys that name no purchase order in this site. */
  unknownOrders: string[]
  /** Rows that must stop an apply: the map names no usable supplier. */
  invalid: SupplierBackfillRow[]
}

/**
 * Reads the reviewed map. Codes are compared case-insensitively and an empty
 * value is treated as "still unmapped", so a draft file with blank placeholders
 * is safe to run as a report.
 */
export function normalizeSupplierBackfillMap(input: unknown): Map<string, string> {
  const map = new Map<string, string>()
  if (!input || typeof input !== 'object' || Array.isArray(input)) return map
  for (const [rawCode, rawSupplier] of Object.entries(input as Record<string, unknown>)) {
    if (typeof rawSupplier !== 'string') continue
    const code = rawCode.trim().toUpperCase()
    const supplier = rawSupplier.trim()
    if (code && supplier) map.set(code, supplier)
  }
  return map
}

export function planPurchaseOrderSupplierBackfill(input: {
  orders: SupplierBackfillOrder[]
  suppliers: SupplierBackfillSupplier[]
  map: Map<string, string>
  /** Re-assign an order that already names a supplier. */
  overwrite?: boolean
}): SupplierBackfillPlan {
  const byId = new Map(input.suppliers.map(supplier => [supplier.id, supplier]))
  const byCode = new Map(input.suppliers.map(supplier => [supplier.code.trim().toUpperCase(), supplier]))

  const orderCodes = new Set(input.orders.map(order => order.code.trim().toUpperCase()))
  const unknownOrders = [...input.map.keys()].filter(code => !orderCodes.has(code)).sort()

  const rows: SupplierBackfillRow[] = []
  for (const order of input.orders) {
    const currentSupplierId = order.supplierId || null
    const currentSupplier = currentSupplierId ? byId.get(currentSupplierId) ?? null : null

    if (currentSupplierId && !input.overwrite) {
      rows.push({
        orderId: order.id,
        orderCode: order.code,
        currentSupplierId,
        status: 'already-assigned',
        supplierId: currentSupplierId,
        supplierCode: currentSupplier?.code ?? null,
      })
      continue
    }

    const wanted = input.map.get(order.code.trim().toUpperCase())
    if (!wanted) {
      rows.push({
        orderId: order.id,
        orderCode: order.code,
        currentSupplierId,
        status: 'unmapped',
        supplierId: null,
        supplierCode: null,
      })
      continue
    }

    const supplier = byId.get(wanted) ?? byCode.get(wanted.toUpperCase()) ?? null
    if (!supplier) {
      rows.push({
        orderId: order.id,
        orderCode: order.code,
        currentSupplierId,
        status: 'unknown-supplier',
        supplierId: null,
        supplierCode: null,
      })
      continue
    }
    if (supplier.isDeleted) {
      rows.push({
        orderId: order.id,
        orderCode: order.code,
        currentSupplierId,
        status: 'deleted-supplier',
        supplierId: supplier.id,
        supplierCode: supplier.code,
      })
      continue
    }

    rows.push({
      orderId: order.id,
      orderCode: order.code,
      currentSupplierId,
      status: 'assign',
      supplierId: supplier.id,
      supplierCode: supplier.code,
    })
  }

  const assignable = rows.filter(row => row.status === 'assign')
  const invalid = rows.filter(row => row.status === 'unknown-supplier' || row.status === 'deleted-supplier')
  return { rows, assignable, unknownOrders, invalid }
}

/**
 * Writes the planned supplier and bumps the order revision, guarded on the
 * supplier value the plan was built from: a concurrent edit wins and the row is
 * reported as skipped instead of being overwritten. A rerun plans every written
 * order as `already-assigned`, so it is a no-op.
 */
export async function applyPurchaseOrderSupplierBackfill(
  model: Model<PurchaseOrderDocument>,
  siteId: string,
  plan: SupplierBackfillPlan,
): Promise<{ updated: number, skipped: number }> {
  if (plan.invalid.length || plan.unknownOrders.length) {
    throw new Error('The supplier map has entries that do not resolve; nothing was written')
  }

  let updated = 0
  for (const row of plan.assignable) {
    const result = await model.updateOne(
      { _id: row.orderId, siteId, supplierId: row.currentSupplierId },
      { $set: { supplierId: row.supplierId }, $inc: { revision: 1 } },
    )
    if (result.modifiedCount === 1) updated++
  }

  return { updated, skipped: plan.assignable.length - updated }
}
