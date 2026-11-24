import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  VariantOptionInvariantError,
  type VariantOptionDocument,
  normalizeVariantOptionInput,
} from '../models/variantOption'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class VariantOptionServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'VariantOptionServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type VariantOptionRecord = VariantOptionDocument & { _id: Types.ObjectId }

export interface VariantOptionAdmin {
  id: string
  siteId: string
  code: string
  title: string
  uiType: string
  values: { label: string; value: string; meta: string; sort: number }[]
  sort: number
  isActive: boolean
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface VariantOptionListParams {
  includeDeleted?: boolean
  cursor?: string | null
  limit?: number
}

export interface VariantOptionListResult {
  data: VariantOptionAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number; active: number; deleted: number }
}

const RESOURCE = 'variant_option'
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

export function toAdminVariantOption(record: VariantOptionRecord): VariantOptionAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    code: record.code,
    title: record.title,
    uiType: record.uiType ?? 'text',
    values: (record.values ?? []).map((v) => ({ label: v.label, value: v.value, meta: v.meta ?? '', sort: v.sort ?? 0 })),
    sort: record.sort ?? 0,
    isActive: record.isActive !== false,
    isDeleted: record.isDeleted === true,
    deletedAt: iso(record.deletedAt),
    revision: record.revision ?? 1,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function objectId(value: string, code: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw new VariantOptionServiceError(422, code, 'Invalid id')
  return new Types.ObjectId(value)
}

export async function listVariantOptions(
  model: Model<VariantOptionDocument>,
  siteId: string,
  params: VariantOptionListParams = {},
): Promise<VariantOptionListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }
  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  const cursor = params.cursor ? objectId(params.cursor, 'VARIANT_OPTION_CURSOR_INVALID') : null
  if (cursor) filter._id = { $lt: cursor }
  const records = await model.find(filter).sort({ sort: 1, _id: -1 }).limit(limit + 1).lean<VariantOptionRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records
  const [all, deleted] = await Promise.all([
    model.countDocuments({ siteId }),
    model.countDocuments({ siteId, isDeleted: true }),
  ])
  return {
    data: page.map(toAdminVariantOption),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts: { all: all - deleted, active: all - deleted - (deleted ? 0 : 0), deleted },
  }
}

export async function getVariantOption(model: Model<VariantOptionDocument>, siteId: string, id: string): Promise<VariantOptionAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'VARIANT_OPTION_ID_INVALID'), siteId }).lean<VariantOptionRecord>()
  if (!record) throw new VariantOptionServiceError(404, 'VARIANT_OPTION_NOT_FOUND', 'Variant option not found')
  return toAdminVariantOption(record)
}

export async function createVariantOption(
  model: Model<VariantOptionDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta; actorId?: string },
): Promise<VariantOptionAdmin> {
  const draft = (() => {
    try {
      return normalizeVariantOptionInput({ ...(input as Record<string, unknown>), siteId })
    } catch (error) {
      if (error instanceof VariantOptionInvariantError) throw new VariantOptionServiceError(422, error.code, error.message)
      throw error
    }
  })()
  try {
    const created = await model.create({ ...draft, revision: 1 })
    if (meta?.audit) {
      await recordContentAudit(meta.audit, {
        resourceType: RESOURCE,
        resourceId: String(created._id),
        resourceKey: created.code,
        action: 'create',
        revision: 1,
        fromStatus: null,
        toStatus: null,
        siteId,
        changedFields: ['code', 'title', 'uiType', 'values'],
      })
    }
    return toAdminVariantOption(created.toObject() as VariantOptionRecord)
  } catch (error) {
    const dup = error as { code?: number }
    if (dup?.code === 11000) throw new VariantOptionServiceError(409, 'VARIANT_OPTION_CODE_EXISTS', 'Variant option code already exists')
    throw error
  }
}

