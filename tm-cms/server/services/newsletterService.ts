import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  NewsletterInvariantError,
  type NewsletterStatus,
  type NewsletterSubscriptionDocument,
  normalizeNewsletterEmail,
  normalizeNewsletterSubscribeInput,
  hashNewsletterToken,
  NEWSLETTER_STATUSES,
} from '../models/newsletterSubscription'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class NewsletterServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'NewsletterServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

const RESOURCE = 'newsletter_subscription' as const

type SubscriptionRecord = NewsletterSubscriptionDocument & { _id: Types.ObjectId }

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value === 'string' && Types.ObjectId.isValid(value)) return new Types.ObjectId(value)
  throw new NewsletterServiceError(422, code, 'Invalid identifier')
}

function translateInvariant(error: unknown): never {
  if (error instanceof NewsletterInvariantError) {
    throw new NewsletterServiceError(422, error.code, error.message)
  }
  if (error instanceof NewsletterServiceError) throw error
  throw error
}

function toAdmin(record: SubscriptionRecord) {
  return {
    id: String(record._id),
    siteId: record.siteId,
    email: record.email,
    name: record.name,
    status: record.status,
    consent: record.consent,
    source: record.source,
    subscribedAt: record.subscribedAt,
    confirmedAt: record.confirmedAt,
    unsubscribedAt: record.unsubscribedAt,
    revision: record.revision,
    isDeleted: record.isDeleted,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export interface NewsletterAdmin { id: string, siteId: string, email: string, name: string, status: string, consent: boolean, source: string, subscribedAt: Date, confirmedAt: Date | null, unsubscribedAt: Date | null, revision: number, isDeleted: boolean, createdAt: Date, updatedAt: Date }

export interface SubscribeResult {
  subscription: NewsletterAdmin
  /** Plaintext token; only present while the subscription is pending confirmation. */
  confirmToken: string | null
  confirmRequired: boolean
}

export async function getNewsletterSubscription(
  model: Model<NewsletterSubscriptionDocument>,
  siteId: string,
  id: string,
): Promise<NewsletterAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'NEWSLETTER_ID_INVALID'), siteId }).lean<SubscriptionRecord>()
  if (!record) throw new NewsletterServiceError(404, 'NEWSLETTER_NOT_FOUND', 'Subscription not found')
  return toAdmin(record)
}

export async function listNewsletterSubscriptions(
  model: Model<NewsletterSubscriptionDocument>,
  siteId: string,
  params: { status?: string, q?: string, cursor?: string, limit?: number, includeDeleted?: boolean } = {},
) {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 50), 1), 200)
  const filter: Record<string, unknown> = { siteId }
  if (params.status && NEWSLETTER_STATUSES.includes(params.status as NewsletterStatus)) filter.status = params.status
  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.q) {
    const q = params.q.trim()
    if (q) filter.$or = [{ email: { $regex: q, $options: 'i' } }, { name: { $regex: q, $options: 'i' } }]
  }
  if (params.cursor && Types.ObjectId.isValid(params.cursor)) filter._id = { $lt: new Types.ObjectId(params.cursor) }

  const rows = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<SubscriptionRecord[]>()
  const hasMore = rows.length > limit
  const data = (hasMore ? rows.slice(0, limit) : rows).map(toAdmin)
  const nextCursor = hasMore ? String(rows[limit - 1]!._id) : null
  const counts = await (async () => {
    const base: Record<string, unknown> = { siteId }
    if (!params.includeDeleted) base.isDeleted = { $ne: true }
    const [all, pending, confirmed, unsubscribed, deleted] = await Promise.all([
      model.countDocuments(base),
      model.countDocuments({ ...base, status: 'pending' }),
      model.countDocuments({ ...base, status: 'confirmed' }),
      model.countDocuments({ ...base, status: 'unsubscribed' }),
      model.countDocuments({ siteId, isDeleted: true }),
    ])
    return { all, pending, confirmed, unsubscribed, deleted }
  })()
  return { data, nextCursor, hasMore, counts }
}

