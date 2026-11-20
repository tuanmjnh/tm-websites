import type { H3Event } from 'h3'
import type { PublicContactMessage } from '@tm/flow-contracts'
import mongoose, { type Model } from 'mongoose'
import { PublicCheckoutAuditModel } from '#server/models/orderPublic'
import { resolveSiteId } from './checkoutService'
import { withSiteDb } from './mongo'

/**
 * Write side of the public contact form.
 *
 * The CMS owns `crm_contact_messages` and its triage states; the storefront
 * only inserts a `new` message with the fields an operator needs, plus the
 * request's user agent. The schema stays `strict: false` so a CMS column the
 * storefront does not know about survives, and timestamps are explicit because
 * this is a plain insert.
 */

const { Schema } = mongoose

export type InboxDoc = Record<string, unknown>

const loose = { type: Schema.Types.Mixed }

const contactMessageSchema = new Schema<InboxDoc>(
  {
    siteId: String,
    name: String,
    email: String,
    phone: String,
    subject: String,
    message: String,
    source: String,
    ipHash: loose,
    userAgent: String,
    status: String,
    adminNote: String,
    readAt: loose,
    repliedAt: loose,
    closedAt: loose,
    isDeleted: Boolean,
    deletedAt: loose,
    revision: Number,
    schemaVersion: Number,
    createdAt: loose,
    updatedAt: loose,
  },
  {
    strict: false,
    versionKey: false,
    timestamps: false,
    minimize: false,
    collection: 'crm_contact_messages',
  }
)

export const PublicContactMessageModel: Model<InboxDoc> =
  mongoose.models.PublicContactMessage ?? mongoose.model<InboxDoc>('PublicContactMessage', contactMessageSchema)

export async function submitPublicContactMessage(
  event: H3Event,
  input: PublicContactMessage,
): Promise<void> {
  // A bot filled the hidden field: answer like a success, store nothing.
  if (input.website) return

  const siteId = resolveSiteId(event)
  const userAgent = String(getHeader(event, 'user-agent') || '').slice(0, 500)
  const now = new Date()

  await withSiteDb(event, async () => {
    const created = await PublicContactMessageModel.create({
      siteId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      subject: input.subject,
      message: input.message,
      source: 'web-contact-form',
      ipHash: null,
      userAgent,
      status: 'new',
      adminNote: '',
      readAt: null,
      repliedAt: null,
      closedAt: null,
      isDeleted: false,
      deletedAt: null,
      revision: 1,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    })

    await PublicCheckoutAuditModel.create({
      siteId,
      resourceType: 'contact_message',
      resourceId: String(created._id),
      resourceKey: input.email,
      action: 'create',
      revision: 1,
      fromStatus: null,
      toStatus: 'new',
      changedFields: ['name', 'email', 'message', 'status'],
      reason: null,
      actor: { id: 'web-contact', name: 'Web contact form', email: '' },
      requestId: null,
      createdAt: now,
    })
  })
}
