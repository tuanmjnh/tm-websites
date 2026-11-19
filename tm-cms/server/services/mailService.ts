import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  MailTemplateInvariantError,
  type MailTemplateDocument,
  type MailTemplateStatus,
  assertMailTemplateUsable,
  normalizeMailTemplateInput,
  renderMailText,
} from '../models/mailTemplate'
import {
  MailDeliveryInvariantError,
  type MailDeliveryDocument,
  type MailDeliveryStatus,
  normalizeMailQueueInput,
} from '../models/mailDelivery'
import type { MailTransport } from './mailTransport'
import { MailTransportError } from './mailTransport'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

/**
 * Templates and the outbound queue.
 *
 * The queue is a state machine, not a fire-and-forget: `sendDelivery` claims a
 * row before handing it to a provider, so two workers cannot send the same
 * message twice, and a provider failure leaves an attempt count, a reason and a
 * next attempt time behind. `createdAt`/`sentAt` remain the audit of what went
 * out; the rendered subject and body are snapshotted at queue time so a later
 * template edit cannot change a queued message.
 */

export class MailServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'MailServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type MailTemplateRecord = MailTemplateDocument & { _id: Types.ObjectId }
export type MailDeliveryRecord = MailDeliveryDocument & { _id: Types.ObjectId }

export interface MailTemplateAdmin {
  id: string
  code: string
  locale: string
  title: string
  subject: string
  bodyText: string
  bodyHtml: string
  variables: string[]
  purpose: string
  status: MailTemplateStatus
  isDeleted: boolean
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface MailDeliveryAdmin {
  id: string
  templateCode: string
  purpose: string
  to: string
  recipientSubjectId: string | null
  subject: string
  status: MailDeliveryStatus
  attempts: number
  maxAttempts: number
  lastError: string | null
  nextAttemptAt: string | null
  providerId: string | null
  sentAt: string | null
  createdAt: string | null
}

export interface MailTemplateListParams {
  status?: MailTemplateStatus | null
  purpose?: string | null
  q?: string | null
  includeDeleted?: boolean
  cursor?: string | null
  limit?: number
}

export interface MailTemplateListResult {
  data: MailTemplateAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number, draft: number, active: number, archived: number }
}

export interface MailDeliveryListParams {
  status?: MailDeliveryStatus | null
  templateCode?: string | null
  cursor?: string | null
  limit?: number
}

export interface MailDeliveryListResult {
  data: MailDeliveryAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number, queued: number, sending: number, sent: number, failed: number, cancelled: number }
}

