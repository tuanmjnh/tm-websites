import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { CustomerDocument } from '../models/customer'
import {
  OrderInvariantError,
  type OrderAddress,
  type OrderDocument,
  type OrderItem,
  normalizeOrderInput,
} from '../models/order'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'
import { ORDER_STATUS_TEMPLATE, type OrderStatusMailModels, queueOrderStatusMail } from './orderStatusMail'
import {
  applyOrderStockTransition,
  orderStockStateOf,
  type OrderStockDeps,
  type OrderStockState,
} from './orderStockService'

export class OrderServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'OrderServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type OrderRecord = OrderDocument & { _id: Types.ObjectId }

/**
 * Optional side effects of an update. `notify` carries the mail models so a real
 * status change can tell the customer without the order service owning the
 * queue; callers that pass none keep the plain update.
 */
export interface OrderUpdateMeta {
  audit?: ContentAuditMeta
  notify?: OrderStatusMailModels
  stock?: OrderStockDeps
}

export interface OrderCreateMeta {
  audit?: ContentAuditMeta
  actorId?: string
  stock?: OrderStockDeps
}

export interface OrderAdmin {
  id: string
  siteId: string
  code: string
  customerId: string | null
  channel: string
  status: string
  paymentStatus: string
  paymentMethod: string
  currency: string
  items: OrderItem[]
  itemsPrice: number
  shippingFee: number
  discountAmount: number
  totalAmount: number
  paidAmount: number
  shippingAddress: OrderAddress
  note: string
  warehouseId: string | null
  history: { status: string; at: string; note: string; actorId: string }[]
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface OrderListParams {
  q?: string
  status?: string | null
  customerId?: string | null
  includeDeleted?: boolean
  cursor?: string | null
  limit?: number
}

export interface OrderListResult {
  data: OrderAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number; active: number; deleted: number }
}

const RESOURCE = 'order'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const SEARCH_MAX = 80

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')
}

export function toAdminOrder(record: OrderRecord): OrderAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    code: record.code,
    customerId: record.customerId ? String(record.customerId) : null,
    channel: record.channel ?? 'admin',
    status: record.status ?? 'pending',
    paymentStatus: record.paymentStatus ?? 'unpaid',
    paymentMethod: record.paymentMethod ?? 'cash',
    currency: record.currency ?? 'VND',
    items: (record.items ?? []).map((item) => ({
      itemId: item.itemId ?? null,
      variantId: item.variantId ?? null,
      supplierId: item.supplierId ?? null,
      itemName: item.itemName,
      sku: item.sku ?? '',
      attributes: item.attributes ?? {},
      price: item.price ?? 0,
      quantity: item.quantity ?? 1,
      thumbnail: item.thumbnail ?? null,
      returnedQuantity: item.returnedQuantity ?? 0,
    })),
    itemsPrice: record.itemsPrice ?? 0,
    shippingFee: record.shippingFee ?? 0,
    discountAmount: record.discountAmount ?? 0,
    totalAmount: record.totalAmount ?? 0,
    paidAmount: record.paidAmount ?? 0,
    shippingAddress: {
      fullName: record.shippingAddress?.fullName ?? '',
      phone: record.shippingAddress?.phone ?? '',
      street: record.shippingAddress?.street ?? '',
      ward: record.shippingAddress?.ward ?? '',
      district: record.shippingAddress?.district ?? '',
      city: record.shippingAddress?.city ?? '',
      country: record.shippingAddress?.country ?? '',
    },
    note: record.note ?? '',
    warehouseId: record.warehouseId ?? null,
    history: (record.history ?? []).map((entry) => ({
      status: entry.status,
      at: entry.at,
      note: entry.note ?? '',
      actorId: entry.actorId ?? '',
    })),
    isDeleted: record.isDeleted === true,
    deletedAt: iso(record.deletedAt),
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new OrderServiceError(422, code, 'Order id is not valid')
  }
  return new Types.ObjectId(value)
}

function translateInvariant(error: unknown): never {
  if (error instanceof OrderInvariantError) {
    throw new OrderServiceError(422, error.code, error.message)
  }
  throw error
}

function translateWriteError(error: unknown): never {
  const duplicate = error as { code?: number; keyPattern?: Record<string, unknown> }
  if (duplicate?.code === 11000) {
    throw new OrderServiceError(409, 'ORDER_CODE_EXISTS', 'Another order already uses this code')
  }
  throw error
}

function generatedCode(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `ORD-${yy}${mm}${dd}-${new Types.ObjectId().toHexString().slice(-6).toUpperCase()}`
}

function computeTotals(draft: ReturnType<typeof normalizeOrderInput>): void {
  const itemsPrice = draft.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  draft.itemsPrice = itemsPrice
  draft.totalAmount = Math.max(0, itemsPrice + draft.shippingFee - draft.discountAmount)
}

