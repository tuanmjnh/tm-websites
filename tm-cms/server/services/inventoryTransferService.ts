import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  InventoryTransferInvariantError,
  type InventoryTransferDocument,
  type InventoryTransferLine,
  normalizeInventoryTransferInput,
} from '../models/inventoryTransfer'
import type { WarehouseDocument } from '../models/warehouse'
import type { InventoryDocument } from '../models/inventory'
import type { InventoryTransactionDocument } from '../models/inventoryTransaction'
import type { SerialNumberDocument } from '../models/serialNumber'
import { createInventory } from './inventoryService'
import { recordInventoryTransaction } from './inventoryTransactionService'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class InventoryTransferServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'InventoryTransferServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type InventoryTransferRecord = InventoryTransferDocument & { _id: Types.ObjectId }

export interface InventoryTransferAdmin {
  id: string
  siteId: string
  code: string
  fromWarehouseId: string
  toWarehouseId: string
  status: string
  lines: InventoryTransferLine[]
  note: string
  shippedAt: string | null
  receivedAt: string | null
  cancelledAt: string | null
  cancelReason: string
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface InventoryTransferListParams {
  q?: string
  status?: string | null
  warehouseId?: string | null
  includeDeleted?: boolean
  cursor?: string | null
  limit?: number
}

export interface InventoryTransferListResult {
  data: InventoryTransferAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number; draft: number; inTransit: number; received: number; cancelled: number }
}

const RESOURCE = 'inventory_transfer'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const SEARCH_MAX = 80

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new InventoryTransferServiceError(422, code, 'Id is not valid')
  }
  return new Types.ObjectId(value)
}

function generatedCode(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `TRF-${yy}${mm}${dd}-${new Types.ObjectId().toHexString().slice(-6).toUpperCase()}`
}

function lineKey(itemId: string | null, variantId: string | null): string {
  return `${itemId ?? '-'}:${variantId ?? '-'}`
}

export function toAdminInventoryTransfer(record: InventoryTransferRecord): InventoryTransferAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    code: record.code,
    fromWarehouseId: String(record.fromWarehouseId),
    toWarehouseId: String(record.toWarehouseId),
    status: record.status ?? 'draft',
    lines: (record.lines ?? []).map(line => ({
      itemId: line.itemId,
      variantId: line.variantId ?? null,
      sku: line.sku ?? '',
      itemName: line.itemName ?? '',
      quantity: line.quantity,
      receivedQuantity: line.receivedQuantity ?? 0,
      serials: Array.isArray(line.serials) ? line.serials : [],
    })),
    note: record.note ?? '',
    shippedAt: iso(record.shippedAt),
    receivedAt: iso(record.receivedAt),
    cancelledAt: iso(record.cancelledAt),
    cancelReason: record.cancelReason ?? '',
    isDeleted: record.isDeleted === true,
    deletedAt: iso(record.deletedAt),
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

export async function listInventoryTransfers(
  model: Model<InventoryTransferDocument>,
  siteId: string,
  params: InventoryTransferListParams = {},
): Promise<InventoryTransferListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }

  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.status) filter.status = params.status
  if (params.warehouseId) {
    const warehouse = objectId(params.warehouseId, 'INVENTORY_TRANSFER_WAREHOUSE_ID_INVALID')
    filter.$or = [{ fromWarehouseId: warehouse }, { toWarehouseId: warehouse }]
  }

  const search = (params.q ?? '').trim().slice(0, SEARCH_MAX)
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i')
    const searchClause = [{ code: pattern }, { note: pattern }, { 'lines.sku': pattern }, { 'lines.itemName': pattern }]
    filter.$and = [{ $or: searchClause }, ...(filter.$or ? [{ $or: filter.$or }] : [])]
    delete filter.$or
  }

  if (params.cursor) filter._id = { $lt: objectId(params.cursor, 'INVENTORY_TRANSFER_CURSOR_INVALID') }

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<InventoryTransferRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  const [all, draft, inTransit, received, cancelled] = await Promise.all([
    model.countDocuments({ siteId, ...(params.includeDeleted ? {} : { isDeleted: { $ne: true } }) }),
    model.countDocuments({ siteId, status: 'draft' }),
    model.countDocuments({ siteId, status: 'in_transit' }),
    model.countDocuments({ siteId, status: 'received' }),
    model.countDocuments({ siteId, status: 'cancelled' }),
  ])

  return {
    data: page.map(toAdminInventoryTransfer),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts: { all, draft, inTransit, received, cancelled },
  }
}

