import { Types, type Model } from 'mongoose'
import type {
  AdminAuditAction,
  AdminAuditEntry,
  AdminAuditList,
  AdminAuditResourceType,
} from '@tm/flow-contracts/audit-admin'
import type { AuditEntryDocument } from '../models/audit'
import { csvCell } from '../utils/csv'

/**
 * Read side of the business audit trail.
 *
 * The command path writes `audit_logs`; this service only lists it, scoped to
 * one site, with explicit filters and an `_id` cursor so paging stays stable
 * while new entries are appended.
 */

export interface AuditListInput {
  resourceType?: AdminAuditResourceType
  action?: AdminAuditAction
  resourceId?: string
  actorId?: string
  q?: string
  from?: Date
  to?: Date
  cursor?: string
  limit: number
}

export class AuditQueryError extends Error {
  statusCode = 422
  code = 'AUDIT_QUERY_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'AuditQueryError'
  }
}

type AuditRecord = AuditEntryDocument & { _id: Types.ObjectId }

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toEntry(record: AuditRecord): AdminAuditEntry {
  return {
    id: String(record._id),
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    resourceKey: record.resourceKey,
    action: record.action,
    revision: record.revision,
    fromStatus: record.fromStatus ?? null,
    toStatus: record.toStatus ?? null,
    changedFields: Array.isArray(record.changedFields) ? record.changedFields : [],
    reason: record.reason ?? null,
    actor: {
      id: record.actor?.id ?? '',
      name: record.actor?.name ?? '',
      email: record.actor?.email ?? '',
    },
    requestId: record.requestId ?? null,
    createdAt: new Date(record.createdAt).toISOString(),
  }
}

export async function listAuditEntries(
  model: Model<AuditEntryDocument>,
  siteId: string,
  input: AuditListInput,
): Promise<AdminAuditList> {
  const filter: Record<string, unknown> = { siteId }

  if (input.resourceType) filter.resourceType = input.resourceType
  if (input.action) filter.action = input.action
  if (input.resourceId) filter.resourceId = input.resourceId
  if (input.actorId) filter['actor.id'] = input.actorId

  if (input.from || input.to) {
    const range: Record<string, Date> = {}
    if (input.from) range.$gte = input.from
    if (input.to) range.$lte = input.to
    filter.createdAt = range
  }

  if (input.q) {
    const pattern = { $regex: escapeRegExp(input.q), $options: 'i' }
    filter.$or = [
      { resourceKey: pattern },
      { resourceId: pattern },
      { 'actor.name': pattern },
      { 'actor.email': pattern },
    ]
  }

  const total = await model.countDocuments(filter)

  const pageFilter: Record<string, unknown> = { ...filter }
  if (input.cursor) {
    if (!Types.ObjectId.isValid(input.cursor)) {
      throw new AuditQueryError('Cursor is not a valid id')
    }
    pageFilter._id = { $lt: new Types.ObjectId(input.cursor) }
  }

  const records = await model
    .find(pageFilter)
    .sort({ _id: -1 })
    .limit(input.limit + 1)
    .lean<AuditRecord[]>()

  const hasMore = records.length > input.limit
  const page = hasMore ? records.slice(0, input.limit) : records

  return {
    data: page.map(toEntry),
    nextCursor: hasMore && page.length ? String(page[page.length - 1]!._id) : null,
    hasMore,
    total,
  }
}

const MAX_EXPORT_ROWS = 5000

export async function exportAuditCsv(
  model: Model<AuditEntryDocument>,
  siteId: string,
  params: { resourceType?: string, action?: string, limit?: number } = {},
): Promise<{ csv: string, rows: number, truncated: boolean }> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? MAX_EXPORT_ROWS), 1), MAX_EXPORT_ROWS)
  const filter: Record<string, unknown> = { siteId }
  if (params.resourceType) filter.resourceType = params.resourceType
  if (params.action) filter.action = params.action

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<AuditRecord[]>()
  const truncated = records.length > limit
  const page = truncated ? records.slice(0, limit) : records

  const lines: string[] = ['Ngày,Loại tài nguyên,Mã tài nguyên,Hành động,Revision,Từ trạng thái,Đến trạng thái,Trường thay đổi,Tác nhân,Email']
  for (const record of page) {
    lines.push([
      new Date(record.createdAt).toISOString(),
      record.resourceType,
      record.resourceId,
      record.action,
      record.revision ?? '',
      record.fromStatus ?? '',
      record.toStatus ?? '',
      Array.isArray(record.changedFields) ? record.changedFields.join(';') : '',
      record.actor?.name ?? '',
      record.actor?.email ?? '',
    ].map(csvCell).join(','))
  }
  return { csv: `${lines.join('\n')}\n`, rows: page.length, truncated }
}
