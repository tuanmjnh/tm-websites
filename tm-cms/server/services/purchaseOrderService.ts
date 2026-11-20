import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { SupplierDocument } from '../models/supplier'
import type { InventoryDocument } from '../models/inventory'
import type { InventoryTransactionDocument } from '../models/inventoryTransaction'
import {
  PurchaseOrderInvariantError,
  type PurchaseOrderDocument,
  type PurchaseOrderItem,
  normalizePurchaseOrderInput,
} from '../models/purchaseOrder'
import type { SerialNumberDocument } from '../models/serialNumber'
import { registerSerialNumbers, SerialNumberServiceError } from './serialNumberService'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'
import { recordInventoryTransaction } from './inventoryTransactionService'

export class PurchaseOrderServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'PurchaseOrderServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type PurchaseOrderRecord = PurchaseOrderDocument & { _id: Types.ObjectId }

export interface PurchaseOrderAdmin {
  id: string
  siteId: string
  code: string
  supplierId: string | null
  warehouseId: string | null
  status: string
  paymentStatus: string
  paymentMethod: string
  items: PurchaseOrderItem[]
  totalAmount: number
  orderedTotalAmount: number
  paidAmount: number
  expectedDeliveryDate: string | null
  reconcileNote: string
  note: string
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface PurchaseOrderListParams {
  q?: string
  status?: string | null
  supplierId?: string | null
  includeDeleted?: boolean
  cursor?: string | null
  limit?: number
}

export interface PurchaseOrderListResult {
  data: PurchaseOrderAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number; active: number; deleted: number }
}

const RESOURCE = 'purchase_order'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const SEARCH_MAX = 80

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')
}

export function toAdminPurchaseOrder(record: PurchaseOrderRecord): PurchaseOrderAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    code: record.code,
    supplierId: record.supplierId ?? null,
    warehouseId: record.warehouseId ?? null,
    status: record.status ?? 'draft',
    paymentStatus: record.paymentStatus ?? 'unpaid',
    paymentMethod: record.paymentMethod ?? 'cash',
    items: (record.items ?? []).map((item) => ({
      itemId: item.itemId ?? null,
      variantId: item.variantId ?? null,
      itemName: item.itemName,
      sku: item.sku ?? '',
      quantity: item.quantity ?? 1,
      unitCost: item.unitCost ?? 0,
      receivedQuantity: item.receivedQuantity ?? 0,
      rejectedQuantity: item.rejectedQuantity ?? 0,
      note: item.note ?? '',
    })),
    totalAmount: record.totalAmount ?? 0,
    orderedTotalAmount: record.orderedTotalAmount ?? 0,
    paidAmount: record.paidAmount ?? 0,
    expectedDeliveryDate: record.expectedDeliveryDate ?? null,
    reconcileNote: record.reconcileNote ?? '',
    note: record.note ?? '',
    isDeleted: record.isDeleted === true,
    deletedAt: iso(record.deletedAt),
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new PurchaseOrderServiceError(422, code, 'Purchase order id is not valid')
  }
  return new Types.ObjectId(value)
}

function translateInvariant(error: unknown): never {
  if (error instanceof PurchaseOrderInvariantError) {
    throw new PurchaseOrderServiceError(422, error.code, error.message)
  }
  throw error
}

function translateWriteError(error: unknown): never {
  const duplicate = error as { code?: number; keyPattern?: Record<string, unknown> }
  if (duplicate?.code === 11000) {
    throw new PurchaseOrderServiceError(409, 'PURCHASE_ORDER_CODE_EXISTS', 'Another purchase order already uses this code')
  }
  throw error
}

function generatedCode(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `PO-${yy}${mm}${dd}-${new Types.ObjectId().toHexString().slice(-6).toUpperCase()}`
}