export async function getInventoryTransfer(
  model: Model<InventoryTransferDocument>,
  siteId: string,
  id: string,
): Promise<InventoryTransferAdmin> {
  const record = await model
    .findOne({ _id: objectId(id, 'INVENTORY_TRANSFER_ID_INVALID'), siteId })
    .lean<InventoryTransferRecord>()
  if (!record) throw new InventoryTransferServiceError(404, 'INVENTORY_TRANSFER_NOT_FOUND', 'Transfer not found')
  return toAdminInventoryTransfer(record)
}

async function loadWarehouse(
  model: Model<WarehouseDocument>,
  siteId: string,
  id: string,
  label: string,
): Promise<WarehouseDocument & { _id: Types.ObjectId }> {
  const record = await model
    .findOne({ _id: objectId(id, 'INVENTORY_TRANSFER_WAREHOUSE_ID_INVALID'), siteId })
    .lean<WarehouseDocument & { _id: Types.ObjectId } | null>()
  if (!record) {
    throw new InventoryTransferServiceError(404, 'INVENTORY_TRANSFER_WAREHOUSE_NOT_FOUND', `${label} warehouse was not found`, { id })
  }
  if (record.isDeleted) {
    throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_WAREHOUSE_DELETED', `${label} warehouse is deleted`, { id })
  }
  if (record.status !== 'active') {
    throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_WAREHOUSE_INACTIVE', `${label} warehouse is inactive`, { id })
  }
  return record
}

function translateInvariant(error: unknown): never {
  if (error instanceof InventoryTransferInvariantError) {
    throw new InventoryTransferServiceError(422, error.code, error.message)
  }
  throw error
}

