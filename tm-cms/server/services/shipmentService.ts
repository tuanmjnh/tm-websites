import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { OrderDocument, OrderStatus } from '../models/order'
import type { InventoryDocument } from '../models/inventory'
import type { InventoryTransactionDocument } from '../models/inventoryTransaction'
import type { SerialNumberDocument } from '../models/serialNumber'
import {
  ShipmentInvariantError,
  type ShipmentStatus,
  type ShipmentDocument,
  normalizeShipmentInput,
  SHIPMENT_STATUSES,
} from '../models/shipment'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'
import { recordInventoryTransaction } from './inventoryTransactionService'
import { ORDER_STATUS_TEMPLATE, type OrderStatusMailModels, queueOrderStatusMail } from './orderStatusMail'
import { revertSerialSale } from './serialNumberService'

export class ShipmentServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ShipmentServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

const RESOURCE = 'shipment' as const

type ShipmentRecord = ShipmentDocument & { _id: Types.ObjectId }

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value === 'string' && Types.ObjectId.isValid(value)) return new Types.ObjectId(value)
  throw new ShipmentServiceError(422, code, 'Invalid identifier')
}

function translateInvariant(error: unknown): never {
  if (error instanceof ShipmentInvariantError) {
    throw new ShipmentServiceError(422, error.code, error.message)
  }
  if (error instanceof ShipmentServiceError) throw error
  throw error
}

function toAdmin(record: ShipmentRecord) {
  return {
    id: String(record._id),
    siteId: record.siteId,
    code: record.code,
    orderId: record.orderId,
    status: record.status,
    carrier: record.carrier,
    trackingNumber: record.trackingNumber,
    items: record.items,
    shippingAddress: record.shippingAddress,
    note: record.note,
    shippedAt: record.shippedAt,
    deliveredAt: record.deliveredAt,
    cancelledAt: record.cancelledAt,
    revision: record.revision,
    isDeleted: record.isDeleted,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export interface ShipmentAdmin { id: string, siteId: string, code: string, orderId: string, status: string, carrier: string, trackingNumber: string, items: ShipmentDocument['items'], shippingAddress: Record<string, string>, note: string, shippedAt: Date | null, deliveredAt: Date | null, cancelledAt: Date | null, revision: number, isDeleted: boolean, createdAt: Date, updatedAt: Date }

export async function getShipment(
  model: Model<ShipmentDocument>,
  siteId: string,
  id: string,
): Promise<ShipmentAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'SHIPMENT_ID_INVALID'), siteId }).lean<ShipmentRecord>()
  if (!record) throw new ShipmentServiceError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found')
  return toAdmin(record)
}

export async function listShipments(
  model: Model<ShipmentDocument>,
  siteId: string,
  params: { status?: string, orderId?: string, q?: string, cursor?: string, limit?: number, includeDeleted?: boolean } = {},
) {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 50), 1), 200)
  const filter: Record<string, unknown> = { siteId }
  if (params.status && SHIPMENT_STATUSES.includes(params.status as ShipmentStatus)) filter.status = params.status
  if (params.orderId) filter.orderId = params.orderId
  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.q) {
    const q = params.q.trim()
    if (q) filter.$or = [{ code: { $regex: q, $options: 'i' } }, { trackingNumber: { $regex: q, $options: 'i' } }, { carrier: { $regex: q, $options: 'i' } }]
  }
  if (params.cursor && Types.ObjectId.isValid(params.cursor)) filter._id = { $lt: new Types.ObjectId(params.cursor) }

  const rows = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<ShipmentRecord[]>()
  const hasMore = rows.length > limit
  const data = (hasMore ? rows.slice(0, limit) : rows).map(toAdmin)
  const nextCursor = hasMore ? String(rows[limit - 1]!._id) : null

  const base: Record<string, unknown> = { siteId }
  if (!params.includeDeleted) base.isDeleted = { $ne: true }
  const counts: Record<string, number> = { all: 0 }
  for (const status of SHIPMENT_STATUSES) counts[status] = 0
  const all = await model.countDocuments(base)
  counts.all = all
  for (const status of SHIPMENT_STATUSES) {
    counts[status] = await model.countDocuments({ ...base, status })
  }
  const deleted = params.includeDeleted ? await model.countDocuments({ siteId, isDeleted: true }) : 0
  return { data, nextCursor, hasMore, counts: { ...counts, deleted } }
}

function isShippedStatus(status: string): boolean {
  return status === 'shipped' || status === 'in_transit' || status === 'delivered'
}