export interface QueueMailResult {
  delivery: MailDeliveryAdmin
  created: boolean
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const SEARCH_MAX = 80
const DEFAULT_MAX_ATTEMPTS = 3
const MAX_BACKOFF_MS = 60 * 60 * 1000

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new MailServiceError(422, code, 'Mail id is not valid')
  }
  return new Types.ObjectId(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function toAdminMailTemplate(record: MailTemplateRecord): MailTemplateAdmin {
  return {
    id: String(record._id),
    code: record.code,
    locale: record.locale ?? 'vi',
    title: record.title,
    subject: record.subject,
    bodyText: record.bodyText ?? '',
    bodyHtml: record.bodyHtml ?? '',
    variables: Array.isArray(record.variables) ? record.variables : [],
    purpose: record.purpose ?? 'transactional',
    status: record.status ?? 'draft',
    isDeleted: record.isDeleted === true,
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

export function toAdminMailDelivery(record: MailDeliveryRecord): MailDeliveryAdmin {
  return {
    id: String(record._id),
    templateCode: record.templateCode,
    purpose: record.purpose ?? 'transactional',
    to: record.recipientEmail,
    recipientSubjectId: record.recipientSubjectId ?? null,
    subject: record.subject,
    status: record.status ?? 'queued',
    attempts: record.attempts ?? 0,
    maxAttempts: record.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    lastError: record.lastError ?? null,
    nextAttemptAt: iso(record.nextAttemptAt),
    providerId: record.providerId ?? null,
    sentAt: iso(record.sentAt),
    createdAt: iso(record.createdAt),
  }
}

function translateInvariant(error: unknown): never {
  if (error instanceof MailTemplateInvariantError) {
    throw new MailServiceError(422, error.code, error.message)
  }
  if (error instanceof MailDeliveryInvariantError) {
    throw new MailServiceError(422, error.code, error.message)
  }
  throw error
}

function draftOf(record: MailTemplateRecord) {
  return {
    siteId: record.siteId,
    code: record.code,
    locale: record.locale,
    title: record.title,
    subject: record.subject,
    bodyText: record.bodyText ?? '',
    bodyHtml: record.bodyHtml ?? '',
    variables: record.variables ?? [],
    purpose: record.purpose,
    status: record.status,
  }
}

function parseQueue(input: unknown) {
  try {
    return normalizeMailQueueInput(input)
  } catch (error) {
    return translateInvariant(error)
  }
}

function parseTemplate(input: unknown) {
  try {
    const draft = normalizeMailTemplateInput(input)
    assertMailTemplateUsable(draft)
    return draft
  } catch (error) {
    return translateInvariant(error)
  }
}

export async function createMailTemplate(
  model: Model<MailTemplateDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<MailTemplateAdmin> {
  const draft = parseTemplate({ ...(input as Record<string, unknown>), siteId })

  let created: MailTemplateRecord
  try {
    created = await model.create({
      ...draft,
      siteId,
      isDeleted: false,
      deletedAt: null,
      revision: 1,
    }) as MailTemplateRecord
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new MailServiceError(409, 'MAIL_TEMPLATE_CODE_EXISTS', 'Một mẫu thư khác đã dùng mã này cho ngôn ngữ này')
    }
    throw error
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'mail_template',
    resourceId: String(created._id),
    resourceKey: `${created.code}:${created.locale}`,
    action: 'create',
    revision: 1,
    fromStatus: null,
    toStatus: created.status,
    changedFields: ['code', 'locale', 'subject', 'bodyText', 'bodyHtml', 'variables', 'purpose'],
  })

  return toAdminMailTemplate(created)
}

export async function updateMailTemplate(
  model: Model<MailTemplateDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<MailTemplateAdmin> {
  const body = input as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new MailServiceError(422, 'MAIL_TEMPLATE_REVISION_REQUIRED', 'Thiếu phiên bản hiện tại')
  }

  const record = await model.findOne({ _id: objectId(id, 'MAIL_TEMPLATE_ID_INVALID'), siteId }).lean<MailTemplateRecord | null>()
  if (!record) throw new MailServiceError(404, 'MAIL_TEMPLATE_NOT_FOUND', 'Không tìm thấy mẫu thư')
  if (record.isDeleted) throw new MailServiceError(409, 'MAIL_TEMPLATE_DELETED', 'Mẫu thư đã bị ẩn')

  const draft = parseTemplate({ ...draftOf(record), ...body, siteId, code: body.code ?? record.code })

  let updated: MailTemplateRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision },
      {
        $set: {
          code: draft.code,
          locale: draft.locale,
          title: draft.title,
          subject: draft.subject,
          bodyText: draft.bodyText,
          bodyHtml: draft.bodyHtml,
          variables: draft.variables,
          purpose: draft.purpose,
          status: draft.status,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<MailTemplateRecord | null>()
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new MailServiceError(409, 'MAIL_TEMPLATE_CODE_EXISTS', 'Một mẫu thư khác đã dùng mã này cho ngôn ngữ này')
    }
    throw error
  }

  if (!updated) {
    const current = await model.findOne({ _id: record._id, siteId }).lean<MailTemplateRecord | null>()
    throw new MailServiceError(409, 'MAIL_TEMPLATE_REVISION_CONFLICT', 'Mẫu thư vừa được người khác sửa', {
      currentRevision: current?.revision ?? null,
    })
  }

  const before = draftOf(record)
  const changed = Object.keys(before).filter(key => key !== 'siteId'
    && JSON.stringify((before as Record<string, unknown>)[key]) !== JSON.stringify((draft as Record<string, unknown>)[key]))

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'mail_template',
    resourceId: String(record._id),
    resourceKey: `${draft.code}:${draft.locale}`,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: draft.status,
    changedFields: changed,
  })

  return toAdminMailTemplate(updated)
}

