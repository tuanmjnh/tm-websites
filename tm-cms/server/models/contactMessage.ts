import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

export const CONTACT_MESSAGE_SCHEMA_VERSION = 1

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const CONTACT_MESSAGE_STATUSES = ['new', 'read', 'replied', 'closed'] as const
export type ContactMessageStatus = (typeof CONTACT_MESSAGE_STATUSES)[number]

export class ContactMessageInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ContactMessageInvariantError'
    this.code = code
  }
}

export const ContactMessageSubmitSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().regex(EMAIL_PATTERN, 'Invalid email').max(200),
  phone: z.string().trim().max(40).default(''),
  subject: z.string().trim().max(200).default(''),
  message: z.string().trim().min(1).max(5000),
  source: z.string().trim().max(120).default(''),
  ipHash: z.string().trim().max(128).nullable().default(null),
  userAgent: z.string().trim().max(500).default(''),
})

export type ContactMessageSubmitInput = z.infer<typeof ContactMessageSubmitSchema>

export interface ContactMessageDocument {
  siteId: string
  name: string
  email: string
  phone: string
  subject: string
  message: string
  source: string
  ipHash: string | null
  userAgent: string
  status: ContactMessageStatus
  adminNote: string
  readAt: Date | null
  repliedAt: Date | null
  closedAt: Date | null
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

export function normalizeContactMessageInput(input: unknown): ContactMessageSubmitInput {
  const source = readRecord(input)
  try {
    return ContactMessageSubmitSchema.parse(source)
  } catch (error) {
    if (error instanceof ContactMessageInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new ContactMessageInvariantError('CONTACT_MESSAGE_PAYLOAD_INVALID', 'Contact message payload is invalid')
    }
    throw error
  }
}

const ContactMessageMongooseSchema = new Schema<ContactMessageDocument>(
  {
    siteId: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, default: '' },
    subject: { type: String, default: '' },
    message: { type: String, required: true },
    source: { type: String, default: '' },
    ipHash: { type: String, default: null },
    userAgent: { type: String, default: '' },
    status: { type: String, enum: CONTACT_MESSAGE_STATUSES, default: 'new' },
    adminNote: { type: String, default: '' },
    readAt: { type: Date, default: null },
    repliedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: CONTACT_MESSAGE_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_contact_messages',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

ContactMessageMongooseSchema.index({ siteId: 1, status: 1, createdAt: -1 }, { name: 'contact_message_site_status_created' })
ContactMessageMongooseSchema.index({ siteId: 1, email: 1, createdAt: -1 }, { name: 'contact_message_site_email_created' })

export function contactMessageModel(connection: Connection): Model<ContactMessageDocument> {
  const registered = connection.models.ContactMessage as Model<ContactMessageDocument> | undefined
  if (registered) return registered
  return connection.model<ContactMessageDocument>('ContactMessage', ContactMessageMongooseSchema, 'crm_contact_messages')
}

export async function syncContactMessageIndexes(connection: Connection): Promise<void> {
  await contactMessageModel(connection).createIndexes()
}
