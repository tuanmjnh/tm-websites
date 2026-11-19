import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  WarehouseInvariantError,
  type WarehouseDocument,
  normalizeWarehouseInput,
} from '../models/warehouse'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class WarehouseServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'WarehouseServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type WarehouseRecord = WarehouseDocument & { _id: Types.ObjectId }

export interface WarehouseAdmin {
  id: string
  siteId: string
  code: string
  title: string
  address: string
  phone: string
  status: string
  description: string
  avatar: string | null
  sort: number
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface WarehouseListParams {
  q?: string
  status?: string | null
  includeDeleted?: boolean
  cursor?: string | null
  limit?: number
}

export interface WarehouseListResult {
  data: WarehouseAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number; active: number; inactive: number; deleted: number }
}

const RESOURCE = 'warehouse'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const SEARCH_MAX = 80

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')
}

export function toAdminWarehouse(record: WarehouseRecord): WarehouseAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    code: record.code,
    title: record.title,
    address: record.address ?? '',
    phone: record.phone ?? '',
    status: record.status ?? 'active',
    description: record.description ?? '',
    avatar: record.avatar ?? null,
    sort: record.sort ?? 0,
    isDeleted: record.isDeleted === true,
    deletedAt: iso(record.deletedAt),
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new WarehouseServiceError(422, code, 'Warehouse id is not valid')
  }
  return new Types.ObjectId(value)
}

function translateInvariant(error: unknown): never {
  if (error instanceof WarehouseInvariantError) {
    throw new WarehouseServiceError(422, error.code, error.message)
  }
  throw error
}

function translateWriteError(error: unknown): never {
  const duplicate = error as { code?: number; keyPattern?: Record<string, unknown> }
  if (duplicate?.code === 11000) {
    throw new WarehouseServiceError(409, 'WAREHOUSE_CODE_EXISTS', 'Another warehouse already uses this code')
  }
  throw error
}

function generatedCode(): string {
  return `WH-${new Types.ObjectId().toHexString().slice(-8).toUpperCase()}`
}

export async function listWarehouses(
  model: Model<WarehouseDocument>,
  siteId: string,
  params: WarehouseListParams = {},
): Promise<WarehouseListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }
  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.status) filter.status = params.status

  const search = (params.q ?? '').trim().slice(0, SEARCH_MAX)
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i')
    filter.$or = [{ code: pattern }, { title: pattern }, { address: pattern }]
  }

  if (params.cursor) filter._id = { $lt: objectId(params.cursor, 'WAREHOUSE_CURSOR_INVALID') }

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<WarehouseRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  return {
    data: page.map(toAdminWarehouse),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts: await warehouseCounts(model, siteId),
  }
}

async function warehouseCounts(model: Model<WarehouseDocument>, siteId: string): Promise<WarehouseListResult['counts']> {
  const [all, deleted, inactive] = await Promise.all([
    model.countDocuments({ siteId }),
    model.countDocuments({ siteId, isDeleted: true }),
    model.countDocuments({ siteId, isDeleted: { $ne: true }, status: 'inactive' }),
  ])
  const live = all - deleted
  return { all: live, active: live - inactive, inactive, deleted }
}

export async function getWarehouse(model: Model<WarehouseDocument>, siteId: string, id: string): Promise<WarehouseAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'WAREHOUSE_ID_INVALID'), siteId }).lean<WarehouseRecord>()
  if (!record) throw new WarehouseServiceError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found')
  return toAdminWarehouse(record)
}

export async function createWarehouse(
  model: Model<WarehouseDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<WarehouseAdmin> {
  const source = (input ?? {}) as Record<string, unknown>
  const draft = (() => {
    try {
      return normalizeWarehouseInput({ ...source, siteId, code: source.code || generatedCode() })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  let created
  try {
    created = await model.create({ ...draft, siteId, revision: 1 })
  } catch (error) {
    return translateWriteError(error)
  }
  const record = created.toObject() as WarehouseRecord

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: record.status,
    changedFields: ['code', 'title', 'status', 'address', 'phone'],
  })

  return toAdminWarehouse(record)
}

function currentDraftOf(record: WarehouseRecord): Record<string, unknown> {
  return {
    code: record.code,
    title: record.title,
    address: record.address ?? '',
    phone: record.phone ?? '',
    status: record.status ?? 'active',
    description: record.description ?? '',
    avatar: record.avatar ?? null,
    sort: record.sort ?? 0,
  }
}

export async function updateWarehouse(
  model: Model<WarehouseDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<WarehouseAdmin> {
  const body = input as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new WarehouseServiceError(422, 'WAREHOUSE_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model.findOne({ _id: objectId(id, 'WAREHOUSE_ID_INVALID'), siteId }).lean<WarehouseRecord>()
  if (!record) throw new WarehouseServiceError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found')
  if (record.isDeleted) throw new WarehouseServiceError(409, 'WAREHOUSE_DELETED', 'Warehouse is deleted')

  const draft = (() => {
    try {
      return normalizeWarehouseInput({
        ...currentDraftOf(record),
        ...body,
        siteId,
        code: body.code || record.code,
      })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  let updated: WarehouseRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision },
      {
        $set: {
          code: draft.code,
          title: draft.title,
          address: draft.address,
          phone: draft.phone,
          status: draft.status,
          description: draft.description,
          avatar: draft.avatar,
          sort: draft.sort,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<WarehouseRecord>()
  } catch (error) {
    return translateWriteError(error)
  }

  if (!updated) {
    throw new WarehouseServiceError(409, 'WAREHOUSE_REVISION_CONFLICT', 'Warehouse was changed by someone else; reload before saving', { expected: revision })
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
    changedFields: ['code', 'title', 'status', 'address', 'phone', 'sort'],
  })

  return toAdminWarehouse(updated)
}

export async function softDeleteWarehouse(
  model: Model<WarehouseDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<{ id: string; code: string }> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new WarehouseServiceError(422, 'WAREHOUSE_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'WAREHOUSE_ID_INVALID'), siteId }).lean<WarehouseRecord>()
  if (!record) throw new WarehouseServiceError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found')

  const deleted = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<WarehouseRecord | null>()

  if (!deleted) {
    throw new WarehouseServiceError(409, 'WAREHOUSE_REVISION_CONFLICT', 'Warehouse was changed by someone else; reload before deleting')
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

export async function restoreWarehouse(
  model: Model<WarehouseDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<WarehouseAdmin> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new WarehouseServiceError(422, 'WAREHOUSE_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'WAREHOUSE_ID_INVALID'), siteId }).lean<WarehouseRecord>()
  if (!record) throw new WarehouseServiceError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found')

  const restored = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<WarehouseRecord | null>()

  if (!restored) {
    throw new WarehouseServiceError(409, 'WAREHOUSE_REVISION_CONFLICT', 'Warehouse was changed by someone else; reload before restoring')
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

  return toAdminWarehouse(restored)
}
