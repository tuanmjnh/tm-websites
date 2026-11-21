import mongoose, { type Model } from 'mongoose'

/**
 * Newsletter subscriptions as the storefront writes them.
 *
 * The CMS owns the collection, its statuses and the double opt-in rules; the
 * storefront only creates/updates one pending subscription with a hashed
 * confirmation token, then flips it on a token match. `strict: false` keeps any
 * CMS column the storefront does not know about.
 */

const { Schema, model } = mongoose

export type NewsletterDoc = Record<string, unknown>

const loose = { type: Schema.Types.Mixed }

const newsletterSchema = new Schema<NewsletterDoc>(
  {
    siteId: String,
    email: String,
    name: String,
    status: String,
    consent: Boolean,
    source: String,
    ipHash: loose,
    confirmTokenHash: loose,
    unsubscribeTokenHash: loose,
    // When the confirmation mail last went out; the resend cooldown reads it.
    confirmSentAt: loose,
    subscribedAt: loose,
    confirmedAt: loose,
    unsubscribedAt: loose,
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
    collection: 'crm_newsletter_subscriptions',
  }
)

export const PublicNewsletterModel: Model<NewsletterDoc> =
  mongoose.models.PublicNewsletterSubscription ?? model<NewsletterDoc>('PublicNewsletterSubscription', newsletterSchema)
