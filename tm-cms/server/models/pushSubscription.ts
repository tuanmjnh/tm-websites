import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

/**
 * Web Push subscription endpoints for one recipient (MSG-01).
 *
 * The platform stores the browser-provided subscription so a future push
 * provider can deliver to it. No provider is wired here: storing the endpoint
 * is the contract; sending is a separate, provider-gated step. A duplicate
 * endpoint for the same recipient is upserted rather than duplicated.
 */

export const PUSH_SUBSCRIPTION_SCHEMA_VERSION = 1

const ENDPOINT_MAX = 2048
const KEY_MAX = 256

export const PushSubscriptionInputSchema = z.object({
  endpoint: z.string().trim().url().max(ENDPOINT_MAX),
  p256dh: z.string().trim().min(1).max(KEY_MAX),
  auth: z.string().trim().min(1).max(KEY_MAX),
  userAgent: z.string().trim().max(512).default(''),
})

export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInputSchema>

export interface PushSubscriptionDocument {
  siteId: string
  recipientId: string
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

const PushSubscriptionMongooseSchema = new Schema<PushSubscriptionDocument>(
  {
    siteId: { type: String, required: true },
    recipientId: { type: String, required: true },
    endpoint: { type: String, required: true },
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
    userAgent: { type: String, default: '' },
    schemaVersion: { type: Number, default: PUSH_SUBSCRIPTION_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_push_subscriptions',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

PushSubscriptionMongooseSchema.index(
  { siteId: 1, endpoint: 1 },
  { unique: true, name: 'push_subscription_site_endpoint' },
)
PushSubscriptionMongooseSchema.index(
  { siteId: 1, recipientId: 1 },
  { name: 'push_subscription_site_recipient' },
)

export function pushSubscriptionModel(connection: Connection): Model<PushSubscriptionDocument> {
  const registered = connection.models.PushSubscription as Model<PushSubscriptionDocument> | undefined
  if (registered) return registered
  return connection.model<PushSubscriptionDocument>('PushSubscription', PushSubscriptionMongooseSchema, 'crm_push_subscriptions')
}

export async function syncPushSubscriptionIndexes(connection: Connection): Promise<void> {
  await pushSubscriptionModel(connection).createIndexes()
}