export async function listOrders(
  model: Model<OrderDocument>,
  siteId: string,
  params: OrderListParams = {},
): Promise<OrderListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }

  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.status) filter.status = params.status
  if (params.customerId) filter.customerId = objectId(params.customerId, 'ORDER_CUSTOMER_ID_INVALID')

  const search = (params.q ?? '').trim().slice(0, SEARCH_MAX)
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i')
    filter.$or = [
      { code: pattern },
      { note: pattern },
      { 'items.itemName': pattern },
      { 'items.sku': pattern },
    ]
  }

  if (params.cursor) filter._id = { $lt: objectId(params.cursor, 'ORDER_CURSOR_INVALID') }

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<OrderRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  return {
    data: page.map(toAdminOrder),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts: await orderCounts(model, siteId),
  }
}

async function orderCounts(model: Model<OrderDocument>, siteId: string): Promise<OrderListResult['counts']> {
  const [all, deleted] = await Promise.all([
    model.countDocuments({ siteId }),
    model.countDocuments({ siteId, isDeleted: true }),
  ])
  return { all: all - deleted, active: all - deleted, deleted }
}

export async function getOrder(model: Model<OrderDocument>, siteId: string, id: string): Promise<OrderAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'ORDER_ID_INVALID'), siteId }).lean<OrderRecord>()
  if (!record) throw new OrderServiceError(404, 'ORDER_NOT_FOUND', 'Order not found')
  return toAdminOrder(record)
}

