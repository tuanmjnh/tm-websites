import type { Model } from 'mongoose'
import type { InventoryTransactionDocument } from '../models/inventoryTransaction'
import type { PurchaseOrderDocument } from '../models/purchaseOrder'
import { CUSTOMER_DAY_MS, isCalendarDate, localDayOf, localDayStartUtc } from '../utils/customerTime'

/**
 * Supplier price history (PUR-01).
 *
 * The source is the stock ledger, not the purchase order: every received line
 * books an `import` transaction with the unit cost it was received at, and each
 * row is dated. Reading the orders instead would collapse several partial
 * receipts into one price on the day the order last changed, which is exactly
 * the number a buyer cannot use.
 *
 * Only receipts count: a line that was ordered and never arrived is a quote,
 * not a price paid.
 */

export class SupplierPriceError extends Error {
  statusCode: number
  code: string
  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = 'SupplierPriceError'
    this.statusCode = statusCode
    this.code = code
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_DAYS = 365
const MAX_DAYS = 1095
const MAX_GROUPS = 200
const MAX_OBSERVATIONS = 50

export interface PriceObservation {
  date: string
  receivedAt: string
  purchaseOrderCode: string
  quantity: number
  unitCost: number
  totalValue: number
}

export interface SupplierItemPrice {
  key: string
  supplierId: string | null
  itemId: string
  variantId: string | null
  sku: string
  itemName: string
  lastUnitCost: number
  lastReceivedAt: string
  lastQuantity: number
  previousUnitCost: number | null
  /** Signed change from the previous distinct price, in percent, one decimal. */
  changePercent: number | null
  minUnitCost: number
  maxUnitCost: number
  /** Weighted by received quantity, so a small trial batch does not move the average. */
  averageUnitCost: number
  totalQuantity: number
  totalValue: number
  observations: number
  history: PriceObservation[]
}

export interface SupplierPricesResult {
  range: { from: string, to: string }
  data: SupplierItemPrice[]
  summary: { suppliers: number, items: number, observations: number }
}

export interface PriceCheck {
  supplierId: string | null
  itemId: string
  variantId: string | null
  proposedUnitCost: number
  quantity: number
  hasHistory: boolean
  lastUnitCost: number | null
  lastReceivedAt: string | null
  changePercent: number | null
  thresholdPercent: number
  needsReview: boolean
  reason: string
}

export interface PurchasePriceParams {
  supplierId?: string | null
  itemId?: string | null
  variantId?: string | null
  from?: string | null
  to?: string | null
  limit?: number | null
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function percentageChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || from <= 0) return null
  return Math.round(((to - from) / from) * 1000) / 10
}

function resolveRange(from: unknown, to: unknown, now: Date): { from: string, to: string, startUtc: Date, endUtc: Date } {
  const today = localDayOf(now)
  const resolvedTo = typeof to === 'string' && to ? to : today
  const resolvedFrom = typeof from === 'string' && from
    ? from
    : localDayOf(new Date(localDayStartUtc(resolvedTo).getTime() - (DEFAULT_DAYS - 1) * DAY_MS))

  if (!isCalendarDate(resolvedFrom) || !isCalendarDate(resolvedTo)) {
    throw new SupplierPriceError(422, 'PRICE_RANGE_INVALID', 'Khoảng ngày không hợp lệ (YYYY-MM-DD)')
  }
  const startUtc = localDayStartUtc(resolvedFrom)
  const endUtc = new Date(localDayStartUtc(resolvedTo).getTime() + CUSTOMER_DAY_MS)
  const days = Math.round((endUtc.getTime() - startUtc.getTime()) / DAY_MS)
  if (days <= 0) throw new SupplierPriceError(422, 'PRICE_RANGE_INVALID', 'Ngày bắt đầu phải trước ngày kết thúc')
  if (days > MAX_DAYS) throw new SupplierPriceError(422, 'PRICE_RANGE_TOO_LONG', `Khoảng giá tối đa ${MAX_DAYS} ngày`)
  return { from: resolvedFrom, to: resolvedTo, startUtc, endUtc }
}

/**
 * Prices the site actually paid, grouped by supplier and item. A receipt row is
 * matched back to its purchase order for the supplier and the item's name.
 */
