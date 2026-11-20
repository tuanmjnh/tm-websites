import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

/**
 * Outbound mail queue (MSG-02).
 *
 * A delivery is a stored message plus its delivery state, so a provider outage
 * is visible instead of lost: `queued` → `sending` → `sent`, or back to `queued`
 * with an attempt count and a next attempt time until `failed`.
 *
 * The rendered subject/body are snapshotted at queue time. Editing a template
 * must not rewrite a message that was already sent or change what a retry sends,
 * and it keeps the delivery readable after a template is archived.
 */

export const MAIL_DELIVERY_SCHEMA_VERSION = 1

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/
const CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/

export const MAIL_DELIVERY_STATUSES = ['queued', 'sending', 'sent', 'failed', 'cancelled'] as const
export type MailDeliveryStatus = (typeof MAIL_DELIVERY_STATUSES)[number]

export class MailDeliveryInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'MailDeliveryInvariantError'
    this.code = code
  }
}

export const MailQueueSchema = z.object({
  templateCode: z.string().regex(CODE_PATTERN),
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
  to: z.string().trim().regex(EMAIL_PATTERN),
  /** Hub subject of the recipient, when the message belongs to an account. */
  recipientSubjectId: z.string().trim().max(128).nullable().default(null),
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  dedupeKey: z.string().trim().min(1).max(120).nullable().default(null),
  /**
   * Marketing mail needs an explicit consent assertion from the caller. This is
   * not a consent registry; it exists so an unconsented send cannot happen by
   * accident, which is what legacy's newsletter did.
   */
  consent: z.boolean().default(false),
})

export type MailQueueInput = z.infer<typeof MailQueueSchema>

export interface MailDeliveryDocument {
  siteId: string
  templateId: string | null
  templateCode: string
  purpose: string
  recipientEmail: string
  recipientSubjectId: string | null
  subject: string
  bodyText: string
  bodyHtml: string
  variables: Record<string, string>
  status: MailDeliveryStatus
  attempts: number
  maxAttempts: number
  lastError: string | null
  nextAttemptAt: Date
  providerId: string | null
  dedupeKey: string | null
  sentAt: Date | null
  cancelledAt: Date | null
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Variables become strings once: rendering is textual, never a template engine. */
function normalizeVariables(value: unknown): Record<string, string> {
  const source = readRecord(value)
  const entries = Object.entries(source).slice(0, 40)
  const result: Record<string, string> = {}
  for (const [key, raw] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(key)) {
      throw new MailDeliveryInvariantError('MAIL_VARIABLE_INVALID', `Mail variable "${key}" is not a valid name`)
    }
    const text = typeof raw === 'string' ? raw : String(raw ?? '')
    if (text.length > 2000) {
      throw new MailDeliveryInvariantError('MAIL_VARIABLE_TOO_LARGE', `Mail variable "${key}" is too long`)
    }
    result[key] = text
  }
  return result
}

export function normalizeMailQueueInput(input: unknown): MailQueueInput {
  const source = readRecord(input)
  try {
    return MailQueueSchema.parse({
      ...source,
      to: typeof source.to === 'string' ? source.to.trim().toLowerCase() : source.to,
      variables: normalizeVariables(source.variables),
      dedupeKey: source.dedupeKey == null ? null : String(source.dedupeKey).trim() || null,
    })
  } catch (error) {
    if (error instanceof MailDeliveryInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new MailDeliveryInvariantError('MAIL_QUEUE_PAYLOAD_INVALID', 'Mail queue payload is invalid')
    }
    throw error
  }
}

const MailDeliveryMongooseSchema = new Schema<MailDeliveryDocument>(
  {
    siteId: { type: String, required: true },
    templateId: { type: String, default: null },
    templateCode: { type: String, required: true },
    purpose: { type: String, default: 'transactional' },
    recipientEmail: { type: String, required: true },
    recipientSubjectId: { type: String, default: null },
    subject: { type: String, required: true },
    bodyText: { type: String, default: '' },
    bodyHtml: { type: String, default: '' },
    variables: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: MAIL_DELIVERY_STATUSES, default: 'queued' },
    attempts: { type: Number, default: 0, required: true },
    maxAttempts: { type: Number, default: 3, required: true },
    lastError: { type: String, default: null },
    nextAttemptAt: { type: Date, required: true },
    providerId: { type: String, default: null },
    dedupeKey: { type: String, default: null },
    sentAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    schemaVersion: { type: Number, default: MAIL_DELIVERY_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_mail_deliveries',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

MailDeliveryMongooseSchema.index({ siteId: 1, status: 1, nextAttemptAt: 1 }, { name: 'mail_delivery_due' })
MailDeliveryMongooseSchema.index({ siteId: 1, createdAt: -1 }, { name: 'mail_delivery_site_created' })
MailDeliveryMongooseSchema.index(
  { siteId: 1, dedupeKey: 1 },
  {
    unique: true,
    name: 'mail_delivery_dedupe',
    partialFilterExpression: { dedupeKey: { $type: 'string' } },
  },
)

export function mailDeliveryModel(connection: Connection): Model<MailDeliveryDocument> {
  const registered = connection.models.MailDelivery as Model<MailDeliveryDocument> | undefined
  if (registered) return registered
  return connection.model<MailDeliveryDocument>('MailDelivery', MailDeliveryMongooseSchema, 'crm_mail_deliveries')
}

export async function syncMailDeliveryIndexes(connection: Connection): Promise<void> {
  await mailDeliveryModel(connection).createIndexes()
}