/**
 * Best-effort stock movement for a shipped shipment: decrement (export) the
 * inventory balance for each line from the order's warehouse, and record an
 * `export` transaction against the shipment. Reversed with `import` when the
 * shipment is cancelled/deleted. Skips silently when there is no warehouse or
 * no matching balance, so a shipment without tracked stock still succeeds.
 */
async function recordShipmentStockMovement(
  params: {
    inventoryModel: Model<InventoryDocument>
    transactionModel: Model<InventoryTransactionDocument>
    serialNumberModel?: Model<SerialNumberDocument> | null
    siteId: string
    warehouseId: string
    shipmentId: string
    shipmentCode: string
    orderId: string
    orderCode: string
    direction: 'export' | 'import' | 'return_in'
    items: ShipmentDocument['items']
    audit?: ContentAuditMeta
  },
): Promise<void> {
  const type = params.direction === 'export' ? 'export' : params.direction === 'return_in' ? 'return_in' : 'import'
  const sign = params.direction === 'export' ? -1 : 1
  for (const line of params.items) {
    if (!line.itemId) continue
    const balance = await params.inventoryModel
      .findOne({ siteId: params.siteId, itemId: line.itemId, variantId: line.variantId ?? null, warehouseId: params.warehouseId, isDeleted: { $ne: true } })
      .lean<InventoryDocument & { _id: Types.ObjectId }>()
    if (!balance) continue
    await recordInventoryTransaction(
      params.inventoryModel,
      params.transactionModel,
      params.siteId,
      {
        inventoryId: String(balance._id),
        type,
        quantityChange: sign * line.quantity,
        unitCost: 0,
        imeiCodes: line.serials ?? [],
        orderId: params.orderId,
        referenceId: params.shipmentId,
        referenceCode: params.shipmentCode,
        referenceModel: 'Shipment',
        reason: `Shipment ${params.shipmentCode} (${params.direction}) for order ${params.orderCode}`,
      },
      { audit: params.audit, serialNumberModel: params.serialNumberModel ?? undefined },
    )
    // On a reversal (cancel/delete), revert any serials that were marked sold
    // when the shipment shipped, so they return to in_stock.
    if (params.direction === 'import' && params.serialNumberModel && (line.serials?.length ?? 0) > 0) {
      for (const serialStr of line.serials ?? []) {
        const serialRecord = await params.serialNumberModel
          .findOne({ siteId: params.siteId, serial: serialStr, isDeleted: { $ne: true } })
          .lean<{ _id: Types.ObjectId; revision: number }>()
        if (!serialRecord) continue
        await revertSerialSale(params.serialNumberModel, params.siteId, String(serialRecord._id), serialRecord.revision, { audit: params.audit })
      }
    }
  }
}

/**
 * Recompute an order's status from its non-cancelled shipments.
 *
 * Shipped quantity drives the status: nothing shipped keeps the order where it
 * is (unless it had been advanced and the shipments are gone, in which case it
 * returns to `pending`); a partial shipment moves it to `processing`; every
 * line fully shipped moves it to `shipped`, or `completed` when all of those
 * shipments are delivered. Cancelled orders are never touched. The status is
 * only written when it actually changes, with a history entry and an audit row.
 * `notify` carries the mail models, so a move caused by a shipment reaches the
 * customer exactly like one made by hand in the CMS.
 */
