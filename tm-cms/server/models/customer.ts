import { Schema } from 'mongoose'
import type { Connection, Model, Types } from 'mongoose'
import { z } from 'zod'

/**
 * CRM customer. A customer is a business profile, not an identity: the login
 * subject, password and role stay in Hub (ADR 0001), so this document only keeps
 * the Hub subject id plus the commerce-facing facts about that person.
 */

export const CUSTOMER_SCHEMA_VERSION = 1
export const CUSTOMER_ADDRESS_MAX = 10
export const CUSTOMER_NOTE_MAX = 2000

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/
const SUBJECT_PATTERN = /^[A-Za-z0-9._:@-]{1,128}$/

export class CustomerInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CustomerInvariantError'
    this.code = code
  }
}

/** Legacy codes are `CUS…`; anything the editor types is folded to that shape. */
export function normalizeCustomerCode(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '')
}

export const CustomerAddressSchema = z.object({
  fullName: z.string().trim().max(200).default(''),
  phone: z.string().trim().max(40).default(''),
  street: z.string().trim().max(300).default(''),
  ward: z.string().trim().max(120).default(''),
  district: z.string().trim().max(120).default(''),
  city: z.string().trim().max(120).default(''),
  country: z.string().trim().max(120).default(''),
  isDefault: z.boolean().default(false),
  sort: z.number().int().min(0).max(9999).default(0),
})

export type CustomerAddress = z.infer<typeof CustomerAddressSchema>

export const CustomerDraftSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  code: z.string().regex(CODE_PATTERN).max(32),
  /** Hub subject id. Never taken from a request body; the service ignores it. */
  subjectId: z.string().regex(SUBJECT_PATTERN),
  email: z.string().trim().max(200).default(''),
  fullName: z.string().trim().max(200).default(''),
  phone: z.string().trim().max(40).default(''),
  addresses: z.array(CustomerAddressSchema).max(CUSTOMER_ADDRESS_MAX).default([]),
  customerSegmentId: z.string().regex(/^[a-f0-9]{24}$/).nullable().default(null),
  loyaltyPoints: z.number().int().min(0).default(0),
  note: z.string().trim().max(CUSTOMER_NOTE_MAX).default(''),
  isActive: z.boolean().default(true),
}).superRefine((draft, ctx) => {
  const defaults = draft.addresses.filter(address => address.isDefault)
  if (defaults.length > 1) {
    ctx.addIssue({ code: 'custom', path: ['addresses'], message: 'Only one address can be the default' })
  }
})

export type CustomerDraft = z.infer<typeof CustomerDraftSchema>

export interface CustomerMetrics {
  totalOrders: number
  totalSpent: number
  lastOrderAt: Date | null
}

export interface CustomerDocument {
  siteId: string
  code: string
  subjectId: string
  email: string
  fullName: string
  phone: string
  addresses: CustomerAddress[]
  customerSegmentId: Types.ObjectId | null
  loyaltyPoints: number
  metrics: { totalOrders: number; totalSpent: number; lastOrderAt: Date | null }
  note: string
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

/** At most one default address survives normalization: the first one wins. */
function normalizeAddresses(value: unknown): CustomerAddress[] {
  if (!Array.isArray(value)) return []
  let defaultSeen = false
  return value.map((entry) => {
    const address = readRecord(entry)
    const isDefault = address.isDefault === true && !defaultSeen
    if (isDefault) defaultSeen = true
    return CustomerAddressSchema.parse({ ...address, isDefault })
  })
}

export function normalizeCustomerInput(input: unknown): CustomerDraft {
  const source = readRecord(input)
  const code = normalizeCustomerCode(source.code)
  const subjectId = typeof source.subjectId === 'string' ? source.subjectId.trim() : ''
  if (!subjectId) {
    throw new CustomerInvariantError('CUSTOMER_SUBJECT_REQUIRED', 'A customer needs a Hub subject id')
  }
  try {
    return CustomerDraftSchema.parse({
      ...source,
      code,
      subjectId,
      addresses: normalizeAddresses(source.addresses),
    })
  } catch (error) {
    if (error instanceof CustomerInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new CustomerInvariantError('CUSTOMER_PAYLOAD_INVALID', 'Customer payload is invalid')
    }
    throw error
  }
}

const CustomerAddressMongooseSchema = new Schema(
  {
    fullName: { type: String, default: '' },
    phone: { type: String, default: '' },
    street: { type: String, default: '' },
    ward: { type: String, default: '' },
    district: { type: String, default: '' },
    city: { type: String, default: '' },
    country: { type: String, default: '' },
    isDefault: { type: Boolean, default: false },
    sort: { type: Number, default: 0 },
  },
  { _id: false },
)

export const customerSchema = new Schema<CustomerDocument>(
  {
    siteId: { type: String, required: true },
    code: { type: String, required: true },
    subjectId: { type: String, required: true },
    email: { type: String, default: '' },
    fullName: { type: String, default: '' },
    phone: { type: String, default: '' },
    addresses: { type: [CustomerAddressMongooseSchema], default: [] },
    customerSegmentId: { type: Schema.Types.ObjectId, default: null },
    loyaltyPoints: { type: Number, default: 0 },
    metrics: {
      totalOrders: { type: Number, default: 0 },
      totalSpent: { type: Number, default: 0 },
      lastOrderAt: { type: Date, default: null },
    },
    note: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: CUSTOMER_SCHEMA_VERSION, required: true },
  },
  {
    // Not `customers`: the legacy collection still holds unmigrated documents.
    collection: 'crm_customers',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

customerSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'customer_site_code' })
customerSchema.index({ siteId: 1, subjectId: 1 }, { unique: true, name: 'customer_site_subject' })
customerSchema.index({ siteId: 1, customerSegmentId: 1 }, { name: 'customer_site_segment' })
customerSchema.index({ siteId: 1, isDeleted: 1, createdAt: -1 }, { name: 'customer_site_created' })

export function customerModel(connection: Connection): Model<CustomerDocument> {
  const registered = connection.models.Customer as Model<CustomerDocument> | undefined
  if (registered) return registered
  return connection.model<CustomerDocument>('Customer', customerSchema, 'crm_customers')
}

export async function syncCustomerIndexes(connection: Connection): Promise<void> {
  await customerModel(connection).createIndexes()
}