export async function createInventoryTransfer(
  model: Model<InventoryTransferDocument>,
  warehouseModel: Model<WarehouseDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<InventoryTransferAdmin> {
  const source = (input ?? {}) as Record<string, unknown>
  const draft = (() => {
    try {
      return normalizeInventoryTransferInput({ ...source, code: source.code || generatedCode() })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  if (draft.fromWarehouseId === draft.toWarehouseId) {
    throw new InventoryTransferServiceError(422, 'INVENTORY_TRANSFER_SAME_WAREHOUSE', 'A transfer needs two different warehouses')
  }

  await loadWarehouse(warehouseModel, siteId, draft.fromWarehouseId, 'Source')
  await loadWarehouse(warehouseModel, siteId, draft.toWarehouseId, 'Destination')

  const seen = new Set<string>()
  for (const line of draft.lines) {
    const key = lineKey(line.itemId, line.variantId)
    if (seen.has(key)) {
      throw new InventoryTransferServiceError(422, 'INVENTORY_TRANSFER_DUPLICATE_LINE', 'The same item appears twice in one transfer', { key })
    }
    seen.add(key)
  }

  let created
  try {
    created = await model.create({
      ...draft,
      siteId,
      fromWarehouseId: new Types.ObjectId(draft.fromWarehouseId),
      toWarehouseId: new Types.ObjectId(draft.toWarehouseId),
      status: 'draft',
      lines: draft.lines.map(line => ({ ...line, receivedQuantity: 0 })),
      revision: 1,
    })
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_CODE_EXISTS', 'Another transfer already uses this code')
    }
    throw error
  }

  const record = created.toObject() as InventoryTransferRecord

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: 'draft',
    changedFields: ['lines', 'fromWarehouseId', 'toWarehouseId'],
  })

  return toAdminInventoryTransfer(record)
}

/** Move one line through the ledger; the caller decides the direction. */
async function moveLine(
  inventoryModel: Model<InventoryDocument>,
  transactionModel: Model<InventoryTransactionDocument>,
  serialNumberModel: Model<SerialNumberDocument> | null,
  siteId: string,
  transfer: InventoryTransferRecord,
  line: InventoryTransferLine,
  warehouseId: Types.ObjectId,
  quantity: number,
  type: 'transfer_out' | 'transfer_in' | 'return_in',
): Promise<void> {
  await recordInventoryTransaction(inventoryModel, transactionModel, siteId, {
    itemId: line.itemId,
    variantId: line.variantId ?? null,
    warehouseId: String(warehouseId),
    type,
    targetWarehouseId: type === 'transfer_out' ? String(transfer.toWarehouseId) : undefined,
    quantityChange: quantity,
    unitCost: 0,
    imeiCodes: Array.isArray(line.serials) ? line.serials : [],
    referenceModel: 'InventoryTransfer',
    referenceId: String(transfer._id),
    referenceCode: transfer.code,
    reason: `${type === 'transfer_out' ? 'Xuất chuyển kho' : 'Nhập chuyển kho'} ${transfer.code}`,
  }, serialNumberModel ? { serialNumberModel } : undefined)
}

/**
 * Create the destination balance when a warehouse has never held the item, so a
 * transfer is not blocked by a missing zero row.
 */
async function ensureBalance(
  inventoryModel: Model<InventoryDocument>,
  warehouseModel: Model<WarehouseDocument>,
  siteId: string,
  line: InventoryTransferLine,
  warehouseId: Types.ObjectId,
): Promise<void> {
  const existing = await inventoryModel
    .findOne({ siteId, itemId: line.itemId, variantId: line.variantId ?? null, warehouseId: String(warehouseId) })
    .lean<InventoryDocument | null>()
  if (existing) return

  try {
    await createInventory(inventoryModel, warehouseModel, siteId, {
      itemId: line.itemId,
      variantId: line.variantId ?? null,
      warehouseId: String(warehouseId),
      sku: line.sku,
      quantityOnHand: 0,
    })
  } catch (error) {
    // A parallel writer may have created it between the read and the insert.
    const raced = await inventoryModel
      .findOne({ siteId, itemId: line.itemId, variantId: line.variantId ?? null, warehouseId: String(warehouseId) })
      .lean<InventoryDocument | null>()
    if (!raced) throw error
  }
}

export async function shipInventoryTransfer(
  model: Model<InventoryTransferDocument>,
  inventoryModel: Model<InventoryDocument>,
  transactionModel: Model<InventoryTransactionDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta; serialNumberModel?: Model<SerialNumberDocument> },
): Promise<InventoryTransferAdmin> {
  const body = (input ?? {}) as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new InventoryTransferServiceError(422, 'INVENTORY_TRANSFER_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model
    .findOne({ _id: objectId(id, 'INVENTORY_TRANSFER_ID_INVALID'), siteId })
    .lean<InventoryTransferRecord>()
  if (!record) throw new InventoryTransferServiceError(404, 'INVENTORY_TRANSFER_NOT_FOUND', 'Transfer not found')
  if (record.isDeleted) throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_DELETED', 'Transfer is deleted')
  if (record.status !== 'draft') {
    throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_NOT_DRAFT', `Transfer is ${record.status}; only a draft can be shipped`)
  }

  const moved: InventoryTransferLine[] = []
  try {
    for (const line of record.lines ?? []) {
      await moveLine(inventoryModel, transactionModel, meta?.serialNumberModel ?? null, siteId, record, line, record.fromWarehouseId, -line.quantity, 'transfer_out')
      moved.push(line)
    }
  } catch (error) {
    // Put back what already left, so a refused line cannot strand stock in transit.
    for (const line of moved) {
      await moveLine(inventoryModel, transactionModel, meta?.serialNumberModel ?? null, siteId, record, line, record.fromWarehouseId, line.quantity, 'return_in')
        .catch(() => undefined)
    }
    throw new InventoryTransferServiceError(422, 'INVENTORY_TRANSFER_STOCK_FAILED', 'The source warehouse could not release every line', {
      cause: (error as Error).message,
    })
  }

  const shipped = await model
    .findOneAndUpdate(
      { _id: record._id, siteId, revision, status: 'draft' },
      { $set: { status: 'in_transit', shippedAt: new Date() }, $inc: { revision: 1 } },
      { returnDocument: 'after' },
    )
    .lean<InventoryTransferRecord | null>()

  if (!shipped) {
    throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_REVISION_CONFLICT', 'Transfer was changed by someone else; reload before shipping', { expected: revision })
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(shipped._id),
    resourceKey: shipped.code,
    action: 'update',
    revision: shipped.revision,
    fromStatus: 'draft',
    toStatus: 'in_transit',
    changedFields: ['status', 'shippedAt'],
  })

  return toAdminInventoryTransfer(shipped)
}

