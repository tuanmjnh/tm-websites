import type { Types, Model } from 'mongoose'
import {
  PushSubscriptionInputSchema,
  type PushSubscriptionDocument,
  type PushSubscriptionInput,
} from '../models/pushSubscription'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class PushSubscriptionServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'PushSubscriptionServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

const RESOURCE = 'push_subscription' as const

type StoredPushSubscription = PushSubscriptionDocument & { _id: Types.ObjectId }

export interface PushSubscriptionAdmin {
  id: string
  siteId: string
  recipientId: string
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string
  createdAt: string | null
  updatedAt: string | null
}

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function toAdmin(record: StoredPushSubscription): PushSubscriptionAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    recipientId: record.recipientId,
    endpoint: record.endpoint,
    p256dh: record.p256dh,
    auth: record.auth,
    userAgent: record.userAgent ?? '',
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function normalizeInput(input: unknown): PushSubscriptionInput {
  try {
    return PushSubscriptionInputSchema.parse(input)
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      throw new PushSubscriptionServiceError(422, 'PUSH_SUBSCRIPTION_PAYLOAD_INVALID', 'Push subscription payload is invalid')
    }
    throw error
  }
}

export async function subscribePushSubscription(
  model: Model<PushSubscriptionDocument>,
  siteId: string,
  recipientId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<PushSubscriptionAdmin> {
  const draft = normalizeInput(input)

  const existing = await model
    .findOne({ siteId, endpoint: draft.endpoint })
    .lean<StoredPushSubscription | null>()

  if (existing && existing.recipientId !== recipientId) {
    throw new PushSubscriptionServiceError(409, 'PUSH_SUBSCRIPTION_OWNED_BY_OTHER', 'This endpoint is already registered to another recipient')
  }

  const updated = await model
    .findOneAndUpdate(
      { siteId, endpoint: draft.endpoint },
      {
        $set: {
          recipientId,
          p256dh: draft.p256dh,
          auth: draft.auth,
          userAgent: draft.userAgent,
        },
        $setOnInsert: { siteId, endpoint: draft.endpoint, createdAt: new Date() },
      },
      { upsert: true, returnDocument: 'after' },
    )
    .lean<StoredPushSubscription | null>()

  if (!updated) {
    throw new PushSubscriptionServiceError(500, 'PUSH_SUBSCRIPTION_STORE_FAILED', 'Could not store the push subscription')
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: draft.endpoint,
    action: existing ? 'update' : 'create',
    revision: 1,
    fromStatus: existing ? 'subscribed' : null,
    toStatus: 'subscribed',
    changedFields: ['endpoint', 'recipientId'],
  })

  return toAdmin(updated)
}

export async function unsubscribePushSubscription(
  model: Model<PushSubscriptionDocument>,
  siteId: string,
  recipientId: string,
  endpoint: string,
  meta?: { audit?: ContentAuditMeta },
): Promise<{ removed: boolean }> {
  const trimmed = String(endpoint ?? '').trim()
  if (!trimmed) {
    throw new PushSubscriptionServiceError(422, 'PUSH_SUBSCRIPTION_ENDPOINT_REQUIRED', 'An endpoint is required')
  }

  const existing = await model
    .findOne({ siteId, endpoint: trimmed, recipientId })
    .lean<StoredPushSubscription | null>()

  if (!existing) {
    return { removed: false }
  }

  await model.deleteOne({ _id: existing._id, siteId, recipientId })

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(existing._id),
    resourceKey: trimmed,
    action: 'delete',
    revision: existing.schemaVersion ?? 1,
    fromStatus: 'subscribed',
    toStatus: null,
    changedFields: ['endpoint'],
  })

  return { removed: true }
}

export async function listPushSubscriptions(
  model: Model<PushSubscriptionDocument>,
  siteId: string,
  recipientId: string,
): Promise<PushSubscriptionAdmin[]> {
  const rows = await model
    .find({ siteId, recipientId })
    .sort({ createdAt: -1 })
    .lean<StoredPushSubscription[]>()
  return rows.map(toAdmin)
}