export async function listMailTemplates(
  model: Model<MailTemplateDocument>,
  siteId: string,
  params: MailTemplateListParams = {},
): Promise<MailTemplateListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }
  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.status) filter.status = params.status
  if (params.purpose) filter.purpose = params.purpose

  const search = (params.q ?? '').trim().slice(0, SEARCH_MAX)
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i')
    filter.$or = [{ code: pattern }, { title: pattern }, { subject: pattern }]
  }
  if (params.cursor) filter._id = { $lt: objectId(params.cursor, 'MAIL_TEMPLATE_CURSOR_INVALID') }

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<MailTemplateRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  const rows = await model.aggregate<{ _id: string, count: number }>([
    { $match: { siteId, isDeleted: { $ne: true } } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])
  const counts = { all: 0, draft: 0, active: 0, archived: 0 }
  for (const row of rows) {
    if (row._id === 'draft' || row._id === 'active' || row._id === 'archived') counts[row._id] = row.count
    counts.all += row.count
  }

  return {
    data: page.map(toAdminMailTemplate),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts,
  }
}

export async function getMailTemplate(
  model: Model<MailTemplateDocument>,
  siteId: string,
  id: string,
): Promise<MailTemplateAdmin> {
  const record = await model
    .findOne({ _id: objectId(id, 'MAIL_TEMPLATE_ID_INVALID'), siteId })
    .lean<MailTemplateRecord | null>()
  if (!record) throw new MailServiceError(404, 'MAIL_TEMPLATE_NOT_FOUND', 'Không tìm thấy mẫu thư')
  return toAdminMailTemplate(record)
}

