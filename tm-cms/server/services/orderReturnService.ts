import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { OrderDocument } from '../models/order'
import {
  OrderReturnInvariantError,
  type OrderReturnStatus,
  type OrderReturnItem,
  type OrderReturnDocument,
  normalizeOrderReturnInput,
  ORDER_RETURN_STATUSES,
} from '../models/orderReturn'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class OrderReturnServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'OrderReturnServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

const RESOURCE = 'order_return' as const

type ReturnRecord = OrderReturnDocument & { _id: Types.ObjectId }

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value === 'string' && Types.ObjectId.isValid(value)) return new Types.ObjectId(value)
  throw new OrderReturnServiceError(422, code, 'Invalid identifier')
}

function translateInvariant(error: unknown): never {
  if (error instanceof OrderReturnInvariantError) {
    throw new OrderReturnServiceError(422, error.code, error.message)
  }
  if (error instanceof OrderReturnServiceError) throw error
  throw error
}

function toAdmin(record: ReturnRecord) {
  return {
    id: String(record._id),
    siteId: record.siteId,
    code: record.code,
    orderId: record.orderId,
    status: record.status,
    items: record.items,
    refundAmount: record.refundAmount,
    refundMethod: record.refundMethod,
    note: record.note,
    approvedAt: record.approvedAt,
    refundedAt: record.refundedAt,
    cancelledAt: record.cancelledAt,
    revision: record.revision,
    isDeleted: record.isDeleted,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export interface OrderReturnAdmin { id: string, siteId: string, code: string, orderId: string, status: string, items: OrderReturnDocument['items'], refundAmount: number, refundMethod: string, note: string, approvedAt: Date | null, refundedAt: Date | null, cancelledAt: Date | null, revision: number, isDeleted: boolean, createdAt: Date, updatedAt: Date }

export async function getOrderReturn(
  model: Model<OrderReturnDocument>,
  siteId: string,
  id: string,
): Promise<OrderReturnAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'ORDER_RETURN_ID_INVALID'), siteId }).lean<ReturnRecord>()
  if (!record) throw new OrderReturnServiceError(404, 'ORDER_RETURN_NOT_FOUND', 'Order return not found')
  return toAdmin(record)
}

export async function listOrderReturns(
  model: Model<OrderReturnDocument>,
  siteId: string,
  params: { status?: string, orderId?: string, q?: string, cursor?: string, limit?: number, includeDeleted?: boolean } = {},
) {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 50), 1), 200)
  const filter: Record<string, unknown> = { siteId }
  if (params.status && ORDER_RETURN_STATUSES.includes(params.status as OrderReturnStatus)) filter.status = params.status
  if (params.orderId) filter.orderId = params.orderId
  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.q) {
    const q = params.q.trim()
    if (q) filter.$or = [{ code: { $regex: q, $options: 'i' } }, { note: { $regex: q, $options: 'i' } }]
  }
  if (params.cursor && Types.ObjectId.isValid(params.cursor)) filter._id = { $lt: new Types.ObjectId(params.cursor) }

  const rows = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<ReturnRecord[]>()
  const hasMore = rows.length > limit
  const data = (hasMore ? rows.slice(0, limit) : rows).map(toAdmin)
  const nextCursor = hasMore ? String(rows[limit - 1]!._id) : null

  const base: Record<string, unknown> = { siteId }
  if (!params.includeDeleted) base.isDeleted = { $ne: true }
  const counts: Record<string, number> = { all: 0 }
  for (const status of ORDER_RETURN_STATUSES) counts[status] = 0
  counts.all = await model.countDocuments(base)
  for (const status of ORDER_RETURN_STATUSES) counts[status] = await model.countDocuments({ ...base, status })
  const deleted = params.includeDeleted ? await model.countDocuments({ siteId, isDeleted: true }) : 0
  return { data, nextCursor, hasMore, counts: { ...counts, deleted } }
}

async function loadOrder(orderModel: Model<OrderDocument>, siteId: string, orderId: string) {
  const order = await orderModel.findOne({ _id: Types.ObjectId.isValid(orderId) ? new Types.ObjectId(orderId) : null, siteId, isDeleted: { $ne: true } }).lean<OrderDocument & { _id: Types.ObjectId }>()
  if (!order) throw new OrderReturnServiceError(404, 'ORDER_RETURN_ORDER_NOT_FOUND', 'Order not found')
  return order
}

function lineKey(itemId: string | null, variantId: string | null) {
  return `${itemId ?? ''}::${variantId ?? ''}`
}

