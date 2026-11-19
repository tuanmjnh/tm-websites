import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { WarehouseDocument } from '../models/warehouse'
import {
  InventoryInvariantError,
  type InventoryDocument,
  normalizeInventoryInput,
} from '../models/inventory'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'
import { recordInventoryTransaction } from './inventoryTransactionService'
import type { InventoryTransactionDocument } from '../models/inventoryTransaction'

export class InventoryServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'InventoryServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type InventoryRecord = InventoryDocument & { _id: Types.ObjectId }

export interface InventoryAdmin {
  id: string
  siteId: string
  itemId: string
  variantId: string | null
  warehouseId: string
  sku: string
  quantityOnHand: number
  quantityReserved: number
  quantityAvailable: number
  binLocation: string
  lowStockThreshold: number
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface InventoryListParams {
  q?: string
  warehouseId?: string | null
  itemId?: string | null
  includeDeleted?: boolean
  cursor?: string | null
  limit?: number
}

export interface InventoryListResult {
  data: InventoryAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number; lowStock: number; deleted: number }
}

const RESOURCE = 'inventory'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const SEARCH_MAX = 80

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')
}

export function toAdminInventory(record: InventoryRecord): InventoryAdmin {
  const onHand = record.quantityOnHand ?? 0
  const reserved = record.quantityReserved ?? 0
  return {
    id: String(record._id),
    siteId: record.siteId,
    itemId: record.itemId,
    variantId: record.variantId ?? null,
    warehouseId: record.warehouseId,
    sku: record.sku ?? '',
    quantityOnHand: onHand,
    quantityReserved: reserved,
    quantityAvailable: Math.max(0, onHand - reserved),
    binLocation: record.binLocation ?? '',
    lowStockThreshold: record.lowStockThreshold ?? 0,
    isDeleted: record.isDeleted === true,
    deletedAt: iso(record.deletedAt),
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new InventoryServiceError(422, code, 'Inventory id is not valid')
  }
  return new Types.ObjectId(value)
}

function translateInvariant(error: unknown): never {
  if (error instanceof InventoryInvariantError) {
    throw new InventoryServiceError(422, error.code, error.message)
  }
  throw error
}

function translateWriteError(error: unknown): never {
  const duplicate = error as { code?: number; keyPattern?: Record<string, unknown> }
  if (duplicate?.code === 11000) {
    throw new InventoryServiceError(409, 'INVENTORY_BALANCE_EXISTS', 'An inventory balance already exists for this item, variant and warehouse')
  }
  throw error
}

async function assertWarehouseAllowed(
  warehouseModel: Model<WarehouseDocument> | null,
  siteId: string,
  warehouseId: string,
): Promise<void> {
  if (!warehouseModel) return
  if (!/^[a-f0-9]{24}$/.test(warehouseId)) {
    throw new InventoryServiceError(422, 'INVENTORY_WAREHOUSE_ID_INVALID', 'warehouseId is not a valid id')
  }
  const warehouse = await warehouseModel
    .findOne({ _id: new Types.ObjectId(warehouseId), siteId })
    .select({ _id: 1, isDeleted: 1 })
    .lean<{ _id: Types.ObjectId; isDeleted?: boolean } | null>()
  if (!warehouse) {
    throw new InventoryServiceError(422, 'INVENTORY_WAREHOUSE_NOT_FOUND', 'The warehouse does not exist in this site')
  }
  if (warehouse.isDeleted) {
    throw new InventoryServiceError(422, 'INVENTORY_WAREHOUSE_DELETED', 'The warehouse is deleted; restore it first')
  }
}

export async function listInventories(
  model: Model<InventoryDocument>,
  siteId: string,
  params: InventoryListParams = {},
): Promise<InventoryListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }
  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.warehouseId) filter.warehouseId = params.warehouseId
  if (params.itemId) filter.itemId = params.itemId

  const search = (params.q ?? '').trim().slice(0, SEARCH_MAX)
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i')
    filter.$or = [{ sku: pattern }, { itemId: pattern }, { binLocation: pattern }]
  }

  if (params.cursor) filter._id = { $lt: objectId(params.cursor, 'INVENTORY_CURSOR_INVALID') }

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<InventoryRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  return {
    data: page.map(toAdminInventory),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts: await inventoryCounts(model, siteId),
  }
}

async function inventoryCounts(model: Model<InventoryDocument>, siteId: string): Promise<InventoryListResult['counts']> {
  const [all, deleted, lowStock] = await Promise.all([
    model.countDocuments({ siteId }),
    model.countDocuments({ siteId, isDeleted: true }),
    model.countDocuments({ siteId, isDeleted: { $ne: true }, $expr: { $lte: ['$quantityOnHand', '$lowStockThreshold'] } }),
  ])
  return { all: all - deleted, lowStock, deleted }
}

