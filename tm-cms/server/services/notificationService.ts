import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  NotificationInvariantError,
  type NotificationDocument,
  type NotificationStatus,
  normalizeNotificationInput,
} from '../models/notification'
import type { NotificationSubscriptionDocument } from '../models/notificationSubscription'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

/**
 * The recipient's inbox and one operator-facing dispatch.
 *
 * Every read and every state change takes `recipientId` as an argument that the
 * API layer fills from the verified session, never from a request body or query.
 * The only function that accepts a recipient from the caller is `dispatch`, and
 * that one is gated by a write capability.
 *
 * Mark-read and archive deliberately write no audit row. They are per-recipient
 * UI state with no business consequence and would otherwise drown the trail an
 * operator actually reads; `readAt`/`archivedAt` on the document already say when
 * it happened. Dispatch and preference changes — the two mutations that decide
 * what a person is sent — are audited.
 */

export class NotificationServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'NotificationServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type NotificationRecord = NotificationDocument & { _id: Types.ObjectId }

export interface NotificationAdmin {
  id: string
  recipientId: string
  type: string
  title: string
  body: string
  link: string
  severity: string
  data: Record<string, unknown>
  status: NotificationStatus
  readAt: string | null
  archivedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface NotificationListParams {
  status?: NotificationStatus | null
  type?: string | null
  cursor?: string | null
  limit?: number
}

export interface NotificationCounts {
  all: number
  unread: number
  read: number
  archived: number
}

export interface NotificationListResult {
  data: NotificationAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: NotificationCounts
}

export interface NotificationDispatchResult {
  notification: NotificationAdmin | null
  /** False when an earlier dispatch with the same dedupe key already exists. */
  created: boolean
  /** Set when the recipient muted this type; nothing was stored. */
  skipped: 'muted' | null
}

export interface NotificationSubscriptionAdmin {
  type: string
  enabled: boolean
  updatedAt: string | null
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const TYPE_MAX = 64

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

export function toAdminNotification(record: NotificationRecord): NotificationAdmin {
  return {
    id: String(record._id),
    recipientId: record.recipientId,
    type: record.type,
    title: record.title,
    body: record.body ?? '',
    link: record.link ?? '',
    severity: record.severity ?? 'info',
    data: record.data ?? {},
    status: record.status ?? 'unread',
    readAt: iso(record.readAt),
    archivedAt: iso(record.archivedAt),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new NotificationServiceError(422, code, 'Notification id is not valid')
  }
  return new Types.ObjectId(value)
}

function translateInvariant(error: unknown): never {
  if (error instanceof NotificationInvariantError) {
    throw new NotificationServiceError(422, error.code, error.message)
  }
  throw error
}

function cleanType(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, TYPE_MAX) : ''
}

function parseDispatch(input: unknown) {
  try {
    return normalizeNotificationInput(input)
  } catch (error) {
    return translateInvariant(error)
  }
}

/**
 * Deliver one notification to one recipient.
 *
 * `dedupeKey` makes an at-least-once caller (a retried webhook, a job that ran
 * twice) safe: the second call returns the first notification and `created:
 * false` instead of adding a second copy. A duplicate-key race resolves the same
 * way, because the unique index is the arbiter rather than a pre-read.
 */
export async function dispatchNotification(
  model: Model<NotificationDocument>,
  subscriptionModel: Model<NotificationSubscriptionDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<NotificationDispatchResult> {
  const draft = parseDispatch(input)

  const muted = await subscriptionModel
    .findOne({ siteId, recipientId: draft.recipientId, type: draft.type, enabled: false })
    .lean<{ _id: Types.ObjectId } | null>()

  if (muted) {
    await recordContentAudit(meta?.audit, {
      siteId,
      resourceType: 'notification',
      resourceId: String(muted._id),
      resourceKey: draft.type,
      action: 'create',
      revision: 1,
      fromStatus: null,
      toStatus: 'muted',
      changedFields: [],
    })
    return { notification: null, created: false, skipped: 'muted' }
  }

  try {
    const created = await model.create({
      siteId,
      recipientId: draft.recipientId,
      type: draft.type,
      title: draft.title,
      body: draft.body,
      link: draft.link,
      severity: draft.severity,
      data: draft.data,
      dedupeKey: draft.dedupeKey,
      status: 'unread',
    }) as NotificationRecord

    await recordContentAudit(meta?.audit, {
      siteId,
      resourceType: 'notification',
      resourceId: String(created._id),
      resourceKey: draft.type,
      action: 'create',
      revision: 1,
      fromStatus: null,
      toStatus: 'unread',
      changedFields: ['recipientId', 'type', 'title'],
    })

    return { notification: toAdminNotification(created), created: true, skipped: null }
  } catch (error) {
    const duplicate = error as { code?: number }
    if (duplicate?.code !== 11000 || !draft.dedupeKey) throw error

    const existing = await model
      .findOne({ siteId, recipientId: draft.recipientId, dedupeKey: draft.dedupeKey })
      .lean<NotificationRecord | null>()

    if (!existing) {
      throw new NotificationServiceError(409, 'NOTIFICATION_DEDUPE_CONFLICT', 'A notification with this dedupe key already exists')
    }
    return { notification: toAdminNotification(existing), created: false, skipped: null }
  }
}

export async function notificationCounts(
  model: Model<NotificationDocument>,
  siteId: string,
  recipientId: string,
): Promise<NotificationCounts> {
  const rows = await model.aggregate<{ _id: NotificationStatus, count: number }>([
    { $match: { siteId, recipientId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])

  const counts: NotificationCounts = { all: 0, unread: 0, read: 0, archived: 0 }
  for (const row of rows) {
    if (row._id === 'unread' || row._id === 'read' || row._id === 'archived') counts[row._id] = row.count
    counts.all += row.count
  }
  return counts
}

export async function listNotifications(
  model: Model<NotificationDocument>,
  siteId: string,
  recipientId: string,
  params: NotificationListParams = {},
): Promise<NotificationListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId, recipientId }

  // Archived rows are the exception: an inbox hides them unless asked for. A
  // recipient asking for archived gets archived only, never "everything".
  filter.status = params.status ?? { $ne: 'archived' }

  const type = cleanType(params.type)
  if (type) filter.type = type
  if (params.cursor) filter._id = { $lt: objectId(params.cursor, 'NOTIFICATION_CURSOR_INVALID') }

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<NotificationRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  return {
    data: page.map(toAdminNotification),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts: await notificationCounts(model, siteId, recipientId),
  }
}

export async function getNotification(
  model: Model<NotificationDocument>,
  siteId: string,
  recipientId: string,
  id: string,
): Promise<NotificationAdmin> {
  const _id = objectId(id, 'NOTIFICATION_ID_INVALID')
  const record = await model.findOne({ _id, siteId, recipientId }).lean<NotificationRecord | null>()

  // Another recipient's notification is indistinguishable from a missing one:
  // a 403 here would confirm that an id exists in someone else's inbox.
  if (!record) throw new NotificationServiceError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo')
  return toAdminNotification(record)
}

export async function markNotificationRead(
  model: Model<NotificationDocument>,
  siteId: string,
  recipientId: string,
  id: string,
): Promise<NotificationAdmin> {
  const _id = objectId(id, 'NOTIFICATION_ID_INVALID')

  // Reading twice is not an error and must not move `readAt`: the filter only
  // matches an unread row, so a repeat leaves the original timestamp alone.
  await model.updateOne(
    { _id, siteId, recipientId, status: 'unread' },
    { $set: { status: 'read', readAt: new Date() } },
  )

  const record = await model.findOne({ _id, siteId, recipientId }).lean<NotificationRecord | null>()
  if (!record) throw new NotificationServiceError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo')
  return toAdminNotification(record)
}

export async function markAllNotificationsRead(
  model: Model<NotificationDocument>,
  siteId: string,
  recipientId: string,
  options: { type?: string | null } = {},
): Promise<{ updated: number }> {
  const filter: Record<string, unknown> = { siteId, recipientId, status: 'unread' }
  const type = cleanType(options.type)
  if (type) filter.type = type

  const result = await model.updateMany(filter, { $set: { status: 'read', readAt: new Date() } })
  return { updated: result.modifiedCount ?? 0 }
}

export async function archiveNotification(
  model: Model<NotificationDocument>,
  siteId: string,
  recipientId: string,
  id: string,
): Promise<NotificationAdmin> {
  const _id = objectId(id, 'NOTIFICATION_ID_INVALID')

  const record = await model.findOneAndUpdate(
    { _id, siteId, recipientId, status: { $ne: 'archived' } },
    { $set: { status: 'archived', archivedAt: new Date() } },
    { returnDocument: 'after' },
  ).lean<NotificationRecord | null>()

  if (record) return toAdminNotification(record)

  const existing = await model.findOne({ _id, siteId, recipientId }).lean<NotificationRecord | null>()
  if (!existing) throw new NotificationServiceError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo')
  return toAdminNotification(existing)
}

/** Only what the recipient changed; a type with no row is subscribed. */
export async function listNotificationSubscriptions(
  model: Model<NotificationSubscriptionDocument>,
  siteId: string,
  recipientId: string,
): Promise<NotificationSubscriptionAdmin[]> {
  const rows = await model
    .find({ siteId, recipientId })
    .sort({ type: 1 })
    .lean<(NotificationSubscriptionDocument & { _id: Types.ObjectId })[]>()

  return rows.map(row => ({
    type: row.type,
    enabled: row.enabled === true,
    updatedAt: iso(row.updatedAt),
  }))
}

/**
 * Mute or unmute one type for one recipient.
 *
 * Re-enabling deletes the row instead of storing `enabled: true`. The default is
 * subscribed, so a stored "yes" is noise: it would grow the collection for every
 * recipient who ever visited a settings page and make "who opted out" a filter
 * instead of the whole collection.
 */
export async function setNotificationSubscription(
  model: Model<NotificationSubscriptionDocument>,
  siteId: string,
  recipientId: string,
  type: unknown,
  enabled: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<NotificationSubscriptionAdmin> {
  const cleanT = cleanType(type)
  if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(cleanT)) {
    throw new NotificationServiceError(422, 'NOTIFICATION_TYPE_INVALID', 'Loại thông báo không hợp lệ')
  }
  if (typeof enabled !== 'boolean') {
    throw new NotificationServiceError(422, 'NOTIFICATION_SUBSCRIPTION_INVALID', 'Trạng thái đăng ký không hợp lệ')
  }

  const existing = await model
    .findOne({ siteId, recipientId, type: cleanT })
    .lean<(NotificationSubscriptionDocument & { _id: Types.ObjectId }) | null>()

  if (existing?.enabled === enabled) {
    return { type: cleanT, enabled, updatedAt: iso(existing.updatedAt) }
  }

  if (enabled) {
    await model.deleteOne({ siteId, recipientId, type: cleanT })
  } else {
    await model.updateOne(
      { siteId, recipientId, type: cleanT },
      { $set: { enabled: false }, $setOnInsert: { siteId, recipientId, type: cleanT } },
      { upsert: true },
    )
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'notification_subscription',
    resourceId: existing ? String(existing._id) : `${recipientId}:${cleanT}`,
    resourceKey: cleanT,
    action: 'update',
    revision: 1,
    fromStatus: existing?.enabled === false ? 'muted' : 'enabled',
    toStatus: enabled ? 'enabled' : 'muted',
    changedFields: ['enabled'],
  })

  const row = enabled
    ? null
    : await model.findOne({ siteId, recipientId, type: cleanT }).lean<NotificationSubscriptionDocument | null>()

  return { type: cleanT, enabled, updatedAt: iso(row?.updatedAt ?? null) }
}
