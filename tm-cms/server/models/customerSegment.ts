import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

export const CUSTOMER_SEGMENT_SCHEMA_VERSION = 1

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/

export class CustomerSegmentInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CustomerSegmentInvariantError'
    this.code = code
  }
}

export function normalizeCustomerSegmentCode(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '')
}

export const CustomerSegmentDraftSchema = z.object({
  code: z.string().regex(CODE_PATTERN).max(32),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).default(''),
  defaultDiscountPercent: z.number().min(0).max(100).default(0),
  freeShipping: z.boolean().default(false),
  thumbnail: z.string().trim().max(500).nullable().default(null),
  gallery: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  autoJoinCriteria: z.object({
    minSpent: z.number().min(0).default(0),
    minOrders: z.number().int().min(0).default(0),
  }).default({ minSpent: 0, minOrders: 0 }),
  sort: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
})

export type CustomerSegmentDraft = z.infer<typeof CustomerSegmentDraftSchema>

export interface CustomerSegmentDocument {
  siteId: string
  code: string
  title: string
  description: string
  defaultDiscountPercent: number
  freeShipping: boolean
  thumbnail: string | null
  gallery: string[]
  autoJoinCriteria: { minSpent: number; minOrders: number }
  sort: number
  isActive: boolean
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

export function normalizeCustomerSegmentInput(input: unknown): CustomerSegmentDraft {
  const source = readRecord(input)
  const code = normalizeCustomerSegmentCode(source.code ?? source.title)
  if (!code) throw new CustomerSegmentInvariantError('CUSTOMER_SEGMENT_CODE_INVALID', 'Segment code is missing or unsafe')
  try {
    return CustomerSegmentDraftSchema.parse({ ...source, code })
  } catch (error) {
    if (error instanceof CustomerSegmentInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new CustomerSegmentInvariantError('CUSTOMER_SEGMENT_PAYLOAD_INVALID', 'Segment payload is invalid')
    }
    throw error
  }
}

const CustomerSegmentMongooseSchema = new Schema<CustomerSegmentDocument>(
  {
    siteId: { type: String, required: true },
    code: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    defaultDiscountPercent: { type: Number, default: 0 },
    freeShipping: { type: Boolean, default: false },
    thumbnail: { type: String, default: null },
    gallery: { type: [String], default: [] },
    autoJoinCriteria: {
      minSpent: { type: Number, default: 0 },
      minOrders: { type: Number, default: 0 },
    },
    sort: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: CUSTOMER_SEGMENT_SCHEMA_VERSION, required: true },
  },
  {
    // Not `customer_segments`: that is the legacy collection still holding
    // unmigrated documents, and the import slice owns it (same reason as
    // `site_menus`).
    collection: 'crm_customer_segments',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

CustomerSegmentMongooseSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'customer_segment_site_code' })
CustomerSegmentMongooseSchema.index({ siteId: 1, sort: 1, code: 1 }, { name: 'customer_segment_site_sort' })

export function customerSegmentModel(connection: Connection): Model<CustomerSegmentDocument> {
  const registered = connection.models.CustomerSegment as Model<CustomerSegmentDocument> | undefined
  if (registered) return registered
  return connection.model<CustomerSegmentDocument>('CustomerSegment', CustomerSegmentMongooseSchema, 'crm_customer_segments')
}

export async function syncCustomerSegmentIndexes(connection: Connection): Promise<void> {
  await customerSegmentModel(connection).createIndexes()
}