async function existingReturnedQuantity(model: Model<OrderReturnDocument>, siteId: string, orderId: string, excludeId?: string) {
  const filter: Record<string, unknown> = { siteId, orderId, isDeleted: { $ne: true }, status: { $ne: 'cancelled' } }
  if (excludeId) filter._id = { $ne: new Types.ObjectId(excludeId) }
  const rows = await model.find(filter).lean<ReturnRecord[]>()
  const map = new Map<string, number>()
  for (const row of rows) {
    for (const line of row.items ?? []) {
      const key = lineKey(line.itemId ?? null, line.variantId ?? null)
      map.set(key, (map.get(key) ?? 0) + (line.quantity ?? 0))
    }
  }
  return map
}

async function validateReturnLines(order: OrderDocument & { _id: Types.ObjectId }, model: Model<OrderReturnDocument>, siteId: string, items: OrderReturnItem[], excludeId?: string) {
  const returned = await existingReturnedQuantity(model, siteId, String(order._id), excludeId)
  for (const line of items) {
    const orderItem = (order.items ?? []).find(item =>
      (item.itemId ?? null) === (line.itemId ?? null)
      && (item.variantId ?? null) === (line.variantId ?? null))
    if (!orderItem) {
      throw new OrderReturnServiceError(422, 'ORDER_RETURN_ITEM_NOT_IN_ORDER', 'Return line does not match an order line', { sku: line.sku })
    }
    const key = lineKey(line.itemId ?? null, line.variantId ?? null)
    const already = returned.get(key) ?? 0
    const remaining = orderItem.quantity - already
    if (line.quantity > remaining) {
      throw new OrderReturnServiceError(422, 'ORDER_RETURN_QUANTITY_EXCEEDS_REMAINING', 'Return quantity exceeds what remains to return', { sku: line.sku, remaining })
    }
  }
}

async function adjustOrderReturned(orderModel: Model<OrderDocument>, siteId: string, orderId: string, items: OrderReturnItem[], direction: 1 | -1) {
  const order = await orderModel.findOne({ _id: Types.ObjectId.isValid(orderId) ? new Types.ObjectId(orderId) : null, siteId }).lean<OrderDocument & { _id: Types.ObjectId }>()
  if (!order) return
  const nextItems = (order.items ?? []).map(item => {
    const match = items.find(line => (line.itemId ?? null) === (item.itemId ?? null) && (line.variantId ?? null) === (item.variantId ?? null))
    if (!match) return item
    return { ...item, returnedQuantity: Math.max(0, (item.returnedQuantity ?? 0) + direction * match.quantity) }
  })
  await orderModel.updateOne({ _id: order._id, siteId }, { $set: { items: nextItems } })
}

export async function createOrderReturn(
  returnModel: Model<OrderReturnDocument>,
  orderModel: Model<OrderDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<OrderReturnAdmin> {
  let draft
  try {
    draft = normalizeOrderReturnInput({ ...(input as Record<string, unknown>), siteId })
  } catch (error) {
    translateInvariant(error)
    throw error
  }

  const order = await loadOrder(orderModel, siteId, draft.orderId)
  await validateReturnLines(order, returnModel, siteId, draft.items)

  const now = new Date()
  let created
  try {
    created = await returnModel.create({
      siteId: draft.siteId,
      code: draft.code,
      orderId: draft.orderId,
      status: draft.status,
      items: draft.items,
      refundAmount: draft.refundAmount,
      refundMethod: draft.refundMethod,
      note: draft.note,
      revision: 1,
      approvedAt: draft.status === 'approved' || draft.status === 'refunded' ? now : null,
      refundedAt: draft.status === 'refunded' ? now : null,
    })
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) {
      throw new OrderReturnServiceError(409, 'ORDER_RETURN_CODE_EXISTS', 'Order return code already exists')
    }
    throw error
  }
  const record = created.toObject() as ReturnRecord

  if (record.status === 'approved' || record.status === 'refunded') {
    await adjustOrderReturned(orderModel, siteId, draft.orderId, draft.items, 1)
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
    changedFields: ['code', 'orderId', 'status', 'items'],
  })

  return toAdmin(record)
}