export async function createOrder(
  model: Model<OrderDocument>,
  customerModel: Model<CustomerDocument> | null,
  siteId: string,
  input: unknown,
  meta?: OrderCreateMeta,
): Promise<OrderAdmin> {
  const source = (input ?? {}) as Record<string, unknown>
  const draft = (() => {
    try {
      return normalizeOrderInput({
        ...source,
        siteId,
        code: source.code || generatedCode(),
      })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  computeTotals(draft)

  // Payment status derivation: paid if paidAmount >= totalAmount
  if (draft.paidAmount >= draft.totalAmount && draft.totalAmount > 0) {
    draft.paymentStatus = 'paid'
  } else if (draft.paidAmount > 0) {
    draft.paymentStatus = 'partial'
  }

  const now = new Date().toISOString()
  const history = draft.history.length
    ? draft.history
    : [{ status: draft.status, at: now, note: 'Created', actorId: meta?.actorId ?? '' }]

  let created
  try {
    created = await model.create({
      ...draft,
      customerId: draft.customerId ? new Types.ObjectId(draft.customerId) : null,
      history,
      revision: 1,
    })
  } catch (error) {
    return translateWriteError(error)
  }

  const record = created.toObject() as OrderRecord

  if (meta?.stock) {
    try {
      await applyOrderStockTransition(
        meta.stock,
        siteId,
        null,
        orderStockStateOf(record),
        { id: String(record._id), code: record.code, model: 'Order' },
        { actorId: meta.actorId },
      )
    } catch (error) {
      // The order was never committed to the caller: drop it so a retry with a
      // fixed cart (or another warehouse) starts from a clean slate.
      await model.deleteOne({ _id: record._id, siteId }).catch(() => undefined)
      throw error
    }
  }

  // Update customer metrics (best-effort; customer may not exist)
  if (draft.customerId && customerModel) {
    try {
      await customerModel.updateOne(
        { _id: new Types.ObjectId(draft.customerId), siteId },
        {
          $inc: { 'metrics.totalOrders': 1, 'metrics.totalSpent': draft.totalAmount },
          $set: { 'metrics.lastOrderAt': new Date() },
        },
      )
    } catch {
      // ignore metric update failures
    }
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: record.status,
    changedFields: ['code', 'customerId', 'status', 'totalAmount', 'items'],
  })

  return toAdminOrder(record)
}

export async function updateOrder(
  model: Model<OrderDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: OrderUpdateMeta,
): Promise<OrderAdmin> {
  const body = input as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new OrderServiceError(422, 'ORDER_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model.findOne({ _id: objectId(id, 'ORDER_ID_INVALID'), siteId }).lean<OrderRecord>()
  if (!record) throw new OrderServiceError(404, 'ORDER_NOT_FOUND', 'Order not found')
  if (record.isDeleted) throw new OrderServiceError(409, 'ORDER_DELETED', 'Order is deleted')

  const blocked = ['shipped', 'completed', 'cancelled'].includes(record.status)
  // Allow status transitions always; block item/total edits after ship
  const editingItems = body.items !== undefined

  const currentDraft = {
    code: record.code,
    customerId: record.customerId ? String(record.customerId) : null,
    channel: record.channel,
    status: body.status ?? record.status,
    paymentStatus: body.paymentStatus ?? record.paymentStatus,
    paymentMethod: body.paymentMethod ?? record.paymentMethod,
    currency: record.currency,
    items: body.items ?? record.items,
    itemsPrice: record.itemsPrice,
    shippingFee: body.shippingFee ?? record.shippingFee,
    discountAmount: body.discountAmount ?? record.discountAmount,
    totalAmount: record.totalAmount,
    paidAmount: body.paidAmount ?? record.paidAmount,
    shippingAddress: body.shippingAddress ?? record.shippingAddress,
    note: body.note ?? record.note,
    warehouseId: body.warehouseId ?? record.warehouseId,
  }

  if (blocked && editingItems) {
    throw new OrderServiceError(409, 'ORDER_LOCKED', 'Order items cannot be changed after shipping')
  }

  const draft = (() => {
    try {
      return normalizeOrderInput({ ...currentDraft, siteId, code: currentDraft.code })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  computeTotals(draft)

  if (draft.paidAmount >= draft.totalAmount && draft.totalAmount > 0) {
    draft.paymentStatus = 'paid'
  } else if (draft.paidAmount > 0) {
    draft.paymentStatus = 'partial'
  } else if (draft.paidAmount === 0) {
    draft.paymentStatus = 'unpaid'
  }

  const nextState: OrderStockState = { warehouseId: draft.warehouseId, status: draft.status, items: draft.items }
  const rollbackStock = meta?.stock
    ? await applyOrderStockTransition(
      meta.stock,
      siteId,
      orderStockStateOf(record),
      nextState,
      { id: String(record._id), code: record.code, model: 'Order' },
    )
    : async () => {}

  const statusChanged = draft.status !== record.status
  const newHistory = statusChanged
    ? [...(record.history ?? []), { status: draft.status, at: new Date().toISOString(), note: (body.note as string) ?? '', actorId: '' }]
    : record.history ?? []

  let updated: OrderRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision },
      {
        $set: {
          status: draft.status,
          paymentStatus: draft.paymentStatus,
          paymentMethod: draft.paymentMethod,
          currency: draft.currency,
          items: draft.items,
          itemsPrice: draft.itemsPrice,
          shippingFee: draft.shippingFee,
          discountAmount: draft.discountAmount,
          totalAmount: draft.totalAmount,
          paidAmount: draft.paidAmount,
          shippingAddress: draft.shippingAddress,
          note: draft.note,
          warehouseId: draft.warehouseId,
          history: newHistory,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<OrderRecord>()
  } catch (error) {
    await rollbackStock()
    return translateWriteError(error)
  }

  if (!updated) {
    await rollbackStock()
    throw new OrderServiceError(409, 'ORDER_REVISION_CONFLICT', 'Order was changed by someone else; reload before saving', { expected: revision })
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
    changedFields: ['status', 'paymentStatus', 'items', 'totalAmount'],
  })

  // The order is saved; telling the customer is best-effort from here on.
  if (statusChanged && meta?.notify) {
    try {
      const queued = await queueOrderStatusMail(meta.notify, siteId, updated)
      if (!queued) console.warn(`[order-status] no ${ORDER_STATUS_TEMPLATE} mail for ${updated.code}`)
    } catch (error) {
      console.warn(`[order-status] mail failed for ${updated.code}: ${(error as Error).message}`)
    }
  }

  return toAdminOrder(updated)
}

export async function softDeleteOrder(
  model: Model<OrderDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta; stock?: OrderStockDeps },
): Promise<{ id: string; code: string }> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new OrderServiceError(422, 'ORDER_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'ORDER_ID_INVALID'), siteId }).lean<OrderRecord>()
  if (!record) throw new OrderServiceError(404, 'ORDER_NOT_FOUND', 'Order not found')

  const deleted = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<OrderRecord | null>()

  if (!deleted) throw new OrderServiceError(409, 'ORDER_REVISION_CONFLICT', 'Order was changed by someone else; reload before deleting')

  if (meta?.stock) {
    await applyOrderStockTransition(
      meta.stock,
      siteId,
      orderStockStateOf(record),
      null,
      { id: String(record._id), code: record.code, model: 'Order' },
    )
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

export async function restoreOrder(
  model: Model<OrderDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta; stock?: OrderStockDeps },
): Promise<OrderAdmin> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new OrderServiceError(422, 'ORDER_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'ORDER_ID_INVALID'), siteId }).lean<OrderRecord>()
  if (!record) throw new OrderServiceError(404, 'ORDER_NOT_FOUND', 'Order not found')

  const rollbackStock = meta?.stock
    ? await applyOrderStockTransition(
      meta.stock,
      siteId,
      null,
      orderStockStateOf(record),
      { id: String(record._id), code: record.code, model: 'Order' },
    )
    : async () => {}

  const restored = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<OrderRecord | null>()

  if (!restored) {
    await rollbackStock()
    throw new OrderServiceError(409, 'ORDER_REVISION_CONFLICT', 'Order was changed by someone else; reload before restoring')
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

  return toAdminOrder(restored)
}