async function setTemplateDeleted(
  model: Model<MailTemplateDocument>,
  siteId: string,
  id: string,
  revision: number,
  deleted: boolean,
  meta?: { audit?: ContentAuditMeta },
): Promise<MailTemplateAdmin> {
  const _id = objectId(id, 'MAIL_TEMPLATE_ID_INVALID')
  const record = await model.findOneAndUpdate(
    { _id, siteId, revision, isDeleted: deleted ? { $ne: true } : true },
    { $set: { isDeleted: deleted, deletedAt: deleted ? new Date() : null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<MailTemplateRecord | null>()

  if (!record) {
    const current = await model.findOne({ _id, siteId }).lean<MailTemplateRecord | null>()
    if (!current) throw new MailServiceError(404, 'MAIL_TEMPLATE_NOT_FOUND', 'Không tìm thấy mẫu thư')
    throw new MailServiceError(409, deleted ? 'MAIL_TEMPLATE_REVISION_CONFLICT' : 'MAIL_TEMPLATE_NOT_DELETED',
      deleted ? 'Mẫu thư vừa được người khác sửa' : 'Mẫu thư chưa bị ẩn', { currentRevision: current.revision })
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'mail_template',
    resourceId: String(_id),
    resourceKey: `${record.code}:${record.locale}`,
    action: deleted ? 'delete' : 'restore',
    revision: record.revision,
    fromStatus: deleted ? 'active' : 'deleted',
    toStatus: deleted ? 'deleted' : 'active',
    changedFields: ['isDeleted'],
  })

  return toAdminMailTemplate(record)
}

export function softDeleteMailTemplate(
  model: Model<MailTemplateDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<MailTemplateAdmin> {
  return setTemplateDeleted(model, siteId, id, revision, true, meta)
}

export function restoreMailTemplate(
  model: Model<MailTemplateDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<MailTemplateAdmin> {
  return setTemplateDeleted(model, siteId, id, revision, false, meta)
}

/**
 * Render and store one message. Nothing is sent here: a provider outage must not
 * lose the message, and a caller that retries the same `dedupeKey` gets the same
 * delivery instead of a second email.
 */
export async function queueMail(
  deliveryModel: Model<MailDeliveryDocument>,
  templateModel: Model<MailTemplateDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<QueueMailResult> {
  const draft = parseQueue(input)

  const template = await templateModel.findOne({
    siteId,
    code: draft.templateCode,
    locale: draft.locale ?? 'vi',
    status: 'active',
    isDeleted: { $ne: true },
  }).lean<MailTemplateRecord | null>()

  if (!template) {
    throw new MailServiceError(404, 'MAIL_TEMPLATE_NOT_FOUND', 'Không tìm thấy mẫu thư đang dùng')
  }

  if (template.purpose === 'marketing' && draft.consent !== true) {
    throw new MailServiceError(422, 'MAIL_CONSENT_REQUIRED', 'Thư tiếp thị cần xác nhận người nhận đã đồng ý')
  }

  const missing = (template.variables ?? []).filter(name => {
    const value = draft.variables[name]
    return value === undefined || String(value).trim() === ''
  })
  if (missing.length > 0) {
    throw new MailServiceError(422, 'MAIL_VARIABLES_MISSING', 'Thiếu dữ liệu để dựng nội dung thư', { missing })
  }

  const variables: Record<string, string> = {}
  for (const [key, value] of Object.entries(draft.variables)) variables[key] = String(value)

  const subject = renderMailText(template.subject, variables, { escape: false }).slice(0, 300)
  const bodyText = renderMailText(template.bodyText ?? '', variables, { escape: false })
  const bodyHtml = template.bodyHtml ? renderMailText(template.bodyHtml, variables, { escape: true }) : ''

  // The recipient is part of the key: one business event usually addresses more
  // than one person, and a shared key would collapse those into one email.
  const dedupeKey = draft.dedupeKey ? `${draft.to}:${draft.dedupeKey}`.slice(0, 200) : null

  try {
    const created = await deliveryModel.create({
      siteId,
      templateId: String(template._id),
      templateCode: template.code,
      purpose: template.purpose,
      recipientEmail: draft.to,
      recipientSubjectId: draft.recipientSubjectId,
      subject,
      bodyText,
      bodyHtml,
      variables,
      status: 'queued',
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt: new Date(),
      dedupeKey,
    }) as MailDeliveryRecord

    await recordContentAudit(meta?.audit, {
      siteId,
      resourceType: 'mail_delivery',
      resourceId: String(created._id),
      resourceKey: template.code,
      action: 'create',
      revision: 1,
      fromStatus: null,
      toStatus: 'queued',
      changedFields: ['to', 'templateCode', 'purpose'],
    })

    return { delivery: toAdminMailDelivery(created), created: true }
  } catch (error) {
    if ((error as { code?: number }).code !== 11000 || !dedupeKey) throw error

    const existing = await deliveryModel
      .findOne({ siteId, dedupeKey })
      .lean<MailDeliveryRecord | null>()
    if (!existing) {
      throw new MailServiceError(409, 'MAIL_DEDUPE_CONFLICT', 'Đã có thư khác dùng cùng khoá chống trùng')
    }
    return { delivery: toAdminMailDelivery(existing), created: false }
  }
}

function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(attempts - 1, 0), MAX_BACKOFF_MS)
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown mail transport failure'
  return message.replace(/\s+/g, ' ').trim().slice(0, 300)
}

/**
 * Claim one queued delivery and hand it to the provider.
 *
 * The claim is a conditional update, so a second worker that sees the same row
 * gets `MAIL_DELIVERY_IN_FLIGHT` instead of sending it again. An attempt is
 * counted when the claim succeeds, which means a crash mid-send still consumes
 * one of the attempts rather than retrying forever.
 */
export async function sendDelivery(
  model: Model<MailDeliveryDocument>,
  transport: MailTransport | null,
  siteId: string,
  id: string,
  meta?: { audit?: ContentAuditMeta },
): Promise<MailDeliveryAdmin> {
  if (!transport) {
    throw new MailServiceError(503, 'MAIL_PROVIDER_NOT_CONFIGURED', 'Chưa cấu hình nhà cung cấp email; thư vẫn nằm trong hàng đợi')
  }

  const _id = objectId(id, 'MAIL_DELIVERY_ID_INVALID')

  const claimed = await model.findOneAndUpdate(
    { _id, siteId, status: 'queued', nextAttemptAt: { $lte: new Date() } },
    { $set: { status: 'sending' }, $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  ).lean<MailDeliveryRecord | null>()

  if (!claimed) {
    const current = await model.findOne({ _id, siteId }).lean<MailDeliveryRecord | null>()
    if (!current) throw new MailServiceError(404, 'MAIL_DELIVERY_NOT_FOUND', 'Không tìm thấy thư')
    if (current.status === 'sending') throw new MailServiceError(409, 'MAIL_DELIVERY_IN_FLIGHT', 'Thư đang được gửi')
    if (current.status === 'sent') throw new MailServiceError(409, 'MAIL_DELIVERY_ALREADY_SENT', 'Thư đã gửi')
    if (current.status === 'failed') throw new MailServiceError(409, 'MAIL_DELIVERY_FAILED', 'Thư đã hết lượt gửi; hãy thử lại thủ công')
    if (current.status === 'cancelled') throw new MailServiceError(409, 'MAIL_DELIVERY_CANCELLED', 'Thư đã bị huỷ')
    throw new MailServiceError(409, 'MAIL_DELIVERY_NOT_DUE', 'Chưa tới lượt gửi lại', {
      nextAttemptAt: iso(current.nextAttemptAt),
    })
  }

  try {
    const result = await transport.send({
      deliveryId: String(claimed._id),
      to: claimed.recipientEmail,
      subject: claimed.subject,
      text: claimed.bodyText,
      html: claimed.bodyHtml || null,
      purpose: claimed.purpose,
    })

    const sent = await model.findOneAndUpdate(
      { _id: claimed._id, siteId, status: 'sending' },
      { $set: { status: 'sent', providerId: result.providerId, sentAt: new Date(), lastError: null } },
      { returnDocument: 'after' },
    ).lean<MailDeliveryRecord | null>()

    if (!sent) throw new MailServiceError(409, 'MAIL_DELIVERY_STATE_CHANGED', 'Trạng thái thư vừa thay đổi')

    await recordContentAudit(meta?.audit, {
      siteId,
      resourceType: 'mail_delivery',
      resourceId: String(_id),
      resourceKey: claimed.templateCode,
      action: 'update',
      revision: 1,
      fromStatus: 'sending',
      toStatus: 'sent',
      changedFields: ['status', 'providerId'],
    })

    return toAdminMailDelivery(sent)
  } catch (error) {
    const retryable = !(error instanceof MailTransportError) || error.retryable
    const exhausted = !retryable || claimed.attempts >= claimed.maxAttempts
    const status: MailDeliveryStatus = exhausted ? 'failed' : 'queued'

    const updated = await model.findOneAndUpdate(
      { _id: claimed._id, siteId, status: 'sending' },
      {
        $set: {
          status,
          lastError: failureMessage(error),
          nextAttemptAt: exhausted ? claimed.nextAttemptAt : new Date(Date.now() + backoffMs(claimed.attempts)),
        },
      },
      { returnDocument: 'after' },
    ).lean<MailDeliveryRecord | null>()

    await recordContentAudit(meta?.audit, {
      siteId,
      resourceType: 'mail_delivery',
      resourceId: String(_id),
      resourceKey: claimed.templateCode,
      action: 'update',
      revision: 1,
      fromStatus: 'sending',
      toStatus: status,
      changedFields: ['status', 'attempts', 'lastError'],
    })

    if (!updated) throw new MailServiceError(409, 'MAIL_DELIVERY_STATE_CHANGED', 'Trạng thái thư vừa thay đổi')
    return toAdminMailDelivery(updated)
  }
}

/**
 * Put a failed or cancelled delivery back in the queue with a fresh allowance.
 * The attempt history stays visible until the next send overwrites `attempts`;
 * a manual retry is an explicit operator decision, so it resets the budget.
 */
export async function retryDelivery(
  model: Model<MailDeliveryDocument>,
  siteId: string,
  id: string,
  meta?: { audit?: ContentAuditMeta },
): Promise<MailDeliveryAdmin> {
  const updated = await model.findOneAndUpdate(
    { _id: objectId(id, 'MAIL_DELIVERY_ID_INVALID'), siteId, status: { $in: ['failed', 'cancelled'] } },
    { $set: { status: 'queued', attempts: 0, lastError: null, nextAttemptAt: new Date(), cancelledAt: null } },
    { returnDocument: 'after' },
  ).lean<MailDeliveryRecord | null>()

  if (!updated) {
    const current = await model.findOne({ _id: objectId(id, 'MAIL_DELIVERY_ID_INVALID'), siteId }).lean<MailDeliveryRecord | null>()
    if (!current) throw new MailServiceError(404, 'MAIL_DELIVERY_NOT_FOUND', 'Không tìm thấy thư')
    if (current.status === 'sent') throw new MailServiceError(409, 'MAIL_DELIVERY_ALREADY_SENT', 'Thư đã gửi, không thể thử lại')
    throw new MailServiceError(409, 'MAIL_DELIVERY_IN_FLIGHT', 'Thư đang trong hàng đợi hoặc đang gửi')
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'mail_delivery',
    resourceId: String(updated._id),
    resourceKey: updated.templateCode,
    action: 'update',
    revision: 1,
    fromStatus: 'failed',
    toStatus: 'queued',
    changedFields: ['status', 'attempts'],
  })

  return toAdminMailDelivery(updated)
}

/** Only a queued delivery can be cancelled; a claimed send is already at the provider. */
export async function cancelDelivery(
  model: Model<MailDeliveryDocument>,
  siteId: string,
  id: string,
  meta?: { audit?: ContentAuditMeta },
): Promise<MailDeliveryAdmin> {
  const updated = await model.findOneAndUpdate(
    { _id: objectId(id, 'MAIL_DELIVERY_ID_INVALID'), siteId, status: 'queued' },
    { $set: { status: 'cancelled', cancelledAt: new Date() } },
    { returnDocument: 'after' },
  ).lean<MailDeliveryRecord | null>()

  if (!updated) {
    const current = await model.findOne({ _id: objectId(id, 'MAIL_DELIVERY_ID_INVALID'), siteId }).lean<MailDeliveryRecord | null>()
    if (!current) throw new MailServiceError(404, 'MAIL_DELIVERY_NOT_FOUND', 'Không tìm thấy thư')
    throw new MailServiceError(409, 'MAIL_DELIVERY_NOT_QUEUED', 'Chỉ huỷ được thư đang chờ gửi')
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'mail_delivery',
    resourceId: String(updated._id),
    resourceKey: updated.templateCode,
    action: 'update',
    revision: 1,
    fromStatus: 'queued',
    toStatus: 'cancelled',
    changedFields: ['status'],
  })

  return toAdminMailDelivery(updated)
}

export async function listMailDeliveries(
  model: Model<MailDeliveryDocument>,
  siteId: string,
  params: MailDeliveryListParams = {},
): Promise<MailDeliveryListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }
  if (params.status) filter.status = params.status
  if (params.templateCode) filter.templateCode = params.templateCode
  if (params.cursor) filter._id = { $lt: objectId(params.cursor, 'MAIL_DELIVERY_CURSOR_INVALID') }

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<MailDeliveryRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  const rows = await model.aggregate<{ _id: string, count: number }>([
    { $match: { siteId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])
  const counts = { all: 0, queued: 0, sending: 0, sent: 0, failed: 0, cancelled: 0 }
  for (const row of rows) {
    if (row._id === 'queued' || row._id === 'sending' || row._id === 'sent' || row._id === 'failed' || row._id === 'cancelled') {
      counts[row._id] = row.count
    }
    counts.all += row.count
  }

  return {
    data: page.map(toAdminMailDelivery),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts,
  }
}

export async function getMailDelivery(
  model: Model<MailDeliveryDocument>,
  siteId: string,
  id: string,
): Promise<MailDeliveryAdmin> {
  const record = await model
    .findOne({ _id: objectId(id, 'MAIL_DELIVERY_ID_INVALID'), siteId })
    .lean<MailDeliveryRecord | null>()
  if (!record) throw new MailServiceError(404, 'MAIL_DELIVERY_NOT_FOUND', 'Không tìm thấy thư')
  return toAdminMailDelivery(record)
}

export interface DrainResult {
  sent: number
  failed: number
  requeued: number
  processed: number
  provider: string
}

/**
 * Deliver what is due. There is no scheduler in the CMS, so an operator action or
 * an external cron calls this; it sends at most `limit` messages per call and
 * reports what happened instead of hiding per-message failures.
 */
export async function drainMailQueue(
  model: Model<MailDeliveryDocument>,
  transport: MailTransport | null,
  siteId: string,
  options: { limit?: number } = {},
  meta?: { audit?: ContentAuditMeta },
): Promise<DrainResult> {
  if (!transport) {
    throw new MailServiceError(503, 'MAIL_PROVIDER_NOT_CONFIGURED', 'Chưa cấu hình nhà cung cấp email')
  }

  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 10), 1), 25)
  const due = await model
    .find({ siteId, status: 'queued', nextAttemptAt: { $lte: new Date() } })
    .sort({ nextAttemptAt: 1, _id: 1 })
    .limit(limit)
    .lean<MailDeliveryRecord[]>()

  const result: DrainResult = { sent: 0, failed: 0, requeued: 0, processed: 0, provider: transport.name }

  for (const row of due) {
    try {
      const outcome = await sendDelivery(model, transport, siteId, String(row._id), meta)
      result.processed++
      if (outcome.status === 'sent') result.sent++
      else if (outcome.status === 'failed') result.failed++
      else result.requeued++
    } catch (error) {
      // A row another worker claimed between the read and the send is not a
      // failure of this drain; everything else is counted, never swallowed.
      if (error instanceof MailServiceError && error.code === 'MAIL_DELIVERY_IN_FLIGHT') continue
      result.processed++
      result.failed++
    }
  }

  return result
}