export async function updateOrderReturn(
  returnModel: Model<OrderReturnDocument>,
  orderModel: Model<OrderDocument>,
  siteId: string,
  id: string,
  input: { status?: string, note?: string, refundAmount?: number, refundMethod?: string, revision: number },
  meta?: { audit?: ContentAuditMeta },
): Promise<OrderReturnAdmin> {
  if (!Number.isInteger(input.revision) || input.revision < 1) {
    throw new OrderReturnServiceError(422, 'ORDER_RETURN_REVISION_REQUIRED', 'Revision is required')
  }
  const record = await returnModel.findOne({ _id: objectId(id, 'ORDER_RETURN_ID_INVALID'), siteId }).lean<ReturnRecord>()
  if (!record) throw new OrderReturnServiceError(404, 'ORDER_RETURN_NOT_FOUND', 'Order return not found')
  if (record.revision !== input.revision) throw new OrderReturnServiceError(409, 'ORDER_RETURN_REVISION_CONFLICT', 'Revision mismatch')

  const set: Record<string, unknown> = {}
  const changed: string[] = []
  const previousStatus = record.status
  let nextStatus = record.status

  if (input.status && ORDER_RETURN_STATUSES.includes(input.status as OrderReturnStatus) && input.status !== record.status) {
    nextStatus = input.status as OrderReturnStatus
    set.status = nextStatus
    changed.push('status')
    if ((nextStatus === 'approved' || nextStatus === 'refunded') && !record.approvedAt) set.approvedAt = new Date()
    if (nextStatus === 'refunded' && !record.refundedAt) set.refundedAt = new Date()
    if (nextStatus === 'cancelled' && !record.cancelledAt) set.cancelledAt = new Date()
  }
  if (input.note !== undefined && input.note !== record.note) {
    set.note = String(input.note).trim().slice(0, 2000)
    changed.push('note')
  }
  if (input.refundAmount !== undefined && input.refundAmount !== record.refundAmount) {
    set.refundAmount = input.refundAmount
    changed.push('refundAmount')
  }
  if (input.refundMethod !== undefined && input.refundMethod !== record.refundMethod) {
    set.refundMethod = input.refundMethod
    changed.push('refundMethod')
  }

  // Adjust order returned quantities on transitions.
  const wasActive = previousStatus === 'approved' || previousStatus === 'refunded'
  const isActive = nextStatus === 'approved' || nextStatus === 'refunded'
  if (nextStatus !== previousStatus) {
    if (!wasActive && isActive) {
      const order = await loadOrder(orderModel, siteId, record.orderId)
      await validateReturnLines(order, returnModel, siteId, record.items, String(record._id))
      await adjustOrderReturned(orderModel, siteId, record.orderId, record.items, 1)
    }
    if (wasActive && !isActive) {
      await adjustOrderReturned(orderModel, siteId, record.orderId, record.items, -1)
    }
  }

  if (changed.length === 0) return toAdmin(record)

  const updated = await returnModel.findOneAndUpdate(
    { _id: record._id, siteId, revision: input.revision },
    { $set: set, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<ReturnRecord>()
  if (!updated) throw new OrderReturnServiceError(409, 'ORDER_RETURN_REVISION_CONFLICT', 'Order return changed; retry')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.code,
    action: 'update',
    revision: updated.revision,
    fromStatus: previousStatus,
    toStatus: updated.status,
    changedFields: changed,
  })

  return toAdmin(updated)
}

export async function cancelOrderReturn(
  returnModel: Model<OrderReturnDocument>,
  orderModel: Model<OrderDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<OrderReturnAdmin> {
  return updateOrderReturn(returnModel, orderModel, siteId, id, { status: 'cancelled', revision }, meta)
}

export async function softDeleteOrderReturn(
  model: Model<OrderReturnDocument>,
  orderModel: Model<OrderDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<OrderReturnAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'ORDER_RETURN_ID_INVALID'), siteId }).lean<ReturnRecord>()
  if (!record) throw new OrderReturnServiceError(404, 'ORDER_RETURN_NOT_FOUND', 'Order return not found')
  if (record.revision !== revision) throw new OrderReturnServiceError(409, 'ORDER_RETURN_REVISION_CONFLICT', 'Revision mismatch')

  if (record.status === 'approved' || record.status === 'refunded') {
    await adjustOrderReturned(orderModel, siteId, record.orderId, record.items, -1)
  }

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<ReturnRecord>()
  if (!updated) throw new OrderReturnServiceError(409, 'ORDER_RETURN_REVISION_CONFLICT', 'Order return changed; retry')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.code,
    action: 'delete',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: record.status,
    changedFields: ['isDeleted'],
  })
  return toAdmin(updated)
}

export async function restoreOrderReturn(
  model: Model<OrderReturnDocument>,
  orderModel: Model<OrderDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<OrderReturnAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'ORDER_RETURN_ID_INVALID'), siteId }).lean<ReturnRecord>()
  if (!record) throw new OrderReturnServiceError(404, 'ORDER_RETURN_NOT_FOUND', 'Order return not found')
  if (record.revision !== revision) throw new OrderReturnServiceError(409, 'ORDER_RETURN_REVISION_CONFLICT', 'Revision mismatch')

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<ReturnRecord>()
  if (!updated) throw new OrderReturnServiceError(409, 'ORDER_RETURN_REVISION_CONFLICT', 'Order return changed; retry')

  if (record.status === 'approved' || record.status === 'refunded') {
    await adjustOrderReturned(orderModel, siteId, record.orderId, record.items, 1)
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.code,
    action: 'restore',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: record.status,
    changedFields: ['isDeleted'],
  })
  return toAdmin(updated)
}