export async function receiveInventoryTransfer(
  model: Model<InventoryTransferDocument>,
  warehouseModel: Model<WarehouseDocument>,
  inventoryModel: Model<InventoryDocument>,
  transactionModel: Model<InventoryTransactionDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta; serialNumberModel?: Model<SerialNumberDocument> },
): Promise<InventoryTransferAdmin> {
  const body = (input ?? {}) as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new InventoryTransferServiceError(422, 'INVENTORY_TRANSFER_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model
    .findOne({ _id: objectId(id, 'INVENTORY_TRANSFER_ID_INVALID'), siteId })
    .lean<InventoryTransferRecord>()
  if (!record) throw new InventoryTransferServiceError(404, 'INVENTORY_TRANSFER_NOT_FOUND', 'Transfer not found')
  if (record.isDeleted) throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_DELETED', 'Transfer is deleted')
  if (record.status !== 'in_transit') {
    throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_NOT_IN_TRANSIT', `Transfer is ${record.status}; only a shipped transfer can be received`)
  }

  const lines = (record.lines ?? []).map(line => ({ ...line, receivedQuantity: line.receivedQuantity ?? 0 }))
  const requested = Array.isArray(body.lines) ? body.lines : null
  if (!requested) {
    throw new InventoryTransferServiceError(422, 'INVENTORY_TRANSFER_RECEIPT_INVALID', 'A receipt needs one line per received item')
  }

  const received: { line: InventoryTransferLine; delta: number }[] = []
  for (const raw of requested) {
    const entry = raw as Record<string, unknown>
    const key = lineKey(typeof entry.itemId === 'string' ? entry.itemId : null, entry.variantId == null ? null : String(entry.variantId))
    const target = lines.find(line => lineKey(line.itemId, line.variantId ?? null) === key)
    if (!target) {
      throw new InventoryTransferServiceError(422, 'INVENTORY_TRANSFER_RECEIPT_LINE_UNKNOWN', 'The receipt names a line the transfer does not contain', { key })
    }
    const amount = Number(entry.receivedQuantity)
    if (!Number.isInteger(amount) || amount < 0) {
      throw new InventoryTransferServiceError(422, 'INVENTORY_TRANSFER_RECEIPT_INVALID', 'Received quantities must be non-negative integers')
    }
    if (amount > target.quantity) {
      throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_RECEIPT_EXCEEDS_TRANSFER', 'Received quantity cannot exceed the shipped quantity', {
        key,
        shipped: target.quantity,
        received: amount,
      })
    }
    if (amount < target.receivedQuantity) {
      throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_RECEIPT_REGRESSION', 'A receipt total cannot be lowered', { key })
    }
    const delta = amount - target.receivedQuantity
    target.receivedQuantity = amount
    if (delta > 0) received.push({ line: target, delta })
  }

  for (const entry of received) {
    await ensureBalance(inventoryModel, warehouseModel, siteId, entry.line, record.toWarehouseId)
    await moveLine(inventoryModel, transactionModel, meta?.serialNumberModel ?? null, siteId, record, entry.line, record.toWarehouseId, entry.delta, 'transfer_in')
  }

  const complete = lines.every(line => line.receivedQuantity >= line.quantity)
  const updated = await model
    .findOneAndUpdate(
      { _id: record._id, siteId, revision, status: 'in_transit' },
      {
        $set: {
          lines,
          status: complete ? 'received' : 'in_transit',
          receivedAt: complete ? new Date() : record.receivedAt ?? null,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    )
    .lean<InventoryTransferRecord | null>()

  if (!updated) {
    throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_REVISION_CONFLICT', 'Transfer was changed by someone else; reload before receiving', { expected: revision })
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.code,
    action: 'update',
    revision: updated.revision,
    fromStatus: 'in_transit',
    toStatus: updated.status,
    changedFields: ['lines', 'status'],
  })

  return toAdminInventoryTransfer(updated)
}

