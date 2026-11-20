import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import { type ContactMessageStatus,
  ContactMessageInvariantError,
  type ContactMessageDocument,
  normalizeContactMessageInput,
  CONTACT_MESSAGE_STATUSES,
} from '../models/contactMessage'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class ContactMessageServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ContactMessageServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

const RESOURCE = 'contact_message' as const

type ContactMessageRecord = ContactMessageDocument & { _id: Types.ObjectId }

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value === 'string' && Types.ObjectId.isValid(value)) return new Types.ObjectId(value)
  throw new ContactMessageServiceError(422, code, 'Invalid identifier')
}

function translateInvariant(error: unknown): never {
  if (error instanceof ContactMessageInvariantError) {
    throw new ContactMessageServiceError(422, error.code, error.message)
  }
  if (error instanceof ContactMessageServiceError) throw error
  throw error
}

function toAdmin(record: ContactMessageRecord) {
  return {
    id: String(record._id),
    siteId: record.siteId,
    name: record.name,
    email: record.email,
    phone: record.phone,
    subject: record.subject,
    message: record.message,
    source: record.source,
    ipHash: record.ipHash,
    userAgent: record.userAgent,
    status: record.status,
    adminNote: record.adminNote,
    readAt: record.readAt,
    repliedAt: record.repliedAt,
    closedAt: record.closedAt,
    revision: record.revision,
    isDeleted: record.isDeleted,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export interface ContactMessageAdmin { id: string, siteId: string, name: string, email: string, phone: string, subject: string, message: string, source: string, ipHash: string | null, userAgent: string, status: string, adminNote: string, readAt: Date | null, repliedAt: Date | null, closedAt: Date | null, revision: number, isDeleted: boolean, createdAt: Date, updatedAt: Date }

export async function submitContactMessage(
  model: Model<ContactMessageDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<ContactMessageAdmin> {
  let draft
  try {
    draft = normalizeContactMessageInput(input)
  } catch (error) {
    translateInvariant(error)
    throw error
  }

  const created = await model.create({
    siteId,
    ...draft,
    status: 'new',
    revision: 1,
  })
  const record = created.toObject() as ContactMessageRecord

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.email,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: 'new',
    changedFields: ['name', 'email', 'message', 'status'],
  })

  return toAdmin(record)
}

export async function getContactMessage(
  model: Model<ContactMessageDocument>,
  siteId: string,
  id: string,
): Promise<ContactMessageAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'CONTACT_MESSAGE_ID_INVALID'), siteId }).lean<ContactMessageRecord>()
  if (!record) throw new ContactMessageServiceError(404, 'CONTACT_MESSAGE_NOT_FOUND', 'Contact message not found')
  return toAdmin(record)
}

export async function listContactMessages(
  model: Model<ContactMessageDocument>,
  siteId: string,
  params: { status?: string, q?: string, cursor?: string, limit?: number, includeDeleted?: boolean } = {},
) {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 50), 1), 200)
  const filter: Record<string, unknown> = { siteId }
  if (params.status && CONTACT_MESSAGE_STATUSES.includes(params.status as ContactMessageStatus)) filter.status = params.status
  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.q) {
    const q = params.q.trim()
    if (q) filter.$or = [{ name: { $regex: q, $options: 'i' } }, { email: { $regex: q, $options: 'i' } }, { subject: { $regex: q, $options: 'i' } }, { message: { $regex: q, $options: 'i' } }]
  }
  if (params.cursor && Types.ObjectId.isValid(params.cursor)) filter._id = { $lt: new Types.ObjectId(params.cursor) }

  const rows = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<ContactMessageRecord[]>()
  const hasMore = rows.length > limit
  const data = (hasMore ? rows.slice(0, limit) : rows).map(toAdmin)
  const nextCursor = hasMore ? String(rows[limit - 1]!._id) : null

  const base: Record<string, unknown> = { siteId }
  if (!params.includeDeleted) base.isDeleted = { $ne: true }
  const [all, newCount, read, replied, closed, deleted] = await Promise.all([
    model.countDocuments(base),
    model.countDocuments({ ...base, status: 'new' }),
    model.countDocuments({ ...base, status: 'read' }),
    model.countDocuments({ ...base, status: 'replied' }),
    model.countDocuments({ ...base, status: 'closed' }),
    model.countDocuments({ siteId, isDeleted: true }),
  ])
  return { data, nextCursor, hasMore, counts: { all, new: newCount, read, replied, closed, deleted } }
}

