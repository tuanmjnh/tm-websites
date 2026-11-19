import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

/**
 * Per-recipient notification preferences (MSG-01).
 *
 * The default is subscribed: a missing row means "deliver". Only a mute is
 * stored, so adding a new notification type cannot leave existing recipients
 * silently unsubscribed, and an operator can see exactly who opted out.
 *
 * This is not marketing consent. A transactional notification about a customer's
 * own order is not advertising; a broadcast/marketing type needs a consent
 * lifecycle of its own before it can use this collection.
 */

export const NOTIFICATION_SUBSCRIPTION_SCHEMA_VERSION = 1

const RECIPIENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_.@-]{0,127}$/
const TYPE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/

export const NotificationSubscriptionSchema = z.object({
  recipientId: z.string().regex(RECIPIENT_PATTERN),
  type: z.string().regex(TYPE_PATTERN),
  enabled: z.boolean(),
})

export type NotificationSubscriptionInput = z.infer<typeof NotificationSubscriptionSchema>

export interface NotificationSubscriptionDocument {
  siteId: string
  recipientId: string
  type: string
  enabled: boolean
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

const NotificationSubscriptionMongooseSchema = new Schema<NotificationSubscriptionDocument>(
  {
    siteId: { type: String, required: true },
    recipientId: { type: String, required: true },
    type: { type: String, required: true },
    enabled: { type: Boolean, required: true },
    schemaVersion: { type: Number, default: NOTIFICATION_SUBSCRIPTION_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_notification_subscriptions',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

NotificationSubscriptionMongooseSchema.index(
  { siteId: 1, recipientId: 1, type: 1 },
  { unique: true, name: 'notification_subscription_recipient_type' },
)

export function notificationSubscriptionModel(connection: Connection): Model<NotificationSubscriptionDocument> {
  const registered = connection.models.NotificationSubscription as Model<NotificationSubscriptionDocument> | undefined
  if (registered) return registered
  return connection.model<NotificationSubscriptionDocument>(
    'NotificationSubscription',
    NotificationSubscriptionMongooseSchema,
    'crm_notification_subscriptions',
  )
}

export async function syncNotificationSubscriptionIndexes(connection: Connection): Promise<void> {
  await notificationSubscriptionModel(connection).createIndexes()
}
