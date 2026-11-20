import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  SerialNumberInvariantError,
  type SerialNumberDocument,
  type SerialStatus,
  type SerialNumberRegisterInput,
  normalizeSerialNumberInput,
  SERIAL_STATUSES,
} from '../models/serialNumber'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class SerialNumberServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'SerialNumberServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

const RESOURCE = 'serial_number' as const

type SerialRecord = SerialNumberDocument & { _id: Types.ObjectId }

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value === 'string' && Types.ObjectId.isValid(value)) return new Types.ObjectId(value)
  throw new SerialNumberServiceError(422, code, 'Invalid identifier')
}

function translateInvariant(error: unknown): never {
  if (error instanceof SerialNumberInvariantError) {
    throw new SerialNumberServiceError(422, error.code, error.message)
  }
  if (error instanceof SerialNumberServiceError) throw error
  throw error
}

function toAdmin(record: SerialRecord) {
  return {
    id: String(record._id),
    siteId: record.siteId,
    serial: record.serial,
    itemId: record.itemId,
    variantId: record.variantId,
    warehouseId: record.warehouseId,
    status: record.status,
    purchaseOrderId: record.purchaseOrderId,
    orderId: record.orderId,
    note: record.note,
    receivedAt: record.receivedAt,
    soldAt: record.soldAt,
    returnedAt: record.returnedAt,
    scrappedAt: record.scrappedAt,
    revision: record.revision,
    isDeleted: record.isDeleted,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export interface SerialNumberAdmin { id: string, siteId: string, serial: string, itemId: string, variantId: string | null, warehouseId: string | null, status: string, purchaseOrderId: string | null, orderId: string | null, note: string, receivedAt: Date, soldAt: Date | null, returnedAt: Date | null, scrappedAt: Date | null, revision: number, isDeleted: boolean, createdAt: Date, updatedAt: Date }

export async function getSerialNumber(
  model: Model<SerialNumberDocument>,
  siteId: string,
  id: string,
): Promise<SerialNumberAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'SERIAL_NUMBER_ID_INVALID'), siteId }).lean<SerialRecord>()
  if (!record) throw new SerialNumberServiceError(404, 'SERIAL_NUMBER_NOT_FOUND', 'Serial number not found')
  return toAdmin(record)
}

export async function listSerialNumbers(
  model: Model<SerialNumberDocument>,
  siteId: string,
  params: { status?: string, itemId?: string, warehouseId?: string, q?: string, cursor?: string, limit?: number, includeDeleted?: boolean } = {},
) {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 50), 1), 200)
  const filter: Record<string, unknown> = { siteId }
  if (params.status && SERIAL_STATUSES.includes(params.status as SerialStatus)) filter.status = params.status
  if (params.itemId) filter.itemId = params.itemId
  if (params.warehouseId) filter.warehouseId = params.warehouseId
  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.q) {
    const q = params.q.trim()
    if (q) filter.serial = { $regex: q, $options: 'i' }
  }
  if (params.cursor && Types.ObjectId.isValid(params.cursor)) filter._id = { $lt: new Types.ObjectId(params.cursor) }

  const rows = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<SerialRecord[]>()
  const hasMore = rows.length > limit
  const data = (hasMore ? rows.slice(0, limit) : rows).map(toAdmin)
  const nextCursor = hasMore ? String(rows[limit - 1]!._id) : null

  const base: Record<string, unknown> = { siteId }
  if (!params.includeDeleted) base.isDeleted = { $ne: true }
  const counts: Record<string, number> = { all: 0 }
  for (const status of SERIAL_STATUSES) counts[status] = 0
  counts.all = await model.countDocuments(base)
  for (const status of SERIAL_STATUSES) counts[status] = await model.countDocuments({ ...base, status })
  const deleted = params.includeDeleted ? await model.countDocuments({ siteId, isDeleted: true }) : 0
  return { data, nextCursor, hasMore, counts: { ...counts, deleted } }
}

