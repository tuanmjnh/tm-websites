import mongoose, { type Model } from 'mongoose'

/**
 * Queue-side models the storefront needs to enqueue one transactional mail.
 *
 * The CMS owns both collections and the state machine; the storefront only
 * reads an active template and inserts a `queued` delivery, exactly like a CMS
 * `queueMail` call would. Schemas stay `strict: false` so CMS columns survive,
 * and timestamps are explicit because these are plain inserts.
 */

const { Schema, model } = mongoose

export type MailDoc = Record<string, unknown>

const loose = { type: Schema.Types.Mixed }

const sharedOptions = {
  strict: false,
  versionKey: false,
  timestamps: false,
  minimize: false,
} as const

const templateSchema = new Schema<MailDoc>(
  {
    siteId: String,
    code: String,
    locale: String,
    title: String,
    subject: String,
    bodyText: String,
    bodyHtml: String,
    variables: loose,
    purpose: String,
    status: String,
    isDeleted: loose,
  },
  { ...sharedOptions, collection: 'crm_mail_templates' }
)

const deliverySchema = new Schema<MailDoc>(
  {
    siteId: String,
    templateId: loose,
    templateCode: String,
    purpose: String,
    recipientEmail: String,
    recipientSubjectId: loose,
    subject: String,
    bodyText: String,
    bodyHtml: String,
    variables: loose,
    status: String,
    attempts: Number,
    maxAttempts: Number,
    lastError: loose,
    nextAttemptAt: loose,
    providerId: loose,
    dedupeKey: loose,
    sentAt: loose,
    cancelledAt: loose,
    schemaVersion: Number,
    createdAt: loose,
    updatedAt: loose,
  },
  { ...sharedOptions, collection: 'crm_mail_deliveries' }
)

export const PublicMailTemplateModel: Model<MailDoc> =
  mongoose.models.PublicMailTemplate ?? model<MailDoc>('PublicMailTemplate', templateSchema)

export const PublicMailDeliveryModel: Model<MailDoc> =
  mongoose.models.PublicMailDelivery ?? model<MailDoc>('PublicMailDelivery', deliverySchema)