async function recomputeOrderStatusFromShipments(
  orderModel: Model<OrderDocument>,
  shipmentModel: Model<ShipmentDocument>,
  siteId: string,
  orderId: string,
  audit?: ContentAuditMeta,
  notify?: OrderStatusMailModels,
): Promise<void> {
  if (!Types.ObjectId.isValid(orderId)) return
  const order = await orderModel
    .findOne({ _id: new Types.ObjectId(orderId), siteId, isDeleted: { $ne: true } })
    .lean<OrderDocument & { _id: Types.ObjectId }>()
  if (!order || order.status === 'cancelled') return

  const shipments = await shipmentModel
    .find({ siteId, orderId, isDeleted: { $ne: true }, status: { $in: ['shipped', 'in_transit', 'delivered'] } })
    .lean<ShipmentRecord[]>()

  const shippedByKey = new Map<string, { shipped: number; delivered: number }>()
  for (const shipment of shipments) {
    const isDelivered = shipment.status === 'delivered'
    for (const line of shipment.items ?? []) {
      const key = `${line.itemId ?? ''}::${line.variantId ?? ''}`
      const current = shippedByKey.get(key) ?? { shipped: 0, delivered: 0 }
      current.shipped += line.quantity ?? 0
      if (isDelivered) current.delivered += line.quantity ?? 0
      shippedByKey.set(key, current)
    }
  }

  let hasShippableLine = false
  let allShipped = true
  let allDelivered = true
  let anyShipped = false
  for (const item of order.items ?? []) {
    const target = (item.quantity ?? 0) - (item.returnedQuantity ?? 0)
    if (target <= 0) continue
    hasShippableLine = true
    const stats = shippedByKey.get(`${item.itemId ?? ''}::${item.variantId ?? ''}`) ?? { shipped: 0, delivered: 0 }
    if (stats.shipped < target) allShipped = false
    if (stats.delivered < target) allDelivered = false
    if (stats.shipped > 0) anyShipped = true
  }

  let newStatus: OrderStatus = order.status
  if (!hasShippableLine) {
    // nothing to ship; leave the order alone
  } else if (shipments.length === 0) {
    if (order.status === 'shipped' || order.status === 'completed') newStatus = 'pending'
  } else if (allShipped && anyShipped) {
    newStatus = allDelivered ? 'completed' : 'shipped'
  } else if (anyShipped) {
    newStatus = 'processing'
  }

  if (newStatus === order.status) return

  const updated = await orderModel
    .findOneAndUpdate(
      { _id: order._id, siteId, revision: order.revision },
      {
        $set: { status: newStatus },
        $push: { history: { status: newStatus, at: new Date().toISOString(), note: 'Auto-updated from shipment fulfillment', actorId: '' } },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    )
    .lean<OrderDocument & { _id: Types.ObjectId }>()

  if (!updated) return

  await recordContentAudit(audit, {
    siteId,
    resourceType: 'order',
    resourceId: String(updated._id),
    resourceKey: updated.code,
    action: 'update',
    revision: updated.revision,
    fromStatus: order.status,
    toStatus: updated.status,
    changedFields: ['status'],
  })

  // A shipment moved the order, so tell the customer. Best-effort: the order is
  // already saved and audited, and a missing address or template must not undo
  // the recompute.
  if (notify) {
    try {
      const queued = await queueOrderStatusMail(notify, siteId, updated)
      if (!queued) console.warn(`[order-status] no ${ORDER_STATUS_TEMPLATE} mail for ${updated.code}`)
    } catch (error) {
      console.warn(`[order-status] mail failed for ${updated.code}: ${(error as Error).message}`)
    }
  }
}

export async function createShipment(
  shipmentModel: Model<ShipmentDocument>,
  orderModel: Model<OrderDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta; serialNumberModel?: Model<SerialNumberDocument> | null; notify?: OrderStatusMailModels },
  inventoryModel?: Model<InventoryDocument> | null,
  transactionModel?: Model<InventoryTransactionDocument> | null,
): Promise<ShipmentAdmin> {
  let draft
  try {
    draft = normalizeShipmentInput({ ...(input as Record<string, unknown>), siteId })
  } catch (error) {
    translateInvariant(error)
    throw error
  }

  const order = await orderModel.findOne({ _id: Types.ObjectId.isValid(draft.orderId) ? new Types.ObjectId(draft.orderId) : null, siteId, isDeleted: { $ne: true } }).lean<OrderDocument & { _id: Types.ObjectId }>()
  if (!order) throw new ShipmentServiceError(404, 'SHIPMENT_ORDER_NOT_FOUND', 'Order not found')

  // Validate quantities against the order and already-shipped units.
  const alreadyShipped = new Map<string, number>()
  const existing = await shipmentModel.find({ siteId, orderId: draft.orderId, isDeleted: { $ne: true }, status: { $ne: 'cancelled' } }).lean<ShipmentRecord[]>()
  for (const shipment of existing) {
    for (const line of shipment.items ?? []) {
      const key = `${line.itemId ?? ''}::${line.variantId ?? ''}`
      alreadyShipped.set(key, (alreadyShipped.get(key) ?? 0) + (line.quantity ?? 0))
    }
  }

  for (const line of draft.items) {
    const orderItem = (order.items ?? []).find(item =>
      (item.itemId ?? null) === (line.itemId ?? null)
      && (item.variantId ?? null) === (line.variantId ?? null))
    if (!orderItem) {
      throw new ShipmentServiceError(422, 'SHIPMENT_ITEM_NOT_IN_ORDER', 'Shipment line does not match an order line', { sku: line.sku })
    }
    const key = `${line.itemId ?? ''}::${line.variantId ?? ''}`
    const shipped = alreadyShipped.get(key) ?? 0
    const remaining = orderItem.quantity - (orderItem.returnedQuantity ?? 0) - shipped
    if (line.quantity > remaining) {
      throw new ShipmentServiceError(422, 'SHIPMENT_QUANTITY_EXCEEDS_REMAINING', 'Shipment quantity exceeds what remains to ship', { sku: line.sku, remaining })
    }
  }

  let created
  try {
    created = await shipmentModel.create({
      siteId: draft.siteId,
      code: draft.code,
      orderId: draft.orderId,
      status: draft.status,
      carrier: draft.carrier,
      trackingNumber: draft.trackingNumber,
      items: draft.items,
      shippingAddress: draft.shippingAddress,
      note: draft.note,
      revision: 1,
    })
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) {
      throw new ShipmentServiceError(409, 'SHIPMENT_CODE_EXISTS', 'Shipment code already exists')
    }
    throw error
  }
  const record = created.toObject() as ShipmentRecord

  if (draft.status === 'shipped' || draft.status === 'in_transit' || draft.status === 'delivered') {
    record.shippedAt = record.shippedAt ?? new Date()
  }
  if (draft.status === 'delivered') record.deliveredAt = record.deliveredAt ?? new Date()

  // Order-driven stock movement: a shipped shipment decrements inventory.
  if (inventoryModel && transactionModel && order.warehouseId && isShippedStatus(draft.status)) {
    await recordShipmentStockMovement({
      inventoryModel,
      transactionModel,
      serialNumberModel: meta?.serialNumberModel ?? null,
      siteId,
      warehouseId: order.warehouseId,
      shipmentId: String(record._id),
      shipmentCode: record.code,
      orderId: String(order._id),
      orderCode: order.code,
      direction: 'export',
      items: draft.items,
      audit: meta?.audit,
    })
  }

  // Keep the order's status in step with its shipments.
  await recomputeOrderStatusFromShipments(orderModel, shipmentModel, siteId, String(order._id), meta?.audit, meta?.notify)

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