export async function registerSerialNumbers(
  model: Model<SerialNumberDocument>,
  siteId: string,
  siteIdInput: string,
  inputs: unknown[],
  meta?: { audit?: ContentAuditMeta },
): Promise<SerialNumberAdmin[]> {
  const normalized: SerialNumberRegisterInput[] = []
  for (const input of inputs) {
    try {
      normalized.push(normalizeSerialNumberInput({ ...(input as Record<string, unknown>), siteId: siteIdInput }))
    } catch (error) {
      translateInvariant(error)
      throw error
    }
  }

  const serials = normalized.map(item => item.serial)
  const existing = await model.find({ siteId: siteIdInput, serial: { $in: serials } }).lean<SerialRecord[]>()
  if (existing.length > 0) {
    throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_DUPLICATE', 'Serial number already registered', { serials: existing.map(item => item.serial) })
  }

  const created = await model.insertMany(normalized.map(item => ({
    siteId: siteIdInput,
    serial: item.serial,
    itemId: item.itemId,
    variantId: item.variantId,
    warehouseId: item.warehouseId,
    purchaseOrderId: item.purchaseOrderId,
    status: 'in_stock',
    revision: 1,
    schemaVersion: 1,
  })))

  const records = created.map(doc => doc.toObject() as SerialRecord)
  await recordContentAudit(meta?.audit, {
    siteId: siteIdInput,
    resourceType: RESOURCE,
    resourceId: records.map(item => String(item._id)).join(','),
    resourceKey: records.map(item => item.serial).join(','),
    action: 'create',
    revision: 1,
    fromStatus: null,
    toStatus: 'in_stock',
    changedFields: ['serial', 'itemId', 'status'],
  })

  return records.map(toAdmin)
}

export async function markSerialSold(
  model: Model<SerialNumberDocument>,
  siteId: string,
  id: string,
  orderId: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<SerialNumberAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'SERIAL_NUMBER_ID_INVALID'), siteId }).lean<SerialRecord>()
  if (!record) throw new SerialNumberServiceError(404, 'SERIAL_NUMBER_NOT_FOUND', 'Serial number not found')
  if (record.revision !== revision) throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_REVISION_CONFLICT', 'Revision mismatch')
  if (record.status !== 'in_stock') throw new SerialNumberServiceError(422, 'SERIAL_NUMBER_NOT_IN_STOCK', 'Serial is not in stock')

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { status: 'sold', orderId, soldAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<SerialRecord>()
  if (!updated) throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_REVISION_CONFLICT', 'Serial number changed; retry')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.serial,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: updated.status,
    changedFields: ['status', 'orderId'],
  })
  return toAdmin(updated)
}

export async function markSerialReturned(
  model: Model<SerialNumberDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<SerialNumberAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'SERIAL_NUMBER_ID_INVALID'), siteId }).lean<SerialRecord>()
  if (!record) throw new SerialNumberServiceError(404, 'SERIAL_NUMBER_NOT_FOUND', 'Serial number not found')
  if (record.revision !== revision) throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_REVISION_CONFLICT', 'Revision mismatch')
  if (record.status !== 'sold') throw new SerialNumberServiceError(422, 'SERIAL_NUMBER_NOT_SOLD', 'Serial is not sold')

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { status: 'returned', returnedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<SerialRecord>()
  if (!updated) throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_REVISION_CONFLICT', 'Serial number changed; retry')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.serial,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: updated.status,
    changedFields: ['status'],
  })
  return toAdmin(updated)
}

export async function revertSerialSale(
  model: Model<SerialNumberDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<SerialNumberAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'SERIAL_NUMBER_ID_INVALID'), siteId }).lean<SerialRecord>()
  if (!record) throw new SerialNumberServiceError(404, 'SERIAL_NUMBER_NOT_FOUND', 'Serial number not found')
  if (record.revision !== revision) throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_REVISION_CONFLICT', 'Revision mismatch')
  if (record.isDeleted) throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_DELETED', 'Serial number is deleted')
  if (record.status !== 'sold') {
    // Already reverted or never sold: nothing to do, but report current state.
    return toAdmin(record)
  }

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { status: 'in_stock', orderId: null, soldAt: null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<SerialRecord>()
  if (!updated) throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_REVISION_CONFLICT', 'Serial number changed; retry')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.serial,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: updated.status,
    changedFields: ['status', 'orderId'],
  })
  return toAdmin(updated)
}