function computeTotals(draft: ReturnType<typeof normalizePurchaseOrderInput>): void {
  const total = draft.items.reduce((sum, item) => sum + item.unitCost * item.quantity, 0)
  draft.totalAmount = total
  draft.orderedTotalAmount = draft.orderedTotalAmount || total
}

export async function listPurchaseOrders(
  model: Model<PurchaseOrderDocument>,
  siteId: string,
  params: PurchaseOrderListParams = {},
): Promise<PurchaseOrderListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }
  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.status) filter.status = params.status
  if (params.supplierId) filter.supplierId = params.supplierId

  const search = (params.q ?? '').trim().slice(0, SEARCH_MAX)
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i')
    filter.$or = [
      { code: pattern },
      { note: pattern },
      { reconcileNote: pattern },
      { 'items.itemName': pattern },
      { 'items.sku': pattern },
    ]
  }

  if (params.cursor) filter._id = { $lt: objectId(params.cursor, 'PURCHASE_ORDER_CURSOR_INVALID') }

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<PurchaseOrderRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  return {
    data: page.map(toAdminPurchaseOrder),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts: await purchaseOrderCounts(model, siteId),
  }
}

async function purchaseOrderCounts(model: Model<PurchaseOrderDocument>, siteId: string): Promise<PurchaseOrderListResult['counts']> {
  const [all, deleted] = await Promise.all([
    model.countDocuments({ siteId }),
    model.countDocuments({ siteId, isDeleted: true }),
  ])
  return { all: all - deleted, active: all - deleted, deleted }
}

export async function getPurchaseOrder(model: Model<PurchaseOrderDocument>, siteId: string, id: string): Promise<PurchaseOrderAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'PURCHASE_ORDER_ID_INVALID'), siteId }).lean<PurchaseOrderRecord>()
  if (!record) throw new PurchaseOrderServiceError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found')
  return toAdminPurchaseOrder(record)
}