export async function supplierPriceHistory(
  models: { PurchaseOrder: Model<PurchaseOrderDocument>, InventoryTransaction: Model<InventoryTransactionDocument> },
  siteId: string,
  params: PurchasePriceParams = {},
  now: Date = new Date(),
): Promise<SupplierPricesResult> {
  const range = resolveRange(params.from, params.to, now)
  const limit = Math.min(Math.max(Math.trunc(Number(params.limit ?? MAX_GROUPS)) || MAX_GROUPS, 1), MAX_GROUPS)

  const orderFilter: Record<string, unknown> = {
    siteId,
    isDeleted: { $ne: true },
    status: { $in: ['ordered', 'partial', 'received'] },
  }
  if (params.supplierId) orderFilter.supplierId = params.supplierId

  const orders = await models.PurchaseOrder.find(orderFilter)
    .select({ code: 1, supplierId: 1, items: 1 })
    .lean<Pick<PurchaseOrderDocument, 'code' | 'supplierId' | 'items'>[]>()
  if (orders.length === 0) {
    return { range: { from: range.from, to: range.to }, data: [], summary: { suppliers: 0, items: 0, observations: 0 } }
  }

  const orderByKey = new Map(orders.map(order => [String((order as { _id?: unknown })._id), order]))
  const transactionFilter: Record<string, unknown> = {
    siteId,
    type: 'import',
    referenceModel: 'PurchaseOrder',
    quantityChange: { $gt: 0 },
    createdAt: { $gte: range.startUtc, $lt: range.endUtc },
    referenceId: { $in: [...orderByKey.keys()] },
  }
  if (params.itemId) transactionFilter.itemId = params.itemId
  if (params.variantId !== undefined) transactionFilter.variantId = params.variantId ?? null

  const receipts = await models.InventoryTransaction.find(transactionFilter)
    .sort({ createdAt: 1, _id: 1 })
    .lean<InventoryTransactionDocument[]>()
  if (receipts.length === 0) {
    return { range: { from: range.from, to: range.to }, data: [], summary: { suppliers: 0, items: 0, observations: 0 } }
  }

  const groups = new Map<string, SupplierItemPrice>()
  for (const receipt of receipts) {
    const order = orderByKey.get(String(receipt.referenceId))
    if (!order) continue
    const supplierId = order.supplierId ?? null
    const variantId = receipt.variantId ?? null
    const key = `${supplierId ?? 'none'}::${receipt.itemId}::${variantId ?? ''}`
    const line = (order.items ?? []).find(item =>
      item.itemId === receipt.itemId && (item.variantId ?? null) === variantId)

    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        supplierId,
        itemId: receipt.itemId,
        variantId,
        sku: line?.sku ?? '',
        itemName: line?.itemName ?? receipt.itemId,
        lastUnitCost: receipt.unitCost,
        lastReceivedAt: new Date(receipt.createdAt).toISOString(),
        lastQuantity: receipt.quantityChange,
        previousUnitCost: null,
        changePercent: null,
        minUnitCost: receipt.unitCost,
        maxUnitCost: receipt.unitCost,
        averageUnitCost: receipt.unitCost,
        totalQuantity: 0,
        totalValue: 0,
        observations: 0,
        history: [],
      }
      groups.set(key, group)
    }

    group.minUnitCost = Math.min(group.minUnitCost, receipt.unitCost)
    group.maxUnitCost = Math.max(group.maxUnitCost, receipt.unitCost)
    group.totalQuantity += receipt.quantityChange
    group.totalValue += Math.abs(receipt.quantityChange) * receipt.unitCost
    group.observations += 1
    group.history.push({
      date: localDayOf(new Date(receipt.createdAt)),
      receivedAt: new Date(receipt.createdAt).toISOString(),
      purchaseOrderCode: order.code,
      quantity: receipt.quantityChange,
      unitCost: receipt.unitCost,
      totalValue: round2(Math.abs(receipt.quantityChange) * receipt.unitCost),
    })
  }

  const data = [...groups.values()]
    .map((group) => {
      const history = group.history.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      const latest = history[history.length - 1]!
      // The previous price is the last receipt at a *different* cost: two receipts
      // of the same batch price are one observation, not a 0% change.
      const previous = [...history].reverse().find(row => row.unitCost !== latest.unitCost) ?? null
      return {
        ...group,
        lastUnitCost: latest.unitCost,
        lastReceivedAt: latest.receivedAt,
        lastQuantity: latest.quantity,
        previousUnitCost: previous ? previous.unitCost : null,
        averageUnitCost: round2(group.totalQuantity > 0 ? group.totalValue / group.totalQuantity : latest.unitCost),
        totalValue: round2(group.totalValue),
        changePercent: previous ? percentageChange(previous.unitCost, latest.unitCost) : null,
        history: history.slice(-MAX_OBSERVATIONS),
      }
    })
    .sort((a, b) => b.lastReceivedAt.localeCompare(a.lastReceivedAt))
    .slice(0, limit)

  return {
    range: { from: range.from, to: range.to },
    data,
    summary: {
      suppliers: new Set(data.map(row => row.supplierId ?? 'none')).size,
      items: data.length,
      observations: data.reduce((sum, row) => sum + row.observations, 0),
    },
  }
}