export async function getInventory(model: Model<InventoryDocument>, siteId: string, id: string): Promise<InventoryAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'INVENTORY_ID_INVALID'), siteId }).lean<InventoryRecord>()
  if (!record) throw new InventoryServiceError(404, 'INVENTORY_NOT_FOUND', 'Inventory balance not found')
  return toAdminInventory(record)
}

export async function createInventory(
  model: Model<InventoryDocument>,
  warehouseModel: Model<WarehouseDocument> | null,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<InventoryAdmin> {
  const source = (input ?? {}) as Record<string, unknown>
  const draft = (() => {
    try {
      return normalizeInventoryInput({ ...source, siteId })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  await assertWarehouseAllowed(warehouseModel, siteId, draft.warehouseId)

  let created
  try {
    created = await model.create({ ...draft, siteId, revision: 1 })
  } catch (error) {
    return translateWriteError(error)
  }
  const record = created.toObject() as InventoryRecord

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: `${record.itemId}:${record.variantId ?? '-'}:${record.warehouseId}`,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['itemId', 'variantId', 'warehouseId', 'sku', 'quantityOnHand', 'quantityReserved'],
  })

  return toAdminInventory(record)
}

function currentDraftOf(record: InventoryRecord): Record<string, unknown> {
  return {
    itemId: record.itemId,
    variantId: record.variantId ?? null,
    warehouseId: record.warehouseId,
    sku: record.sku ?? '',
    quantityOnHand: record.quantityOnHand ?? 0,
    quantityReserved: record.quantityReserved ?? 0,
    binLocation: record.binLocation ?? '',
    lowStockThreshold: record.lowStockThreshold ?? 0,
  }
}

export async function updateInventory(
  model: Model<InventoryDocument>,
  warehouseModel: Model<WarehouseDocument> | null,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<InventoryAdmin> {
  const body = input as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new InventoryServiceError(422, 'INVENTORY_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model.findOne({ _id: objectId(id, 'INVENTORY_ID_INVALID'), siteId }).lean<InventoryRecord>()
  if (!record) throw new InventoryServiceError(404, 'INVENTORY_NOT_FOUND', 'Inventory balance not found')
  if (record.isDeleted) throw new InventoryServiceError(409, 'INVENTORY_DELETED', 'Inventory balance is deleted')

  if (body.warehouseId && body.warehouseId !== record.warehouseId) {
    await assertWarehouseAllowed(warehouseModel, siteId, String(body.warehouseId))
  }

  const draft = (() => {
    try {
      return normalizeInventoryInput({
        ...currentDraftOf(record),
        ...body,
        siteId,
        itemId: body.itemId ?? record.itemId,
        variantId: body.variantId !== undefined ? body.variantId : record.variantId,
        warehouseId: body.warehouseId ?? record.warehouseId,
      })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  let updated: InventoryRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision },
      {
        $set: {
          itemId: draft.itemId,
          variantId: draft.variantId,
          warehouseId: draft.warehouseId,
          sku: draft.sku,
          quantityOnHand: draft.quantityOnHand,
          quantityReserved: draft.quantityReserved,
          binLocation: draft.binLocation,
          lowStockThreshold: draft.lowStockThreshold,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<InventoryRecord>()
  } catch (error) {
    return translateWriteError(error)
  }

  if (!updated) {
    throw new InventoryServiceError(409, 'INVENTORY_REVISION_CONFLICT', 'Inventory balance was changed by someone else; reload before saving', { expected: revision })
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: `${updated.itemId}:${updated.variantId ?? '-'}:${updated.warehouseId}`,
    action: 'update',
    revision: updated.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['sku', 'quantityOnHand', 'quantityReserved', 'binLocation', 'lowStockThreshold', 'warehouseId'],
  })

  return toAdminInventory(updated)
}

export async function softDeleteInventory(
  model: Model<InventoryDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<{ id: string; itemId: string }> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new InventoryServiceError(422, 'INVENTORY_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'INVENTORY_ID_INVALID'), siteId }).lean<InventoryRecord>()
  if (!record) throw new InventoryServiceError(404, 'INVENTORY_NOT_FOUND', 'Inventory balance not found')

  const deleted = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<InventoryRecord | null>()

  if (!deleted) {
    throw new InventoryServiceError(409, 'INVENTORY_REVISION_CONFLICT', 'Inventory balance was changed by someone else; reload before deleting')
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: `${record.itemId}:${record.variantId ?? '-'}:${record.warehouseId}`,
    action: 'delete',
    revision: deleted.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['isDeleted'],
  })

  return { id: String(record._id), itemId: record.itemId }
}

export async function restoreInventory(
  model: Model<InventoryDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<InventoryAdmin> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new InventoryServiceError(422, 'INVENTORY_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'INVENTORY_ID_INVALID'), siteId }).lean<InventoryRecord>()
  if (!record) throw new InventoryServiceError(404, 'INVENTORY_NOT_FOUND', 'Inventory balance not found')

  const restored = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<InventoryRecord | null>()

  if (!restored) {
    throw new InventoryServiceError(409, 'INVENTORY_REVISION_CONFLICT', 'Inventory balance was changed by someone else; reload before restoring')
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: `${record.itemId}:${record.variantId ?? '-'}:${record.warehouseId}`,
    action: 'restore',
    revision: restored.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['isDeleted'],
  })

  return toAdminInventory(restored)
}

/**
 * Adjust on-hand quantity by `delta` (positive or negative). Refuses to drop
 * below zero. Atomic via a conditional update.
 */
export async function adjustInventoryStock(
  model: Model<InventoryDocument>,
  siteId: string,
  id: string,
  delta: number,
  meta?: { audit?: ContentAuditMeta },
  transactionModel?: Model<InventoryTransactionDocument> | null,
): Promise<InventoryAdmin> {
  if (!Number.isInteger(delta) || delta === 0) {
    throw new InventoryServiceError(422, 'INVENTORY_DELTA_INVALID', 'Stock adjustment must be a non-zero integer')
  }

  if (transactionModel) {
    await recordInventoryTransaction(model, transactionModel, siteId, {
      inventoryId: id,
      type: delta > 0 ? 'adjustment_inc' : 'adjustment_dec',
      quantityChange: delta,
      unitCost: 0,
      referenceModel: 'InventoryAdjustment',
      referenceId: id,
      reason: 'Manual stock adjustment',
    }, meta)
    const updated = await model.findOne({ _id: new Types.ObjectId(id), siteId }).lean<InventoryRecord>()
    if (!updated) throw new InventoryServiceError(404, 'INVENTORY_NOT_FOUND', 'Inventory balance not found')
    return toAdminInventory(updated)
  }

  const record = await model.findOne({ _id: objectId(id, 'INVENTORY_ID_INVALID'), siteId }).lean<InventoryRecord>()
  if (!record) throw new InventoryServiceError(404, 'INVENTORY_NOT_FOUND', 'Inventory balance not found')
  if (record.isDeleted) throw new InventoryServiceError(409, 'INVENTORY_DELETED', 'Inventory balance is deleted')

  const condition = delta < 0
    ? { _id: record._id, siteId, revision: record.revision, quantityOnHand: { $gte: -delta } }
    : { _id: record._id, siteId, revision: record.revision }

  const updated = await model.findOneAndUpdate(
    condition,
    { $inc: { quantityOnHand: delta, revision: 1 } },
    { returnDocument: 'after' },
  ).lean<InventoryRecord | null>()

  if (!updated) {
    if (delta < 0) {
      throw new InventoryServiceError(409, 'INVENTORY_INSUFFICIENT_STOCK', 'Not enough stock on hand for this adjustment')
    }
    throw new InventoryServiceError(409, 'INVENTORY_REVISION_CONFLICT', 'Inventory balance was changed by someone else; reload before adjusting')
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: `${record.itemId}:${record.variantId ?? '-'}:${record.warehouseId}`,
    action: 'update',
    revision: updated.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['quantityOnHand'],
  })

  return toAdminInventory(updated)
}

/**
 * Reserve `quantity` units against a balance identified by item/variant/warehouse.
 * Atomic: only succeeds when enough stock is available.
 */
export async function reserveInventoryStock(
  model: Model<InventoryDocument>,
  siteId: string,
  itemId: string,
  variantId: string | null,
  warehouseId: string,
  quantity: number,
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new InventoryServiceError(422, 'INVENTORY_QUANTITY_INVALID', 'Reservation quantity must be a positive integer')
  }
  const updated = await model.findOneAndUpdate(
    {
      siteId,
      itemId,
      variantId: variantId ?? null,
      warehouseId,
      isDeleted: { $ne: true },
      $expr: { $gte: [{ $subtract: ['$quantityOnHand', '$quantityReserved'] }, quantity] },
    },
    { $inc: { quantityReserved: quantity, revision: 1 } },
    { returnDocument: 'after' },
  ).lean<InventoryRecord | null>()

  if (!updated) {
    throw new InventoryServiceError(409, 'INVENTORY_INSUFFICIENT_AVAILABLE', 'Not enough available stock to reserve')
  }
}

export async function releaseInventoryStock(
  model: Model<InventoryDocument>,
  siteId: string,
  itemId: string,
  variantId: string | null,
  warehouseId: string,
  quantity: number,
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new InventoryServiceError(422, 'INVENTORY_QUANTITY_INVALID', 'Release quantity must be a positive integer')
  }
  const updated = await model.findOneAndUpdate(
    {
      siteId,
      itemId,
      variantId: variantId ?? null,
      warehouseId,
      isDeleted: { $ne: true },
      quantityReserved: { $gte: quantity },
    },
    { $inc: { quantityReserved: -quantity, revision: 1 } },
    { returnDocument: 'after' },
  ).lean<InventoryRecord | null>()

  if (!updated) {
    throw new InventoryServiceError(409, 'INVENTORY_RESERVATION_MISMATCH', 'No matching reservation to release')
  }
}