export async function createPurchaseOrder(
  model: Model<PurchaseOrderDocument>,
  supplierModel: Model<SupplierDocument> | null,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<PurchaseOrderAdmin> {
  const source = (input ?? {}) as Record<string, unknown>
  const draft = (() => {
    try {
      return normalizePurchaseOrderInput({
        ...source,
        siteId,
        code: source.code || generatedCode(),
      })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  if (draft.supplierId && supplierModel) {
    const supplier = await supplierModel.findOne({ _id: new Types.ObjectId(draft.supplierId), siteId }).select({ _id: 1, isDeleted: 1 }).lean<{ _id: Types.ObjectId; isDeleted?: boolean } | null>()
    if (!supplier) throw new PurchaseOrderServiceError(422, 'PURCHASE_ORDER_SUPPLIER_NOT_FOUND', 'Supplier not found in this site')
    if (supplier.isDeleted) throw new PurchaseOrderServiceError(422, 'PURCHASE_ORDER_SUPPLIER_DELETED', 'Supplier is deleted; restore it first')
  }

  computeTotals(draft)

  if (draft.paidAmount >= draft.totalAmount && draft.totalAmount > 0) {
    draft.paymentStatus = 'paid'
  } else if (draft.paidAmount > 0) {
    draft.paymentStatus = 'partial'
  }

  let created
  try {
    created = await model.create({
      ...draft,
      supplierId: draft.supplierId,
      warehouseId: draft.warehouseId,
      revision: 1,
    })
  } catch (error) {
    return translateWriteError(error)
  }

  const record = created.toObject() as PurchaseOrderRecord

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: record.status,
    changedFields: ['code', 'supplierId', 'status', 'totalAmount', 'items'],
  })

  return toAdminPurchaseOrder(record)
}

function currentDraftOf(record: PurchaseOrderRecord): Record<string, unknown> {
  return {
    code: record.code,
    supplierId: record.supplierId ?? null,
    warehouseId: record.warehouseId ?? null,
    status: record.status ?? 'draft',
    paymentStatus: record.paymentStatus ?? 'unpaid',
    paymentMethod: record.paymentMethod ?? 'cash',
    items: record.items ?? [],
    totalAmount: record.totalAmount ?? 0,
    orderedTotalAmount: record.orderedTotalAmount ?? 0,
    paidAmount: record.paidAmount ?? 0,
    expectedDeliveryDate: record.expectedDeliveryDate ?? null,
    reconcileNote: record.reconcileNote ?? '',
    note: record.note ?? '',
  }
}

export async function updatePurchaseOrder(
  model: Model<PurchaseOrderDocument>,
  supplierModel: Model<SupplierDocument> | null,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<PurchaseOrderAdmin> {
  const body = input as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new PurchaseOrderServiceError(422, 'PURCHASE_ORDER_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model.findOne({ _id: objectId(id, 'PURCHASE_ORDER_ID_INVALID'), siteId }).lean<PurchaseOrderRecord>()
  if (!record) throw new PurchaseOrderServiceError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found')
  if (record.isDeleted) throw new PurchaseOrderServiceError(409, 'PURCHASE_ORDER_DELETED', 'Purchase order is deleted')

  const blocked = ['received', 'cancelled'].includes(record.status)
  const editingItems = body.items !== undefined
  if (blocked && editingItems) {
    throw new PurchaseOrderServiceError(409, 'PURCHASE_ORDER_LOCKED', 'Purchase order items cannot be changed after receipt')
  }

  if (body.supplierId && body.supplierId !== record.supplierId && supplierModel) {
    const supplier = await supplierModel.findOne({ _id: new Types.ObjectId(String(body.supplierId)), siteId }).select({ _id: 1, isDeleted: 1 }).lean<{ _id: Types.ObjectId; isDeleted?: boolean } | null>()
    if (!supplier) throw new PurchaseOrderServiceError(422, 'PURCHASE_ORDER_SUPPLIER_NOT_FOUND', 'Supplier not found in this site')
    if (supplier.isDeleted) throw new PurchaseOrderServiceError(422, 'PURCHASE_ORDER_SUPPLIER_DELETED', 'Supplier is deleted; restore it first')
  }

  const currentDraft = {
    ...currentDraftOf(record),
    status: body.status ?? record.status,
    paymentStatus: body.paymentStatus ?? record.paymentStatus,
    paymentMethod: body.paymentMethod ?? record.paymentMethod,
    items: body.items ?? record.items,
    shippingFee: undefined,
    shippingAddress: undefined,
    paidAmount: body.paidAmount ?? record.paidAmount,
    expectedDeliveryDate: body.expectedDeliveryDate ?? record.expectedDeliveryDate,
    reconcileNote: body.reconcileNote ?? record.reconcileNote,
    note: body.note ?? record.note,
    supplierId: body.supplierId ?? record.supplierId,
    warehouseId: body.warehouseId ?? record.warehouseId,
  }

  const draft = (() => {
    try {
      return normalizePurchaseOrderInput({ ...currentDraft, siteId, code: record.code })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  computeTotals(draft)

  if (draft.paidAmount >= draft.totalAmount && draft.totalAmount > 0) {
    draft.paymentStatus = 'paid'
  } else if (draft.paidAmount > 0) {
    draft.paymentStatus = 'partial'
  } else {
    draft.paymentStatus = 'unpaid'
  }

  let updated: PurchaseOrderRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision },
      {
        $set: {
          status: draft.status,
          paymentStatus: draft.paymentStatus,
          paymentMethod: draft.paymentMethod,
          supplierId: draft.supplierId,
          warehouseId: draft.warehouseId,
          items: draft.items,
          totalAmount: draft.totalAmount,
          orderedTotalAmount: draft.orderedTotalAmount,
          paidAmount: draft.paidAmount,
          expectedDeliveryDate: draft.expectedDeliveryDate,
          reconcileNote: draft.reconcileNote,
          note: draft.note,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<PurchaseOrderRecord>()
  } catch (error) {
    return translateWriteError(error)
  }

  if (!updated) {
    throw new PurchaseOrderServiceError(409, 'PURCHASE_ORDER_REVISION_CONFLICT', 'Purchase order was changed by someone else; reload before saving', { expected: revision })
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.code,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: updated.status,
    changedFields: ['status', 'paymentStatus', 'items', 'totalAmount', 'supplierId'],
  })

  return toAdminPurchaseOrder(updated)
}

export async function softDeletePurchaseOrder(
  model: Model<PurchaseOrderDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<{ id: string; code: string }> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new PurchaseOrderServiceError(422, 'PURCHASE_ORDER_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'PURCHASE_ORDER_ID_INVALID'), siteId }).lean<PurchaseOrderRecord>()
  if (!record) throw new PurchaseOrderServiceError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found')

  const deleted = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<PurchaseOrderRecord | null>()

  if (!deleted) {
    throw new PurchaseOrderServiceError(409, 'PURCHASE_ORDER_REVISION_CONFLICT', 'Purchase order was changed by someone else; reload before deleting')
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'delete',
    revision: deleted.revision,
    fromStatus: record.status,
    toStatus: record.status,
    changedFields: ['isDeleted'],
  })

  return { id: String(record._id), code: record.code }
}

export async function restorePurchaseOrder(
  model: Model<PurchaseOrderDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<PurchaseOrderAdmin> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new PurchaseOrderServiceError(422, 'PURCHASE_ORDER_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'PURCHASE_ORDER_ID_INVALID'), siteId }).lean<PurchaseOrderRecord>()
  if (!record) throw new PurchaseOrderServiceError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found')

  const restored = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<PurchaseOrderRecord | null>()

  if (!restored) {
    throw new PurchaseOrderServiceError(409, 'PURCHASE_ORDER_REVISION_CONFLICT', 'Purchase order was changed by someone else; reload before restoring')
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'restore',
    revision: restored.revision,
    fromStatus: record.status,
    toStatus: record.status,
    changedFields: ['isDeleted'],
  })

  return toAdminPurchaseOrder(restored)
}

export interface PurchaseOrderReceiptLine {
  /** Matches the ordered line, so a receipt cannot invent an item. */
  itemId: string | null
  variantId: string | null
  /** Cumulative totals, not deltas: replaying the same receipt moves no stock. */
  receivedQuantity: number
  rejectedQuantity?: number
  note?: string
  /**
   * Serial/IMEI numbers registered for the *delta* received on this line. When
   * provided, the count must equal the received delta and each serial is
   * registered as `in_stock` against this purchase order and warehouse.
   */
  serials?: string[]
}

function receiptKey(itemId: string | null, variantId: string | null): string {
  return `${itemId ?? '-'}:${variantId ?? '-'}`
}

/**
 * Partial receipt / rejection.
 *
 * Quantities on the PO are cumulative totals, so a retried submission of the
 * same numbers is a no-op: the delta is zero and no ledger row is written. The
 * received part of each delta becomes an `import` movement against the order's
 * warehouse, which is what makes the ledger and the balance agree afterwards.
 */
export async function receivePurchaseOrder(
  model: Model<PurchaseOrderDocument>,
  inventoryModel: Model<InventoryDocument> | null,
  transactionModel: Model<InventoryTransactionDocument> | null,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta; serialNumberModel?: Model<SerialNumberDocument> },
): Promise<PurchaseOrderAdmin> {
  const body = (input ?? {}) as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new PurchaseOrderServiceError(422, 'PURCHASE_ORDER_REVISION_REQUIRED', 'An integer revision is required')
  }
  if (!Array.isArray(body.lines) && !Array.isArray(body.items)) {
    throw new PurchaseOrderServiceError(422, 'PURCHASE_ORDER_RECEIPT_INVALID', 'A receipt needs one line per received item')
  }

  const lines = (body.lines ?? body.items) as PurchaseOrderReceiptLine[]

  const record = await model.findOne({ _id: objectId(id, 'PURCHASE_ORDER_ID_INVALID'), siteId }).lean<PurchaseOrderRecord>()
  if (!record) throw new PurchaseOrderServiceError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found')
  if (record.isDeleted) throw new PurchaseOrderServiceError(409, 'PURCHASE_ORDER_DELETED', 'Purchase order is deleted')
  if (['received', 'cancelled'].includes(record.status)) {
    throw new PurchaseOrderServiceError(409, 'PURCHASE_ORDER_LOCKED', `Purchase order is already ${record.status}`)
  }

  const ordered = new Map<string, PurchaseOrderItem>()
  for (const item of record.items ?? []) ordered.set(receiptKey(item.itemId ?? null, item.variantId ?? null), item)

  const nextItems: PurchaseOrderItem[] = (record.items ?? []).map((item) => ({
    ...item,
    receivedQuantity: item.receivedQuantity ?? 0,
    rejectedQuantity: item.rejectedQuantity ?? 0,
    note: item.note ?? '',
  }))
  const movements: { item: PurchaseOrderItem; quantity: number; serials?: string[] }[] = []

  for (const raw of lines) {
    const key = receiptKey(raw.itemId ?? null, raw.variantId ?? null)
    const target = ordered.get(key)
    if (!target) {
      throw new PurchaseOrderServiceError(422, 'PURCHASE_ORDER_RECEIPT_ITEM_UNKNOWN', 'The receipt names an item the order does not contain', { key })
    }
    const entry = nextItems.find(item => receiptKey(item.itemId ?? null, item.variantId ?? null) === key)!

    const received = Number(raw.receivedQuantity ?? 0)
    const rejected = Number(raw.rejectedQuantity ?? 0)
    if (!Number.isInteger(received) || received < 0 || !Number.isInteger(rejected) || rejected < 0) {
      throw new PurchaseOrderServiceError(422, 'PURCHASE_ORDER_RECEIPT_INVALID', 'Received and rejected quantities must be non-negative integers')
    }
    if (received + rejected > entry.quantity) {
      throw new PurchaseOrderServiceError(409, 'PURCHASE_ORDER_RECEIPT_EXCEEDS_ORDER', 'Received plus rejected cannot exceed the ordered quantity', {
        key,
        ordered: entry.quantity,
        received,
        rejected,
      })
    }
    if (received < entry.receivedQuantity || rejected < entry.rejectedQuantity) {
      throw new PurchaseOrderServiceError(409, 'PURCHASE_ORDER_RECEIPT_REGRESSION', 'A receipt total cannot be lowered', { key })
    }

    const delta = received - entry.receivedQuantity
    entry.receivedQuantity = received
    entry.rejectedQuantity = rejected
    if (raw.note !== undefined) entry.note = String(raw.note).trim().slice(0, 500)

    let serials: string[] | undefined
    if (raw.serials !== undefined) {
      if (!Array.isArray(raw.serials)) {
        throw new PurchaseOrderServiceError(422, 'PURCHASE_ORDER_RECEIPT_INVALID', 'Serials must be an array of strings', { key })
      }
      serials = raw.serials.map(value => String(value).trim()).filter(Boolean)
    }
    if (serials && serials.length > 0 && delta <= 0) {
      throw new PurchaseOrderServiceError(409, 'PURCHASE_ORDER_RECEIPT_SERIAL_COUNT_MISMATCH', 'Serials can only be registered for a received delta', { key, delta, serials: serials.length })
    }
    if (serials && serials.length > 0 && serials.length !== delta) {
      throw new PurchaseOrderServiceError(409, 'PURCHASE_ORDER_RECEIPT_SERIAL_COUNT_MISMATCH', 'The number of serials must equal the received delta', { key, delta, serials: serials.length })
    }

    if (delta > 0) movements.push({ item: entry, quantity: delta, serials })
  }

  const fullyHandled = nextItems.every(item => (item.receivedQuantity ?? 0) + (item.rejectedQuantity ?? 0) >= item.quantity)
  const anythingReceived = nextItems.some(item => (item.receivedQuantity ?? 0) > 0)
  const nextStatus = fullyHandled ? 'received' : (anythingReceived ? 'partial' : record.status)
  const reconcileNote = body.reconcileNote === undefined
    ? (record.reconcileNote ?? '')
    : String(body.reconcileNote).trim().slice(0, 2000)

  // Stock first: an inventory write that fails must not leave the order claiming stock.
  for (const movement of movements) {
    if (movement.serials && movement.serials.length > 0 && (!inventoryModel || !transactionModel)) {
      throw new PurchaseOrderServiceError(422, 'PURCHASE_ORDER_RECEIPT_TARGET_MISSING', 'A received line needs the order warehouse and a catalog item before stock can move', { sku: movement.item.sku })
    }
    if (!inventoryModel || !transactionModel) continue
    const { item } = movement
    if (!record.warehouseId || !item.itemId) {
      throw new PurchaseOrderServiceError(422, 'PURCHASE_ORDER_RECEIPT_TARGET_MISSING', 'A received line needs the order warehouse and a catalog item before stock can move', { sku: item.sku })
    }
    try {
      await recordInventoryTransaction(inventoryModel, transactionModel, siteId, {
        itemId: item.itemId,
        variantId: item.variantId ?? null,
        warehouseId: record.warehouseId,
        type: 'import',
        quantityChange: movement.quantity,
        unitCost: item.unitCost ?? 0,
        referenceModel: 'PurchaseOrder',
        referenceId: String(record._id),
        referenceCode: record.code,
        reason: `Nhận hàng ${record.code}`,
      }, meta)

      if (movement.serials && movement.serials.length > 0) {
        const serialModel = meta?.serialNumberModel
        if (!serialModel) {
          throw new PurchaseOrderServiceError(422, 'PURCHASE_ORDER_RECEIPT_SERIAL_UNSUPPORTED', 'Serial registration is not available for this receipt')
        }
        try {
          await registerSerialNumbers(serialModel, siteId, siteId, movement.serials.map(serial => ({
            serial,
            itemId: item.itemId as string,
            variantId: item.variantId ?? null,
            warehouseId: record.warehouseId,
            purchaseOrderId: String(record._id),
            note: `Nhận hàng ${record.code}`,
          })), { audit: meta?.audit })
        } catch (error) {
          if (error instanceof SerialNumberServiceError) {
            throw new PurchaseOrderServiceError(error.statusCode, 'PURCHASE_ORDER_RECEIPT_SERIAL_FAILED', 'Serial numbers could not be registered for a received line', {
              sku: item.sku,
              cause: error.code,
              details: error.details,
            })
          }
          throw error
        }
      }
    } catch (error) {
      if (error instanceof PurchaseOrderServiceError) throw error
      throw new PurchaseOrderServiceError(422, 'PURCHASE_ORDER_RECEIPT_STOCK_FAILED', 'Stock could not be moved for a received line', {
        sku: item.sku,
        cause: (error as Error).message,
      })
    }
  }

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    {
      $set: {
        items: nextItems,
        status: nextStatus,
        reconcileNote,
      },
      $inc: { revision: 1 },
    },
    { returnDocument: 'after' },
  ).lean<PurchaseOrderRecord | null>()

  if (!updated) {
    throw new PurchaseOrderServiceError(409, 'PURCHASE_ORDER_REVISION_CONFLICT', 'Purchase order was changed by someone else; reload before receiving', { expected: revision })
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.code,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: updated.status,
    changedFields: ['items', 'status', 'reconcileNote'],
  })

  return toAdminPurchaseOrder(updated)
}
