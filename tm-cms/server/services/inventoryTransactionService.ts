import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { InventoryDocument } from '../models/inventory'
import { INVENTORY_REFERENCE_MODELS, INVENTORY_TRANSACTION_TYPES, type InventoryTransactionDocument, type InventoryTransactionType } from '../models/inventoryTransaction'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'
import { syncSerialsForTransaction, SerialNumberServiceError } from './serialNumberService'
import type { SerialNumberDocument } from '../models/serialNumber'

export class InventoryTransactionServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'InventoryTransactionServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type InventoryTransactionRecord = InventoryTransactionDocument & { _id: Types.ObjectId }

export interface InventoryTransactionAdmin {
  id: string
  siteId: string
  code: string
  inventoryId: string
  itemId: string
  variantId: string | null
  warehouseId: string
  type: string
  quantityChange: number
  previousQuantity: number
  newQuantity: number
  unitCost: number
  totalValue: number
  imeiCodes: string[]
  referenceId: string | null
  referenceCode: string | null
  referenceModel: string
  reason: string
  performerId: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface InventoryTransactionListParams {
  q?: string
  type?: string | null
  itemId?: string | null
  warehouseId?: string | null
  referenceModel?: string | null
  cursor?: string | null
  limit?: number
}

export interface InventoryTransactionListResult {
  data: InventoryTransactionAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number }
}

export interface RecordInventoryTransactionInput {
  inventoryId?: string | null
  itemId?: string | null
  variantId?: string | null
  warehouseId?: string | null
  type: InventoryTransactionType
  quantityChange: number
  unitCost?: number
  imeiCodes?: string[]
  referenceId?: string | null
  referenceCode?: string | null
  referenceModel?: (typeof INVENTORY_REFERENCE_MODELS)[number]
  reason?: string
  performerId?: string | null
}

const RESOURCE = 'inventory_transaction'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const SEARCH_MAX = 80

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')
}

export function toAdminInventoryTransaction(record: InventoryTransactionRecord): InventoryTransactionAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    code: record.code,
    inventoryId: record.inventoryId,
    itemId: record.itemId,
    variantId: record.variantId ?? null,
    warehouseId: record.warehouseId,
    type: record.type,
    quantityChange: record.quantityChange,
    previousQuantity: record.previousQuantity,
    newQuantity: record.newQuantity,
    unitCost: record.unitCost ?? 0,
    totalValue: record.totalValue ?? 0,
    imeiCodes: record.imeiCodes ?? [],
    referenceId: record.referenceId ?? null,
    referenceCode: record.referenceCode ?? null,
    referenceModel: record.referenceModel ?? 'None',
    reason: record.reason ?? '',
    performerId: record.performerId ?? null,
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new InventoryTransactionServiceError(422, code, 'Inventory transaction id is not valid')
  }
  return new Types.ObjectId(value)
}

function generatedCode(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `TX-${yy}${mm}${dd}-${new Types.ObjectId().toHexString().slice(-6).toUpperCase()}`
}

function normalizeType(value: unknown): InventoryTransactionType {
  if (typeof value === 'string' && (INVENTORY_TRANSACTION_TYPES as readonly string[]).includes(value)) {
    return value as InventoryTransactionType
  }
  throw new InventoryTransactionServiceError(422, 'INVENTORY_TRANSACTION_TYPE_INVALID', 'Transaction type is invalid')
}

function normalizeReferenceModel(value: unknown): (typeof INVENTORY_REFERENCE_MODELS)[number] {
  if (typeof value === 'string' && (INVENTORY_REFERENCE_MODELS as readonly string[]).includes(value)) {
    return value as (typeof INVENTORY_REFERENCE_MODELS)[number]
  }
  return 'None'
}

export async function listInventoryTransactions(
  model: Model<InventoryTransactionDocument>,
  siteId: string,
  params: InventoryTransactionListParams = {},
): Promise<InventoryTransactionListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }

  if (params.type) {
    if (!(INVENTORY_TRANSACTION_TYPES as readonly string[]).includes(params.type)) {
      throw new InventoryTransactionServiceError(422, 'INVENTORY_TRANSACTION_TYPE_INVALID', 'Transaction type is invalid')
    }
    filter.type = params.type
  }
  if (params.itemId) filter.itemId = params.itemId
  if (params.warehouseId) filter.warehouseId = params.warehouseId
  if (params.referenceModel) {
    if (!(INVENTORY_REFERENCE_MODELS as readonly string[]).includes(params.referenceModel)) {
      throw new InventoryTransactionServiceError(422, 'INVENTORY_TRANSACTION_REFERENCE_MODEL_INVALID', 'Reference model is invalid')
    }
    filter.referenceModel = params.referenceModel
  }

  const search = (params.q ?? '').trim().slice(0, SEARCH_MAX)
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i')
    filter.$or = [
      { code: pattern },
      { itemId: pattern },
      { referenceCode: pattern },
      { reason: pattern },
    ]
  }

  if (params.cursor) filter._id = { $lt: objectId(params.cursor, 'INVENTORY_TRANSACTION_CURSOR_INVALID') }

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<InventoryTransactionRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  const total = await model.countDocuments({ siteId })

  return {
    data: page.map(toAdminInventoryTransaction),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts: { all: total },
  }
}

export async function getInventoryTransaction(
  model: Model<InventoryTransactionDocument>,
  siteId: string,
  id: string,
): Promise<InventoryTransactionAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'INVENTORY_TRANSACTION_ID_INVALID'), siteId }).lean<InventoryTransactionRecord>()
  if (!record) throw new InventoryTransactionServiceError(404, 'INVENTORY_TRANSACTION_NOT_FOUND', 'Inventory transaction not found')
  return toAdminInventoryTransaction(record)
}