export async function scrapSerialNumber(
  model: Model<SerialNumberDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<SerialNumberAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'SERIAL_NUMBER_ID_INVALID'), siteId }).lean<SerialRecord>()
  if (!record) throw new SerialNumberServiceError(404, 'SERIAL_NUMBER_NOT_FOUND', 'Serial number not found')
  if (record.revision !== revision) throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_REVISION_CONFLICT', 'Revision mismatch')

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { status: 'scrapped', scrappedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<SerialRecord>()
  if (!updated) throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_REVISION_CONFLICT', 'Serial number changed; retry')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.serial,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: updated.status,
    changedFields: ['status'],
  })
  return toAdmin(updated)
}

export async function moveSerialNumber(
  model: Model<SerialNumberDocument>,
  siteId: string,
  id: string,
  warehouseId: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<SerialNumberAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'SERIAL_NUMBER_ID_INVALID'), siteId }).lean<SerialRecord>()
  if (!record) throw new SerialNumberServiceError(404, 'SERIAL_NUMBER_NOT_FOUND', 'Serial number not found')
  if (record.revision !== revision) throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_REVISION_CONFLICT', 'Revision mismatch')
  if (record.isDeleted) throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_DELETED', 'Serial number is deleted')
  if (record.status !== 'in_stock') throw new SerialNumberServiceError(422, 'SERIAL_NUMBER_NOT_IN_STOCK', 'Serial is not in stock')
  const targetWarehouse = warehouseId.trim()
  if (!targetWarehouse) throw new SerialNumberServiceError(422, 'SERIAL_NUMBER_WAREHOUSE_REQUIRED', 'A target warehouse is required')
  if (targetWarehouse === (record.warehouseId ?? '')) {
    throw new SerialNumberServiceError(422, 'SERIAL_NUMBER_SAME_WAREHOUSE', 'Serial is already in that warehouse')
  }

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { warehouseId: targetWarehouse }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<SerialRecord>()
  if (!updated) throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_REVISION_CONFLICT', 'Serial number changed; retry')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.serial,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: updated.status,
    changedFields: ['warehouseId'],
  })
  return toAdmin(updated)
}

export async function moveSerialNumbers(
  model: Model<SerialNumberDocument>,
  siteId: string,
  ids: string[],
  warehouseId: string,
  meta?: { audit?: ContentAuditMeta },
): Promise<SerialNumberAdmin[]> {
  const results: SerialNumberAdmin[] = []
  for (const id of ids) {
    const record = await model.findOne({ _id: objectId(id, 'SERIAL_NUMBER_ID_INVALID'), siteId }).lean<SerialRecord>()
    if (!record) throw new SerialNumberServiceError(404, 'SERIAL_NUMBER_NOT_FOUND', 'Serial number not found')
    results.push(await moveSerialNumber(model, siteId, id, warehouseId, record.revision, meta))
  }
  return results
}

