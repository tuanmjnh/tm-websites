import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  KeywordInvariantError,
  type KeywordDocument,
  normalizeKeywordInput,
} from '../models/keyword'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class KeywordServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'KeywordServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type KeywordRecord = KeywordDocument & { _id: Types.ObjectId }

export interface KeywordAdmin {
  id: string
  siteId: string
  slug: string
  title: string
  color: string
  count: number
  scope: string
  isActive: boolean
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface KeywordListParams {
  scope?: string | null
  includeDeleted?: boolean
  cursor?: string | null
  limit?: number
}

export interface KeywordListResult {
  data: KeywordAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number; active: number; deleted: number }
}

const RESOURCE = 'keyword'
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

export function toAdminKeyword(record: KeywordRecord): KeywordAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    slug: record.slug,
    title: record.title,
    color: record.color ?? '',
    count: record.count ?? 0,
    scope: record.scope ?? 'share',
    isActive: record.isActive !== false,
    isDeleted: record.isDeleted === true,
    deletedAt: iso(record.deletedAt),
    revision: record.revision ?? 1,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function objectId(value: string, code: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw new KeywordServiceError(422, code, 'Invalid id')
  return new Types.ObjectId(value)
}

export async function listKeywords(
  model: Model<KeywordDocument>,
  siteId: string,
  params: KeywordListParams = {},
): Promise<KeywordListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }
  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.scope) filter.scope = params.scope
  const cursor = params.cursor ? objectId(params.cursor, 'KEYWORD_CURSOR_INVALID') : null
  if (cursor) filter._id = { $lt: cursor }
  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<KeywordRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records
  const [all, deleted] = await Promise.all([
    model.countDocuments({ siteId }),
    model.countDocuments({ siteId, isDeleted: true }),
  ])
  return {
    data: page.map(toAdminKeyword),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts: { all: all - deleted, active: all - deleted, deleted },
  }
}

export async function getKeyword(model: Model<KeywordDocument>, siteId: string, id: string): Promise<KeywordAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'KEYWORD_ID_INVALID'), siteId }).lean<KeywordRecord>()
  if (!record) throw new KeywordServiceError(404, 'KEYWORD_NOT_FOUND', 'Keyword not found')
  return toAdminKeyword(record)
}

export async function createKeyword(
  model: Model<KeywordDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta; actorId?: string },
): Promise<KeywordAdmin> {
  const draft = (() => {
    try {
      return normalizeKeywordInput({ ...(input as Record<string, unknown>), siteId })
    } catch (error) {
      if (error instanceof KeywordInvariantError) throw new KeywordServiceError(422, error.code, error.message)
      throw error
    }
  })()
  try {
    const created = await model.create({ ...draft, revision: 1 })
    if (meta?.audit) {
      await recordContentAudit(meta.audit, {
        resourceType: RESOURCE,
        resourceId: String(created._id),
        resourceKey: created.slug,
        action: 'create',
        revision: 1,
        fromStatus: null,
        toStatus: null,
        siteId,
        changedFields: ['slug', 'title', 'color', 'scope'],
      })
    }
    return toAdminKeyword(created.toObject() as KeywordRecord)
  } catch (error) {
    const dup = error as { code?: number }
    if (dup?.code === 11000) throw new KeywordServiceError(409, 'KEYWORD_SLUG_EXISTS', 'Keyword slug already exists')
    throw error
  }
}

export async function updateKeyword(
  model: Model<KeywordDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta; actorId?: string },
): Promise<KeywordAdmin> {
  const oid = objectId(id, 'KEYWORD_ID_INVALID')
  const existing = await model.findOne({ _id: oid, siteId }).lean<KeywordRecord>()
  if (!existing) throw new KeywordServiceError(404, 'KEYWORD_NOT_FOUND', 'Keyword not found')
  const draft = (() => {
    try {
      return normalizeKeywordInput({ ...(input as Record<string, unknown>), siteId, slug: (input as Record<string, unknown>)?.slug ?? existing.slug })
    } catch (error) {
      if (error instanceof KeywordInvariantError) throw new KeywordServiceError(422, error.code, error.message)
      throw error
    }
  })()
  const updated = await model.findOneAndUpdate(
    { _id: oid, siteId },
    { $set: { ...draft, revision: (existing.revision ?? 1) + 1 } },
    { new: true },
  ).lean<KeywordRecord>()
  if (!updated) throw new KeywordServiceError(404, 'KEYWORD_NOT_FOUND', 'Keyword not found')
  if (meta?.audit) {
    await recordContentAudit(meta.audit, {
      resourceType: RESOURCE,
      resourceId: String(updated._id),
      resourceKey: updated.slug,
      action: 'update',
      revision: updated.revision ?? 1,
      fromStatus: null,
      toStatus: null,
      siteId,
      changedFields: ['title', 'color', 'scope', 'isActive'],
    })
  }
  return toAdminKeyword(updated)
}

export async function softDeleteKeyword(
  model: Model<KeywordDocument>,
  siteId: string,
  id: string,
  meta?: { audit?: ContentAuditMeta; actorId?: string; expectedRevision?: number },
): Promise<KeywordAdmin> {
  const oid = objectId(id, 'KEYWORD_ID_INVALID')
  const existing = await model.findOne({ _id: oid, siteId }).lean<KeywordRecord>()
  if (!existing) throw new KeywordServiceError(404, 'KEYWORD_NOT_FOUND', 'Keyword not found')
  if (meta?.expectedRevision && existing.revision !== meta.expectedRevision) {
    throw new KeywordServiceError(409, 'KEYWORD_REVISION_CONFLICT', 'Revision conflict')
  }
  const updated = await model.findOneAndUpdate(
    { _id: oid, siteId },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { new: true },
  ).lean<KeywordRecord>()
  if (!updated) throw new KeywordServiceError(404, 'KEYWORD_NOT_FOUND', 'Keyword not found')
  if (meta?.audit) {
    await recordContentAudit(meta.audit, {
      resourceType: RESOURCE,
      resourceId: String(updated._id),
      resourceKey: updated.slug,
      action: 'delete',
      revision: updated.revision ?? 1,
      fromStatus: null,
      toStatus: null,
      siteId,
      changedFields: ['isDeleted'],
    })
  }
  return toAdminKeyword(updated)
}

export async function restoreKeyword(
  model: Model<KeywordDocument>,
  siteId: string,
  id: string,
  meta?: { audit?: ContentAuditMeta; actorId?: string },
): Promise<KeywordAdmin> {
  const oid = objectId(id, 'KEYWORD_ID_INVALID')
  const updated = await model.findOneAndUpdate(
    { _id: oid, siteId },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { new: true },
  ).lean<KeywordRecord>()
  if (!updated) throw new KeywordServiceError(404, 'KEYWORD_NOT_FOUND', 'Keyword not found')
  if (meta?.audit) {
    await recordContentAudit(meta.audit, {
      resourceType: RESOURCE,
      resourceId: String(updated._id),
      resourceKey: updated.slug,
      action: 'restore',
      revision: updated.revision ?? 1,
      fromStatus: null,
      toStatus: null,
      siteId,
      changedFields: ['isDeleted'],
    })
  }
  return toAdminKeyword(updated)
}