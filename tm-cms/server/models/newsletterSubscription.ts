import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'
import { createHash } from 'node:crypto'

export const NEWSLETTER_SCHEMA_VERSION = 1

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const NEWSLETTER_STATUSES = ['pending', 'confirmed', 'unsubscribed'] as const
export type NewsletterStatus = (typeof NEWSLETTER_STATUSES)[number]

export class NewsletterInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'NewsletterInvariantError'
    this.code = code
  }
}

export function normalizeNewsletterEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export const NewsletterSubscribeSchema = z.object({
  email: z.string().trim().toLowerCase().regex(EMAIL_PATTERN, 'Invalid email').max(200),
  name: z.string().trim().max(120).default(''),
  source: z.string().trim().max(120).default(''),
  consent: z.boolean(),
  ipHash: z.string().trim().max(128).nullable().default(null),
})

export type NewsletterSubscribeInput = z.infer<typeof NewsletterSubscribeSchema>

export interface NewsletterSubscriptionDocument {
  siteId: string
  email: string
  name: string
  status: NewsletterStatus
  consent: boolean
  source: string
  ipHash: string | null
  confirmTokenHash: string | null
  subscribedAt: Date
  confirmedAt: Date | null
  unsubscribedAt: Date | null
  isDeleted: boolean
  deletedAt: Date | null
  revision: number
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function normalizeNewsletterSubscribeInput(input: unknown): NewsletterSubscribeInput {
  const source = readRecord(input)
  try {
    return NewsletterSubscribeSchema.parse(source)
  } catch (error) {
    if (error instanceof NewsletterInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new NewsletterInvariantError('NEWSLETTER_PAYLOAD_INVALID', 'Newsletter subscription payload is invalid')
    }
    throw error
  }
}

export function hashNewsletterToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const NewsletterMongooseSchema = new Schema<NewsletterSubscriptionDocument>(
  {
    siteId: { type: String, required: true },
    email: { type: String, required: true },
    name: { type: String, default: '' },
    status: { type: String, enum: NEWSLETTER_STATUSES, default: 'pending' },
    consent: { type: Boolean, default: false },
    source: { type: String, default: '' },
    ipHash: { type: String, default: null },
    confirmTokenHash: { type: String, default: null },
    subscribedAt: { type: Date, default: () => new Date() },
    confirmedAt: { type: Date, default: null },
    unsubscribedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: NEWSLETTER_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_newsletter_subscriptions',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

NewsletterMongooseSchema.index({ siteId: 1, email: 1 }, { unique: true, name: 'newsletter_site_email' })
NewsletterMongooseSchema.index({ siteId: 1, status: 1, createdAt: -1 }, { name: 'newsletter_site_status_created' })
NewsletterMongooseSchema.index({ siteId: 1, confirmTokenHash: 1 }, { name: 'newsletter_site_token' })

export function newsletterSubscriptionModel(connection: Connection): Model<NewsletterSubscriptionDocument> {
  const registered = connection.models.NewsletterSubscription as Model<NewsletterSubscriptionDocument> | undefined
  if (registered) return registered
  return connection.model<NewsletterSubscriptionDocument>('NewsletterSubscription', NewsletterMongooseSchema, 'crm_newsletter_subscriptions')
}

export async function syncNewsletterSubscriptionIndexes(connection: Connection): Promise<void> {
  await newsletterSubscriptionModel(connection).createIndexes()
}