export async function syncSerialsForTransaction(
  model: Model<SerialNumberDocument>,
  siteId: string,
  type: string,
  serialStrings: string[],
  context: { warehouseId: string; targetWarehouseId?: string; orderId?: string },
  meta?: { audit?: ContentAuditMeta },
): Promise<SerialNumberAdmin[]> {
  const normalized = serialStrings.map(s => s.trim()).filter(Boolean)
  if (normalized.length === 0) return []

  const records = await model.find({ siteId, serial: { $in: normalized }, isDeleted: { $ne: true } }).lean<SerialRecord[]>()
  if (records.length !== normalized.length) {
    const found = new Set(records.map(r => r.serial))
    const missing = normalized.filter(s => !found.has(s))
    throw new SerialNumberServiceError(404, 'SERIAL_NUMBER_NOT_FOUND', 'Serial number not found', { missing })
  }

  const results: SerialNumberAdmin[] = []
  for (const record of records) {
    switch (type) {
      case 'export':
      case 'return_out': {
        if (record.status !== 'in_stock') {
          throw new SerialNumberServiceError(422, 'SERIAL_NUMBER_NOT_IN_STOCK', `Serial ${record.serial} is not in stock`)
        }
        const sold = await markSerialSold(model, siteId, String(record._id), context.orderId ?? '', record.revision, meta)
        results.push(sold)
        break
      }
      case 'return_in': {
        if (record.status !== 'sold') {
          throw new SerialNumberServiceError(422, 'SERIAL_NUMBER_NOT_SOLD', `Serial ${record.serial} is not sold`)
        }
        const returned = await markSerialReturned(model, siteId, String(record._id), record.revision, meta)
        results.push(returned)
        break
      }
      case 'transfer_out': {
        if (record.status !== 'in_stock') {
          throw new SerialNumberServiceError(422, 'SERIAL_NUMBER_NOT_IN_STOCK', `Serial ${record.serial} is not in stock`)
        }
        if (!context.targetWarehouseId) {
          throw new SerialNumberServiceError(422, 'SERIAL_NUMBER_WAREHOUSE_REQUIRED', 'A target warehouse is required for transfer')
        }
        const moved = await moveSerialNumber(model, siteId, String(record._id), context.targetWarehouseId, record.revision, meta)
        results.push(moved)
        break
      }
      case 'adjustment_dec': {
        if (record.status !== 'in_stock') {
          throw new SerialNumberServiceError(422, 'SERIAL_NUMBER_NOT_IN_STOCK', `Serial ${record.serial} is not in stock`)
        }
        const scrapped = await scrapSerialNumber(model, siteId, String(record._id), record.revision, meta)
        results.push(scrapped)
        break
      }
      default:
        // For import, adjustment_inc, transfer_in, etc., just validate existence;
        // serials should already be registered or will be registered separately.
        results.push({
          id: String(record._id),
          siteId: record.siteId,
          serial: record.serial,
          itemId: record.itemId,
          variantId: record.variantId,
          warehouseId: record.warehouseId,
          status: record.status,
          purchaseOrderId: record.purchaseOrderId,
          orderId: record.orderId,
          note: record.note,
          receivedAt: record.receivedAt,
          soldAt: record.soldAt,
          returnedAt: record.returnedAt,
          scrappedAt: record.scrappedAt,
          revision: record.revision,
          isDeleted: record.isDeleted,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        })
        break
    }
  }
  return results
}

export async function softDeleteSerialNumber(
  model: Model<SerialNumberDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<SerialNumberAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'SERIAL_NUMBER_ID_INVALID'), siteId }).lean<SerialRecord>()
  if (!record) throw new SerialNumberServiceError(404, 'SERIAL_NUMBER_NOT_FOUND', 'Serial number not found')
  if (record.revision !== revision) throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_REVISION_CONFLICT', 'Revision mismatch')

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<SerialRecord>()
  if (!updated) throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_REVISION_CONFLICT', 'Serial number changed; retry')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.serial,
    action: 'delete',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: record.status,
    changedFields: ['isDeleted'],
  })
  return toAdmin(updated)
}

export async function restoreSerialNumber(
  model: Model<SerialNumberDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<SerialNumberAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'SERIAL_NUMBER_ID_INVALID'), siteId }).lean<SerialRecord>()
  if (!record) throw new SerialNumberServiceError(404, 'SERIAL_NUMBER_NOT_FOUND', 'Serial number not found')
  if (record.revision !== revision) throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_REVISION_CONFLICT', 'Revision mismatch')

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<SerialRecord>()
  if (!updated) throw new SerialNumberServiceError(409, 'SERIAL_NUMBER_REVISION_CONFLICT', 'Serial number changed; retry')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.serial,
    action: 'restore',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: record.status,
    changedFields: ['isDeleted'],
  })
  return toAdmin(updated)
}
