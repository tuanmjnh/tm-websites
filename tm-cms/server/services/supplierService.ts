import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  SupplierInvariantError,
  type SupplierDocument,
  normalizeSupplierInput,
} from '../models/supplier'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class SupplierServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'SupplierServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type SupplierRecord = SupplierDocument & { _id: Types.ObjectId }

export interface SupplierAdmin {
  id: string
  siteId: string
  code: string
  title: string
  email: string
  phone: string
  status: string
  rating: number
  itemsSupplied: string[]
  avatar: string | null
  note: string
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface SupplierListParams {
  q?: string
  status?: string | null
  includeDeleted?: boolean
  cursor?: string | null
  limit?: number
}

export interface SupplierListResult {
  data: SupplierAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number; active: number; inactive: number; deleted: number }
}

const RESOURCE = 'supplier'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const SEARCH_MAX = 80

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')
}

export function toAdminSupplier(record: SupplierRecord): SupplierAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    code: record.code,
    title: record.title,
    email: record.email ?? '',
    phone: record.phone ?? '',
    status: record.status ?? 'active',
    rating: record.rating ?? 0,
    itemsSupplied: record.itemsSupplied ?? [],
    avatar: record.avatar ?? null,
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
    throw new SupplierServiceError(422, code, 'Supplier id is not valid')
  }
  return new Types.ObjectId(value)
}

function translateInvariant(error: unknown): never {
  if (error instanceof SupplierInvariantError) {
    throw new SupplierServiceError(422, error.code, error.message)
  }
  throw error
}

function translateWriteError(error: unknown): never {
  const duplicate = error as { code?: number; keyPattern?: Record<string, unknown> }
  if (duplicate?.code === 11000) {
    throw new SupplierServiceError(409, 'SUPPLIER_CODE_EXISTS', 'Another supplier already uses this code')
  }
  throw error
}

function generatedCode(): string {
  return `SUP-${new Types.ObjectId().toHexString().slice(-8).toUpperCase()}`
}

export async function listSuppliers(
  model: Model<SupplierDocument>,
  siteId: string,
  params: SupplierListParams = {},
): Promise<SupplierListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }
  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.status) filter.status = params.status

  const search = (params.q ?? '').trim().slice(0, SEARCH_MAX)
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i')
    filter.$or = [{ code: pattern }, { title: pattern }, { email: pattern }, { phone: pattern }]
  }

  if (params.cursor) filter._id = { $lt: objectId(params.cursor, 'SUPPLIER_CURSOR_INVALID') }

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<SupplierRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  return {
    data: page.map(toAdminSupplier),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts: await supplierCounts(model, siteId),
  }
}

async function supplierCounts(model: Model<SupplierDocument>, siteId: string): Promise<SupplierListResult['counts']> {
  const [all, deleted, inactive] = await Promise.all([
    model.countDocuments({ siteId }),
    model.countDocuments({ siteId, isDeleted: true }),
    model.countDocuments({ siteId, isDeleted: { $ne: true }, status: 'inactive' }),
  ])
  const live = all - deleted
  return { all: live, active: live - inactive, inactive, deleted }
}

export async function getSupplier(model: Model<SupplierDocument>, siteId: string, id: string): Promise<SupplierAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'SUPPLIER_ID_INVALID'), siteId }).lean<SupplierRecord>()
  if (!record) throw new SupplierServiceError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found')
  return toAdminSupplier(record)
}

export async function createSupplier(
  model: Model<SupplierDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<SupplierAdmin> {
  const source = (input ?? {}) as Record<string, unknown>
  const draft = (() => {
    try {
      return normalizeSupplierInput({ ...source, siteId, code: source.code || generatedCode() })
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
  const record = created.toObject() as SupplierRecord

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: record.status,
    changedFields: ['code', 'title', 'status', 'email', 'phone'],
  })

  return toAdminSupplier(record)
}

function currentDraftOf(record: SupplierRecord): Record<string, unknown> {
  return {
    code: record.code,
    title: record.title,
    email: record.email ?? '',
    phone: record.phone ?? '',
    status: record.status ?? 'active',
    rating: record.rating ?? 0,
    itemsSupplied: record.itemsSupplied ?? [],
    avatar: record.avatar ?? null,
    note: record.note ?? '',
  }
}

export async function updateSupplier(
  model: Model<SupplierDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<SupplierAdmin> {
  const body = input as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new SupplierServiceError(422, 'SUPPLIER_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model.findOne({ _id: objectId(id, 'SUPPLIER_ID_INVALID'), siteId }).lean<SupplierRecord>()
  if (!record) throw new SupplierServiceError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found')
  if (record.isDeleted) throw new SupplierServiceError(409, 'SUPPLIER_DELETED', 'Supplier is deleted')

  const draft = (() => {
    try {
      return normalizeSupplierInput({
        ...currentDraftOf(record),
        ...body,
        siteId,
        code: body.code || record.code,
      })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  let updated: SupplierRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision },
      {
        $set: {
          code: draft.code,
          title: draft.title,
          email: draft.email,
          phone: draft.phone,
          status: draft.status,
          rating: draft.rating,
          itemsSupplied: draft.itemsSupplied,
          avatar: draft.avatar,
          note: draft.note,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<SupplierRecord>()
  } catch (error) {
    return translateWriteError(error)
  }

  if (!updated) {
    throw new SupplierServiceError(409, 'SUPPLIER_REVISION_CONFLICT', 'Supplier was changed by someone else; reload before saving', { expected: revision })
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
    changedFields: ['code', 'title', 'status', 'email', 'phone', 'rating'],
  })

  return toAdminSupplier(updated)
}

export async function softDeleteSupplier(
  model: Model<SupplierDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<{ id: string; code: string }> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new SupplierServiceError(422, 'SUPPLIER_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'SUPPLIER_ID_INVALID'), siteId }).lean<SupplierRecord>()
  if (!record) throw new SupplierServiceError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found')

  const deleted = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<SupplierRecord | null>()

  if (!deleted) {
    throw new SupplierServiceError(409, 'SUPPLIER_REVISION_CONFLICT', 'Supplier was changed by someone else; reload before deleting')
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

export async function restoreSupplier(
  model: Model<SupplierDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<SupplierAdmin> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new SupplierServiceError(422, 'SUPPLIER_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'SUPPLIER_ID_INVALID'), siteId }).lean<SupplierRecord>()
  if (!record) throw new SupplierServiceError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found')

  const restored = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<SupplierRecord | null>()

  if (!restored) {
    throw new SupplierServiceError(409, 'SUPPLIER_REVISION_CONFLICT', 'Supplier was changed by someone else; reload before restoring')
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

  return toAdminSupplier(restored)
}
