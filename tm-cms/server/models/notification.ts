import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

/**
 * Local notification inbox (MSG-01).
 *
 * Hub owns identity: `recipientId` is a Hub subject id, never an email or a name.
 * The inbox itself is business data — it explains what happened to a customer's
 * order or a warehouse's stock — so it lives here, scoped by site, and is only
 * ever read through the recipient's own session.
 *
 * The body is plain text. Legacy stored rich text and interpolated it into mail,
 * which is how customer-supplied HTML ended up rendered; here a client renders
 * these strings as text and a `link` must be a site-relative path.
 */

export const NOTIFICATION_SCHEMA_VERSION = 1

const RECIPIENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_.@-]{0,127}$/
const TYPE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/
const DEDUPE_MAX = 120

export const NOTIFICATION_STATUSES = ['unread', 'read', 'archived'] as const
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number]

export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'critical'] as const
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number]

export class NotificationInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'NotificationInvariantError'
    this.code = code
  }
}

/** Control characters would let one notification forge extra lines in a list. */
function cleanText(value: unknown, max: number): string {
  const raw = typeof value === 'string' ? value : ''
  let cleaned = ''
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0
    cleaned += code < 32 || code === 127 ? ' ' : character
  }
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, max).trim()
}

function cleanBody(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  // Newlines are meaningful in a body; every other control character becomes a
  // space so one payload cannot forge extra rows in a notification list.
  let cleaned = ''
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0
    cleaned += character === '\n' || (code >= 32 && code !== 127) ? character : ' '
  }
  return cleaned.replace(/\r\n/g, '\n').trim().slice(0, 2000)
}

export const NotificationDispatchSchema = z.object({
  recipientId: z.string().regex(RECIPIENT_PATTERN),
  type: z.string().regex(TYPE_PATTERN),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(2000).default(''),
  link: z.string().trim().max(500).default(''),
  severity: z.enum(NOTIFICATION_SEVERITIES).default('info'),
  dedupeKey: z.string().trim().min(1).max(DEDUPE_MAX).nullable().default(null),
  data: z.record(z.string(), z.unknown()).default({}),
})

export type NotificationDispatch = z.infer<typeof NotificationDispatchSchema>

export interface NotificationDocument {
  siteId: string
  recipientId: string
  type: string
  title: string
  body: string
  link: string
  severity: NotificationSeverity
  data: Record<string, unknown>
  status: NotificationStatus
  readAt: Date | null
  archivedAt: Date | null
  dedupeKey: string | null
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * A link renders as a button in the CMS, so an absolute URL would turn a
 * notification into an open redirect. Only site-relative paths are accepted.
 */
function cleanLink(value: unknown): string {
  const link = cleanText(value, 500)
  if (!link) return ''
  if (!link.startsWith('/') || link.startsWith('//')) {
    throw new NotificationInvariantError('NOTIFICATION_LINK_INVALID', 'A notification link must be a site-relative path')
  }
  return link
}

/** Small facts for a UI (order code, amount); bounded so one dispatch cannot store a document. */
function cleanData(value: unknown): Record<string, unknown> {
  const data = readRecord(value)
  if (Object.keys(data).length > 20) {
    throw new NotificationInvariantError('NOTIFICATION_DATA_TOO_LARGE', 'A notification carries at most 20 data fields')
  }
  if (JSON.stringify(data).length > 4000) {
    throw new NotificationInvariantError('NOTIFICATION_DATA_TOO_LARGE', 'A notification data payload is too large')
  }
  return data
}

export function normalizeNotificationInput(input: unknown): NotificationDispatch {
  const source = readRecord(input)
  try {
    const parsed = NotificationDispatchSchema.parse({
      ...source,
      title: cleanText(source.title, 200),
      body: cleanBody(source.body),
      link: undefined,
      dedupeKey: source.dedupeKey == null ? null : cleanText(source.dedupeKey, DEDUPE_MAX) || null,
      data: cleanData(source.data),
    })
    return { ...parsed, link: cleanLink(source.link) }
  } catch (error) {
    if (error instanceof NotificationInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new NotificationInvariantError('NOTIFICATION_PAYLOAD_INVALID', 'Notification payload is invalid')
    }
    throw error
  }
}

const NotificationMongooseSchema = new Schema<NotificationDocument>(
  {
    siteId: { type: String, required: true },
    recipientId: { type: String, required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    link: { type: String, default: '' },
    severity: { type: String, enum: NOTIFICATION_SEVERITIES, default: 'info' },
    data: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: NOTIFICATION_STATUSES, default: 'unread' },
    readAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    dedupeKey: { type: String, default: null },
    schemaVersion: { type: Number, default: NOTIFICATION_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_notifications',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

NotificationMongooseSchema.index(
  { siteId: 1, recipientId: 1, status: 1, createdAt: -1 },
  { name: 'notification_inbox' },
)
// A retried emit (a webhook, an at-least-once job) must not grow the inbox. The
// index is partial because most notifications carry no natural key at all.
NotificationMongooseSchema.index(
  { siteId: 1, recipientId: 1, dedupeKey: 1 },
  {
    unique: true,
    name: 'notification_dedupe',
    partialFilterExpression: { dedupeKey: { $type: 'string' } },
  },
)

export function notificationModel(connection: Connection): Model<NotificationDocument> {
  const registered = connection.models.Notification as Model<NotificationDocument> | undefined
  if (registered) return registered
  return connection.model<NotificationDocument>('Notification', NotificationMongooseSchema, 'crm_notifications')
}

export async function syncNotificationIndexes(connection: Connection): Promise<void> {
  await notificationModel(connection).createIndexes()
}