export async function recordInventoryTransaction(
  inventoryModel: Model<InventoryDocument>,
  transactionModel: Model<InventoryTransactionDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<InventoryTransactionAdmin> {
  const source = (input ?? {}) as Record<string, unknown>
  const type = normalizeType(source.type)
  const quantityChange = Number(source.quantityChange)
  if (!Number.isInteger(quantityChange) || quantityChange === 0) {
    throw new InventoryTransactionServiceError(422, 'INVENTORY_TRANSACTION_QUANTITY_INVALID', 'Transaction quantity must be a non-zero integer')
  }

  const unitCost = Number(source.unitCost ?? 0)
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    throw new InventoryTransactionServiceError(422, 'INVENTORY_TRANSACTION_UNIT_COST_INVALID', 'Transaction unit cost must be non-negative')
  }

  const inventoryId = typeof source.inventoryId === 'string' ? source.inventoryId : null
  let inventory
  if (inventoryId) {
    inventory = await inventoryModel.findOne({ _id: objectId(inventoryId, 'INVENTORY_ID_INVALID'), siteId }).lean<InventoryDocument & { _id: Types.ObjectId }>()
  } else {
    const itemId = typeof source.itemId === 'string' ? source.itemId : null
    const warehouseId = typeof source.warehouseId === 'string' ? source.warehouseId : null
    const variantId = source.variantId === undefined ? null : (source.variantId === null ? null : String(source.variantId))
    if (!itemId || !warehouseId) {
      throw new InventoryTransactionServiceError(422, 'INVENTORY_TRANSACTION_TARGET_INVALID', 'Inventory target is required')
    }
    inventory = await inventoryModel.findOne({ siteId, itemId, variantId, warehouseId, isDeleted: { $ne: true } }).lean<InventoryDocument & { _id: Types.ObjectId }>()
  }

  if (!inventory) throw new InventoryTransactionServiceError(404, 'INVENTORY_NOT_FOUND', 'Inventory balance not found')
  if (inventory.isDeleted) throw new InventoryTransactionServiceError(409, 'INVENTORY_DELETED', 'Inventory balance is deleted')

  const previousQuantity = inventory.quantityOnHand ?? 0
  const newQuantity = previousQuantity + quantityChange
  if (newQuantity < 0) {
    throw new InventoryTransactionServiceError(409, 'INVENTORY_INSUFFICIENT_STOCK', 'Not enough stock on hand for this transaction')
  }

  const updated = await inventoryModel.findOneAndUpdate(
    { _id: inventory._id, siteId, revision: inventory.revision },
    { $inc: { quantityOnHand: quantityChange, revision: 1 } },
    { returnDocument: 'after' },
  ).lean<InventoryDocument & { _id: Types.ObjectId } | null>()

  if (!updated) {
    throw new InventoryTransactionServiceError(409, 'INVENTORY_REVISION_CONFLICT', 'Inventory balance was changed by someone else; reload before transacting')
  }

  const transaction = await transactionModel.create({
    siteId,
    code: generatedCode(),
    inventoryId: String(inventory._id),
    itemId: inventory.itemId,
    variantId: inventory.variantId ?? null,
    warehouseId: inventory.warehouseId,
    type,
    quantityChange,
    previousQuantity,
    newQuantity: updated.quantityOnHand ?? newQuantity,
    unitCost,
    totalValue: Math.abs(quantityChange) * unitCost,
    imeiCodes: Array.isArray(source.imeiCodes) ? source.imeiCodes.map(String) : [],
    referenceId: source.referenceId == null ? null : String(source.referenceId),
    referenceCode: source.referenceCode == null ? null : String(source.referenceCode),
    referenceModel: normalizeReferenceModel(source.referenceModel),
    reason: typeof source.reason === 'string' ? source.reason.trim().slice(0, 500) : '',
    performerId: source.performerId == null ? (meta?.audit?.actor?.id ?? null) : String(source.performerId),
    revision: 1,
  })

  const record = transaction.toObject() as InventoryTransactionRecord

  // Serial/IMEI integration: when the transaction carries serials and a serial
  // model is available, sync the serial status/warehouse with the movement.
  const serialModel = (meta as { serialNumberModel?: unknown } | undefined)?.serialNumberModel
  const imeiCodes = Array.isArray(source.imeiCodes) ? source.imeiCodes.map(String) : []
  // Serial sync only applies to movement types where the serials already exist
  // in the database (export, transfer, return, adjustment). For 'import', the
  // caller registers the serials separately after the stock write.
  const syncableTypes = new Set(['export', 'return_out', 'return_in', 'transfer_out', 'transfer_in', 'adjustment_dec'])
  if (serialModel && imeiCodes.length > 0 && syncableTypes.has(type)) {
    try {
      await syncSerialsForTransaction(serialModel as Model<SerialNumberDocument>, siteId, type, imeiCodes, {
        warehouseId: inventory.warehouseId,
        targetWarehouseId: typeof source.targetWarehouseId === 'string' ? source.targetWarehouseId : undefined,
        orderId: typeof source.orderId === 'string' ? source.orderId : undefined,
      }, { audit: meta?.audit })
    } catch (error) {
      if (error instanceof SerialNumberServiceError) {
        throw new InventoryTransactionServiceError(error.statusCode, `SERIAL_${error.code}`, error.message, error.details)
      }
      throw error
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
    toStatus: null,
    changedFields: ['quantityOnHand', 'quantityChange', 'type'],
  })

  return toAdminInventoryTransaction(record)
}