export async function updateShipment(
  model: Model<ShipmentDocument>,
  siteId: string,
  id: string,
  input: { status?: string, carrier?: string, trackingNumber?: string, note?: string, revision: number },
  meta?: { audit?: ContentAuditMeta; serialNumberModel?: Model<SerialNumberDocument> | null; notify?: OrderStatusMailModels },
  inventoryModel?: Model<InventoryDocument> | null,
  transactionModel?: Model<InventoryTransactionDocument> | null,
  orderModel?: Model<OrderDocument> | null,
): Promise<ShipmentAdmin> {
  if (!Number.isInteger(input.revision) || input.revision < 1) {
    throw new ShipmentServiceError(422, 'SHIPMENT_REVISION_REQUIRED', 'Revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'SHIPMENT_ID_INVALID'), siteId }).lean<ShipmentRecord>()
  if (!record) throw new ShipmentServiceError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found')
  if (record.revision !== input.revision) throw new ShipmentServiceError(409, 'SHIPMENT_REVISION_CONFLICT', 'Revision mismatch')

  const set: Record<string, unknown> = {}
  const changed: string[] = []
  if (input.status && SHIPMENT_STATUSES.includes(input.status as ShipmentStatus) && input.status !== record.status) {
    const nextStatus = input.status as ShipmentStatus
    set.status = nextStatus
    changed.push('status')
    if ((nextStatus === 'shipped' || nextStatus === 'in_transit' || nextStatus === 'delivered') && !record.shippedAt) set.shippedAt = new Date()
    if (nextStatus === 'delivered' && !record.deliveredAt) set.deliveredAt = new Date()
    if (nextStatus === 'cancelled' && !record.cancelledAt) set.cancelledAt = new Date()
  }
  if (input.carrier !== undefined && input.carrier !== record.carrier) {
    set.carrier = String(input.carrier).trim().slice(0, 120)
    changed.push('carrier')
  }
  if (input.trackingNumber !== undefined && input.trackingNumber !== record.trackingNumber) {
    set.trackingNumber = String(input.trackingNumber).trim().slice(0, 200)
    changed.push('trackingNumber')
  }
  if (input.note !== undefined && input.note !== record.note) {
    set.note = String(input.note).trim().slice(0, 2000)
    changed.push('note')
  }
  if (changed.length === 0) return toAdmin(record)

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision: input.revision },
    { $set: set, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<ShipmentRecord>()
  if (!updated) throw new ShipmentServiceError(409, 'SHIPMENT_REVISION_CONFLICT', 'Shipment changed; retry')

  // Order-driven stock movement on status transition.
  if (inventoryModel && transactionModel && orderModel && record.status !== updated.status) {
    const wasShipped = isShippedStatus(record.status)
    const isNowShipped = isShippedStatus(updated.status)
    const order = await orderModel.findOne({ _id: Types.ObjectId.isValid(updated.orderId) ? new Types.ObjectId(updated.orderId) : null, siteId }).lean<OrderDocument & { _id: Types.ObjectId }>()
    if (order?.warehouseId) {
      if (!wasShipped && isNowShipped) {
        await recordShipmentStockMovement({
          inventoryModel,
          transactionModel,
          serialNumberModel: meta?.serialNumberModel ?? null,
          siteId,
          warehouseId: order.warehouseId,
          shipmentId: String(updated._id),
          shipmentCode: updated.code,
          orderId: String(order._id),
          orderCode: order.code,
          direction: 'export',
          items: updated.items,
          audit: meta?.audit,
        })
      } else if (wasShipped && !isNowShipped && (updated.status === 'cancelled' || updated.status === 'returned')) {
        await recordShipmentStockMovement({
          inventoryModel,
          transactionModel,
          serialNumberModel: meta?.serialNumberModel ?? null,
          siteId,
          warehouseId: order.warehouseId,
          shipmentId: String(updated._id),
          shipmentCode: updated.code,
          orderId: String(order._id),
          orderCode: order.code,
          direction: updated.status === 'returned' ? 'return_in' : 'import',
          items: updated.items,
          audit: meta?.audit,
        })
      }
    }
  }

  // Keep the order's status in step with its shipments.
  if (orderModel && record.status !== updated.status) {
    await recomputeOrderStatusFromShipments(orderModel, model, siteId, updated.orderId, meta?.audit, meta?.notify)
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
    changedFields: changed,
  })

  return toAdmin(updated)
}

export async function cancelShipment(
  model: Model<ShipmentDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta; notify?: OrderStatusMailModels },
): Promise<ShipmentAdmin> {
  return updateShipment(model, siteId, id, { status: 'cancelled', revision }, meta)
}