export async function cancelInventoryTransfer(
  model: Model<InventoryTransferDocument>,
  inventoryModel: Model<InventoryDocument>,
  transactionModel: Model<InventoryTransactionDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta; serialNumberModel?: Model<SerialNumberDocument> },
): Promise<InventoryTransferAdmin> {
  const body = (input ?? {}) as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new InventoryTransferServiceError(422, 'INVENTORY_TRANSFER_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model
    .findOne({ _id: objectId(id, 'INVENTORY_TRANSFER_ID_INVALID'), siteId })
    .lean<InventoryTransferRecord>()
  if (!record) throw new InventoryTransferServiceError(404, 'INVENTORY_TRANSFER_NOT_FOUND', 'Transfer not found')
  if (record.isDeleted) throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_DELETED', 'Transfer is deleted')
  if (record.status === 'cancelled') {
    throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_ALREADY_CANCELLED', 'Transfer is already cancelled')
  }
  if (record.status === 'received') {
    throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_ALREADY_RECEIVED', 'A received transfer cannot be cancelled; move the stock back instead')
  }

  if (record.status === 'in_transit') {
    // Whatever has not reached the destination goes back to the source.
    for (const line of record.lines ?? []) {
      const remaining = line.quantity - (line.receivedQuantity ?? 0)
      if (remaining <= 0) continue
      await moveLine(inventoryModel, transactionModel, meta?.serialNumberModel ?? null, siteId, record, line, record.fromWarehouseId, remaining, 'return_in')
    }
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : ''
  const cancelled = await model
    .findOneAndUpdate(
      { _id: record._id, siteId, revision, status: record.status },
      {
        $set: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    )
    .lean<InventoryTransferRecord | null>()

  if (!cancelled) {
    throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_REVISION_CONFLICT', 'Transfer was changed by someone else; reload before cancelling', { expected: revision })
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(cancelled._id),
    resourceKey: cancelled.code,
    action: 'update',
    revision: cancelled.revision,
    fromStatus: record.status,
    toStatus: 'cancelled',
    changedFields: ['status', 'cancelReason'],
  })

  return toAdminInventoryTransfer(cancelled)
}

export async function softDeleteInventoryTransfer(
  model: Model<InventoryTransferDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<InventoryTransferAdmin> {
  const record = await model
    .findOne({ _id: objectId(id, 'INVENTORY_TRANSFER_ID_INVALID'), siteId })
    .lean<InventoryTransferRecord>()
  if (!record) throw new InventoryTransferServiceError(404, 'INVENTORY_TRANSFER_NOT_FOUND', 'Transfer not found')
  if (record.status === 'in_transit') {
    throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_IN_FLIGHT', 'A shipped transfer cannot be hidden; receive or cancel it first')
  }

  const removed = await model
    .findOneAndUpdate(
      { _id: record._id, siteId, revision, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
      { returnDocument: 'after' },
    )
    .lean<InventoryTransferRecord | null>()

  if (!removed) {
    throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_REVISION_CONFLICT', 'Transfer was changed by someone else; reload before hiding', { expected: revision })
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(removed._id),
    resourceKey: removed.code,
    action: 'delete',
    revision: removed.revision,
    fromStatus: removed.status,
    toStatus: removed.status,
    changedFields: ['isDeleted'],
  })

  return toAdminInventoryTransfer(removed)
}

export async function restoreInventoryTransfer(
  model: Model<InventoryTransferDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<InventoryTransferAdmin> {
  const restored = await model
    .findOneAndUpdate(
      { _id: objectId(id, 'INVENTORY_TRANSFER_ID_INVALID'), siteId, revision, isDeleted: true },
      { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
      { returnDocument: 'after' },
    )
    .lean<InventoryTransferRecord | null>()

  if (!restored) {
    const existing = await model
      .findOne({ _id: objectId(id, 'INVENTORY_TRANSFER_ID_INVALID'), siteId })
      .lean<InventoryTransferRecord>()
    if (!existing) throw new InventoryTransferServiceError(404, 'INVENTORY_TRANSFER_NOT_FOUND', 'Transfer not found')
    throw new InventoryTransferServiceError(409, 'INVENTORY_TRANSFER_REVISION_CONFLICT', 'Transfer was changed by someone else; reload before restoring', { expected: revision })
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(restored._id),
    resourceKey: restored.code,
    action: 'restore',
    revision: restored.revision,
    fromStatus: restored.status,
    toStatus: restored.status,
    changedFields: ['isDeleted'],
  })

  return toAdminInventoryTransfer(restored)
}