/**
 * "Should we question this price?" — compares a proposed unit cost with the last
 * price paid for the same supplier and item. No history means no verdict: a first
 * purchase cannot be 20% too expensive.
 */
export async function checkSupplierPrice(
  models: { PurchaseOrder: Model<PurchaseOrderDocument>, InventoryTransaction: Model<InventoryTransactionDocument> },
  siteId: string,
  params: {
    supplierId?: string | null
    itemId?: unknown
    variantId?: string | null
    unitCost?: unknown
    quantity?: unknown
    thresholdPercent?: unknown
  },
  now: Date = new Date(),
): Promise<PriceCheck> {
  const itemId = typeof params.itemId === 'string' ? params.itemId.trim() : ''
  if (!itemId) throw new SupplierPriceError(422, 'PRICE_CHECK_ITEM_REQUIRED', 'Thiếu mặt hàng cần kiểm tra giá')

  const unitCost = Number(params.unitCost)
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    throw new SupplierPriceError(422, 'PRICE_CHECK_COST_INVALID', 'Đơn giá không hợp lệ')
  }
  const quantity = params.quantity === undefined ? 0 : Number(params.quantity)
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new SupplierPriceError(422, 'PRICE_CHECK_QUANTITY_INVALID', 'Số lượng không hợp lệ')
  }
  const threshold = params.thresholdPercent === undefined ? 10 : Number(params.thresholdPercent)
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new SupplierPriceError(422, 'PRICE_CHECK_THRESHOLD_INVALID', 'Ngưỡng so sánh phải từ 0 đến 100')
  }

  const history = await supplierPriceHistory(models, siteId, {
    supplierId: params.supplierId ?? null,
    itemId,
    variantId: params.variantId ?? null,
    limit: 1,
  }, now)

  const match = history.data.find(row =>
    row.itemId === itemId
    && (row.variantId ?? null) === (params.variantId ?? null)
    && (row.supplierId ?? null) === (params.supplierId ?? null))

  if (!match) {
    return {
      supplierId: params.supplierId ?? null,
      itemId,
      variantId: params.variantId ?? null,
      proposedUnitCost: unitCost,
      quantity,
      hasHistory: false,
      lastUnitCost: null,
      lastReceivedAt: null,
      changePercent: null,
      thresholdPercent: threshold,
      needsReview: false,
      reason: 'Chưa có lần nhập nào từ nhà cung cấp này để so sánh',
    }
  }

  const changePercent = percentageChange(match.lastUnitCost, unitCost)
  const needsReview = changePercent !== null && Math.abs(changePercent) >= threshold
  return {
    supplierId: match.supplierId,
    itemId,
    variantId: match.variantId,
    proposedUnitCost: unitCost,
    quantity,
    hasHistory: true,
    lastUnitCost: match.lastUnitCost,
    lastReceivedAt: match.lastReceivedAt,
    changePercent,
    thresholdPercent: threshold,
    needsReview,
    reason: needsReview
      ? `Giá ${changePercent! > 0 ? 'tăng' : 'giảm'} ${Math.abs(changePercent!)}% so với lần nhập gần nhất (${match.lastUnitCost})`
      : `Trong ngưỡng ${threshold}% so với lần nhập gần nhất (${match.lastUnitCost})`,
  }
}