export async function softDeleteShipment(
  model: Model<ShipmentDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta; serialNumberModel?: Model<SerialNumberDocument> | null; notify?: OrderStatusMailModels },
  inventoryModel?: Model<InventoryDocument> | null,
  transactionModel?: Model<InventoryTransactionDocument> | null,
  orderModel?: Model<OrderDocument> | null,
): Promise<ShipmentAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'SHIPMENT_ID_INVALID'), siteId }).lean<ShipmentRecord>()
  if (!record) throw new ShipmentServiceError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found')
  if (record.revision !== revision) throw new ShipmentServiceError(409, 'SHIPMENT_REVISION_CONFLICT', 'Revision mismatch')
  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<ShipmentRecord>()
  if (!updated) throw new ShipmentServiceError(409, 'SHIPMENT_REVISION_CONFLICT', 'Shipment changed; retry')

  if (inventoryModel && transactionModel && orderModel && isShippedStatus(record.status)) {
    const order = await orderModel.findOne({ _id: Types.ObjectId.isValid(record.orderId) ? new Types.ObjectId(record.orderId) : null, siteId }).lean<OrderDocument & { _id: Types.ObjectId }>()
    if (order?.warehouseId) {
      await recordShipmentStockMovement({
        inventoryModel,
        transactionModel,
        serialNumberModel: meta?.serialNumberModel ?? null,
        siteId,
        warehouseId: order.warehouseId,
        shipmentId: String(record._id),
        shipmentCode: record.code,
        orderId: String(order._id),
        orderCode: order.code,
        direction: 'import',
        items: record.items,
        audit: meta?.audit,
      })
    }
  }

  // Keep the order's status in step with its shipments.
  if (orderModel) {
    await recomputeOrderStatusFromShipments(orderModel, model, siteId, record.orderId, meta?.audit, meta?.notify)
  }

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

export async function restoreShipment(
  model: Model<ShipmentDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<ShipmentAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'SHIPMENT_ID_INVALID'), siteId }).lean<ShipmentRecord>()
  if (!record) throw new ShipmentServiceError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found')
  if (record.revision !== revision) throw new ShipmentServiceError(409, 'SHIPMENT_REVISION_CONFLICT', 'Revision mismatch')
  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<ShipmentRecord>()
  if (!updated) throw new ShipmentServiceError(409, 'SHIPMENT_REVISION_CONFLICT', 'Shipment changed; retry')
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