export async function updateVariantOption(
  model: Model<VariantOptionDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta; actorId?: string; expectedRevision?: number },
): Promise<VariantOptionAdmin> {
  const oid = objectId(id, 'VARIANT_OPTION_ID_INVALID')
  const existing = await model.findOne({ _id: oid, siteId }).lean<VariantOptionRecord>()
  if (!existing) throw new VariantOptionServiceError(404, 'VARIANT_OPTION_NOT_FOUND', 'Variant option not found')
  if (meta?.expectedRevision && existing.revision !== meta.expectedRevision) {
    throw new VariantOptionServiceError(409, 'VARIANT_OPTION_REVISION_CONFLICT', 'Revision conflict')
  }
  const draft = (() => {
    try {
      return normalizeVariantOptionInput({ ...(input as Record<string, unknown>), siteId, code: (input as Record<string, unknown>)?.code ?? existing.code })
    } catch (error) {
      if (error instanceof VariantOptionInvariantError) throw new VariantOptionServiceError(422, error.code, error.message)
      throw error
    }
  })()
  const updated = await model.findOneAndUpdate(
    { _id: oid, siteId },
    { $set: { ...draft, revision: (existing.revision ?? 1) + 1 } },
    { new: true },
  ).lean<VariantOptionRecord>()
  if (!updated) throw new VariantOptionServiceError(404, 'VARIANT_OPTION_NOT_FOUND', 'Variant option not found')
  if (meta?.audit) {
    await recordContentAudit(meta.audit, {
      resourceType: RESOURCE,
      resourceId: String(updated._id),
      resourceKey: updated.code,
      action: 'update',
      revision: updated.revision ?? 1,
      fromStatus: null,
      toStatus: null,
      siteId,
      changedFields: ['title', 'uiType', 'values', 'isActive'],
    })
  }
  return toAdminVariantOption(updated)
}

export async function softDeleteVariantOption(
  model: Model<VariantOptionDocument>,
  siteId: string,
  id: string,
  meta?: { audit?: ContentAuditMeta; actorId?: string; expectedRevision?: number },
): Promise<VariantOptionAdmin> {
  const oid = objectId(id, 'VARIANT_OPTION_ID_INVALID')
  const existing = await model.findOne({ _id: oid, siteId }).lean<VariantOptionRecord>()
  if (!existing) throw new VariantOptionServiceError(404, 'VARIANT_OPTION_NOT_FOUND', 'Variant option not found')
  if (meta?.expectedRevision && existing.revision !== meta.expectedRevision) {
    throw new VariantOptionServiceError(409, 'VARIANT_OPTION_REVISION_CONFLICT', 'Revision conflict')
  }
  const updated = await model.findOneAndUpdate(
    { _id: oid, siteId },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { new: true },
  ).lean<VariantOptionRecord>()
  if (!updated) throw new VariantOptionServiceError(404, 'VARIANT_OPTION_NOT_FOUND', 'Variant option not found')
  if (meta?.audit) {
    await recordContentAudit(meta.audit, { resourceType: RESOURCE, resourceId: String(updated._id), resourceKey: updated.code, action: 'delete', revision: updated.revision ?? 1, fromStatus: null, toStatus: null, siteId, changedFields: ['isDeleted'] })
  }
  return toAdminVariantOption(updated)
}

export async function restoreVariantOption(
  model: Model<VariantOptionDocument>,
  siteId: string,
  id: string,
  meta?: { audit?: ContentAuditMeta; actorId?: string },
): Promise<VariantOptionAdmin> {
  const oid = objectId(id, 'VARIANT_OPTION_ID_INVALID')
  const updated = await model.findOneAndUpdate(
    { _id: oid, siteId },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { new: true },
  ).lean<VariantOptionRecord>()
  if (!updated) throw new VariantOptionServiceError(404, 'VARIANT_OPTION_NOT_FOUND', 'Variant option not found')
  if (meta?.audit) {
    await recordContentAudit(meta.audit, { resourceType: RESOURCE, resourceId: String(updated._id), resourceKey: updated.code, action: 'restore', revision: updated.revision ?? 1, fromStatus: null, toStatus: null, siteId, changedFields: ['isDeleted'] })
  }
  return toAdminVariantOption(updated)
}