export async function updateContactMessage(
  model: Model<ContactMessageDocument>,
  siteId: string,
  id: string,
  input: { status?: string, adminNote?: string, revision: number },
  meta?: { audit?: ContentAuditMeta },
): Promise<ContactMessageAdmin> {
  if (!Number.isInteger(input.revision) || input.revision < 1) {
    throw new ContactMessageServiceError(422, 'CONTACT_MESSAGE_REVISION_REQUIRED', 'Revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'CONTACT_MESSAGE_ID_INVALID'), siteId }).lean<ContactMessageRecord>()
  if (!record) throw new ContactMessageServiceError(404, 'CONTACT_MESSAGE_NOT_FOUND', 'Contact message not found')
  if (record.revision !== input.revision) throw new ContactMessageServiceError(409, 'CONTACT_MESSAGE_REVISION_CONFLICT', 'Revision mismatch')

  const set: Record<string, unknown> = {}
  const changed: string[] = []
  if (input.status && CONTACT_MESSAGE_STATUSES.includes(input.status as ContactMessageStatus) && input.status !== record.status) {
    const nextStatus = input.status as ContactMessageStatus
    set.status = nextStatus
    changed.push('status')
    if (nextStatus === 'read' && !record.readAt) set.readAt = new Date()
    if (nextStatus === 'replied' && !record.repliedAt) set.repliedAt = new Date()
    if (nextStatus === 'closed' && !record.closedAt) set.closedAt = new Date()
  }
  if (input.adminNote !== undefined && input.adminNote !== record.adminNote) {
    set.adminNote = String(input.adminNote).trim().slice(0, 2000)
    changed.push('adminNote')
  }
  if (changed.length === 0) {
    return toAdmin(record)
  }

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision: input.revision },
    { $set: set, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<ContactMessageRecord>()
  if (!updated) throw new ContactMessageServiceError(409, 'CONTACT_MESSAGE_REVISION_CONFLICT', 'Contact message changed; retry')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.email,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: updated.status,
    changedFields: changed,
  })

  return toAdmin(updated)
}

export async function softDeleteContactMessage(
  model: Model<ContactMessageDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<ContactMessageAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'CONTACT_MESSAGE_ID_INVALID'), siteId }).lean<ContactMessageRecord>()
  if (!record) throw new ContactMessageServiceError(404, 'CONTACT_MESSAGE_NOT_FOUND', 'Contact message not found')
  if (record.revision !== revision) throw new ContactMessageServiceError(409, 'CONTACT_MESSAGE_REVISION_CONFLICT', 'Revision mismatch')
  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<ContactMessageRecord>()
  if (!updated) throw new ContactMessageServiceError(409, 'CONTACT_MESSAGE_REVISION_CONFLICT', 'Contact message changed; retry')
  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.email,
    action: 'delete',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: record.status,
    changedFields: ['isDeleted'],
  })
  return toAdmin(updated)
}

export async function restoreContactMessage(
  model: Model<ContactMessageDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<ContactMessageAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'CONTACT_MESSAGE_ID_INVALID'), siteId }).lean<ContactMessageRecord>()
  if (!record) throw new ContactMessageServiceError(404, 'CONTACT_MESSAGE_NOT_FOUND', 'Contact message not found')
  if (record.revision !== revision) throw new ContactMessageServiceError(409, 'CONTACT_MESSAGE_REVISION_CONFLICT', 'Revision mismatch')
  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<ContactMessageRecord>()
  if (!updated) throw new ContactMessageServiceError(409, 'CONTACT_MESSAGE_REVISION_CONFLICT', 'Contact message changed; retry')
  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.email,
    action: 'restore',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: record.status,
    changedFields: ['isDeleted'],
  })
  return toAdmin(updated)
}