export async function subscribeNewsletter(
  model: Model<NewsletterSubscriptionDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<SubscribeResult> {
  let draft: ReturnType<typeof normalizeNewsletterSubscribeInput>
  try {
    draft = normalizeNewsletterSubscribeInput({ ...(input as Record<string, unknown>), siteId })
  } catch (error) {
    translateInvariant(error)
    throw error
  }
  if (!draft.consent) {
    throw new NewsletterServiceError(422, 'NEWSLETTER_CONSENT_REQUIRED', 'Subscribing requires explicit consent')
  }

  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  const tokenHash = hashNewsletterToken(token)
  const now = new Date()

  const existing = await model.findOne({ siteId, email: draft.email }).lean<SubscriptionRecord>()

  let record: SubscriptionRecord
  let confirmRequired = true
  if (!existing) {
    const created = await model.create({
      siteId,
      email: draft.email,
      name: draft.name,
      status: 'pending',
      consent: true,
      source: draft.source,
      ipHash: draft.ipHash,
      confirmTokenHash: tokenHash,
      subscribedAt: now,
      revision: 1,
    })
    record = created.toObject() as SubscriptionRecord
  } else if (existing.status === 'unsubscribed') {
    const updated = await model.findOneAndUpdate(
      { _id: existing._id, siteId, revision: existing.revision },
      {
        $set: {
          name: draft.name,
          status: 'pending',
          consent: true,
          source: draft.source,
          ipHash: draft.ipHash,
          confirmTokenHash: tokenHash,
          subscribedAt: now,
          confirmedAt: null,
          unsubscribedAt: null,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<SubscriptionRecord>()
    if (!updated) throw new NewsletterServiceError(409, 'NEWSLETTER_REVISION_CONFLICT', 'Subscription changed; retry')
    record = updated
  } else if (existing.status === 'pending') {
    const updated = await model.findOneAndUpdate(
      { _id: existing._id, siteId, revision: existing.revision },
      {
        $set: {
          name: draft.name,
          consent: true,
          source: draft.source,
          ipHash: draft.ipHash,
          confirmTokenHash: tokenHash,
          subscribedAt: now,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<SubscriptionRecord>()
    if (!updated) throw new NewsletterServiceError(409, 'NEWSLETTER_REVISION_CONFLICT', 'Subscription changed; retry')
    record = updated
  } else {
    // Already confirmed: keep the subscription, refresh profile fields, no new token.
    const updated = await model.findOneAndUpdate(
      { _id: existing._id, siteId, revision: existing.revision },
      {
        $set: { name: draft.name, source: draft.source, ipHash: draft.ipHash, consent: true },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<SubscriptionRecord>()
    if (!updated) throw new NewsletterServiceError(409, 'NEWSLETTER_REVISION_CONFLICT', 'Subscription changed; retry')
    record = updated
    confirmRequired = false
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.email,
    action: existing ? 'update' : 'create',
    revision: record.revision,
    fromStatus: existing?.status ?? null,
    toStatus: record.status,
    changedFields: ['email', 'name', 'status', 'consent', 'source'],
  })

  return {
    subscription: toAdmin(record),
    confirmToken: confirmRequired ? token : null,
    confirmRequired,
  }
}

export async function confirmNewsletterSubscription(
  model: Model<NewsletterSubscriptionDocument>,
  siteId: string,
  token: string,
  meta?: { audit?: ContentAuditMeta },
): Promise<NewsletterAdmin> {
  const hash = hashNewsletterToken(String(token ?? '').trim())
  if (!hash) throw new NewsletterServiceError(422, 'NEWSLETTER_TOKEN_INVALID', 'Confirmation token is invalid')
  const record = await model.findOne({ siteId, confirmTokenHash: hash, status: 'pending', isDeleted: { $ne: true } }).lean<SubscriptionRecord>()
  if (!record) throw new NewsletterServiceError(404, 'NEWSLETTER_TOKEN_NOT_FOUND', 'Confirmation token not found or already used')

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision: record.revision },
    {
      $set: { status: 'confirmed', confirmedAt: new Date(), confirmTokenHash: null },
      $inc: { revision: 1 },
    },
    { returnDocument: 'after' },
  ).lean<SubscriptionRecord>()
  if (!updated) throw new NewsletterServiceError(409, 'NEWSLETTER_REVISION_CONFLICT', 'Subscription changed; retry')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.email,
    action: 'update',
    revision: updated.revision,
    fromStatus: 'pending',
    toStatus: 'confirmed',
    changedFields: ['status', 'confirmedAt'],
  })
  return toAdmin(updated)
}

export async function unsubscribeNewsletter(
  model: Model<NewsletterSubscriptionDocument>,
  siteId: string,
  input: { email?: string | null, token?: string | null },
  meta?: { audit?: ContentAuditMeta },
): Promise<NewsletterAdmin> {
  const email = input.email ? normalizeNewsletterEmail(input.email) : null
  const token = input.token ? String(input.token).trim() : null
  if (!email && !token) throw new NewsletterServiceError(422, 'NEWSLETTER_UNSUBSCRIBE_TARGET_REQUIRED', 'Email or token is required')

  const filter: Record<string, unknown> = { siteId, isDeleted: { $ne: true } }
  if (token) filter.confirmTokenHash = hashNewsletterToken(token)
  else filter.email = email

  const record = await model.findOne(filter).lean<SubscriptionRecord>()
  if (!record) throw new NewsletterServiceError(404, 'NEWSLETTER_NOT_FOUND', 'Subscription not found')

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision: record.revision },
    {
      $set: { status: 'unsubscribed', unsubscribedAt: new Date(), confirmTokenHash: null },
      $inc: { revision: 1 },
    },
    { returnDocument: 'after' },
  ).lean<SubscriptionRecord>()
  if (!updated) throw new NewsletterServiceError(409, 'NEWSLETTER_REVISION_CONFLICT', 'Subscription changed; retry')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.email,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: 'unsubscribed',
    changedFields: ['status', 'unsubscribedAt'],
  })
  return toAdmin(updated)
}

export async function softDeleteNewsletterSubscription(
  model: Model<NewsletterSubscriptionDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<NewsletterAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'NEWSLETTER_ID_INVALID'), siteId }).lean<SubscriptionRecord>()
  if (!record) throw new NewsletterServiceError(404, 'NEWSLETTER_NOT_FOUND', 'Subscription not found')
  if (record.revision !== revision) throw new NewsletterServiceError(409, 'NEWSLETTER_REVISION_CONFLICT', 'Revision mismatch')
  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<SubscriptionRecord>()
  if (!updated) throw new NewsletterServiceError(409, 'NEWSLETTER_REVISION_CONFLICT', 'Subscription changed; retry')
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

export async function restoreNewsletterSubscription(
  model: Model<NewsletterSubscriptionDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<NewsletterAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'NEWSLETTER_ID_INVALID'), siteId }).lean<SubscriptionRecord>()
  if (!record) throw new NewsletterServiceError(404, 'NEWSLETTER_NOT_FOUND', 'Subscription not found')
  if (record.revision !== revision) throw new NewsletterServiceError(409, 'NEWSLETTER_REVISION_CONFLICT', 'Revision mismatch')
  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<SubscriptionRecord>()
  if (!updated) throw new NewsletterServiceError(409, 'NEWSLETTER_REVISION_CONFLICT', 'Subscription changed; retry')
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
