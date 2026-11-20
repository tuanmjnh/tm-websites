import { Schema } from 'mongoose'
import type { Connection, Model, Types } from 'mongoose'
import { z } from 'zod'

export const QUOTATION_SCHEMA_VERSION = 1

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/
const CURRENCY_PATTERN = /^[A-Z]{3}$/i

export const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'] as const
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number]
export const QUOTATION_CHANNELS = ['admin', 'portal'] as const
export type QuotationChannel = (typeof QUOTATION_CHANNELS)[number]

export class QuotationInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'QuotationInvariantError'
    this.code = code
  }
}

export function normalizeQuotationCode(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '')
}

export const QuotationAddressSchema = z.object({
  fullName: z.string().trim().max(200).default(''),
  phone: z.string().trim().max(40).default(''),
  street: z.string().trim().max(300).default(''),
  ward: z.string().trim().max(120).default(''),
  district: z.string().trim().max(120).default(''),
  city: z.string().trim().max(120).default(''),
  country: z.string().trim().max(120).default(''),
})

export type QuotationAddress = z.infer<typeof QuotationAddressSchema>

export const QuotationItemSchema = z.object({
  itemId: z.string().trim().max(64).nullable().default(null),
  variantId: z.string().trim().max(64).nullable().default(null),
  itemName: z.string().trim().min(1).max(300),
  sku: z.string().trim().max(120).default(''),
  attributes: z.record(z.string(), z.string()).default({}),
  price: z.number().nonnegative(),
  quantity: z.number().int().min(1).max(999999),
  thumbnail: z.string().trim().max(500).nullable().default(null),
})

export type QuotationItem = z.infer<typeof QuotationItemSchema>

export const QuotationDraftSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  code: z.string().regex(CODE_PATTERN).max(32),
  customerId: z.string().regex(/^[a-f0-9]{24}$/).nullable().default(null),
  userId: z.string().trim().max(128).default(''),
  channel: z.enum(QUOTATION_CHANNELS).default('admin'),
  status: z.enum(QUOTATION_STATUSES).default('draft'),
  currency: z.string().trim().regex(CURRENCY_PATTERN).default('VND'),
  items: z.array(QuotationItemSchema).min(1).max(200),
  itemsPrice: z.number().nonnegative().default(0),
  shippingFee: z.number().nonnegative().default(0),
  discountAmount: z.number().nonnegative().default(0),
  totalAmount: z.number().nonnegative().default(0),
  shippingAddress: QuotationAddressSchema.default({ fullName: '', phone: '', street: '', ward: '', district: '', city: '', country: '' }),
  adminNote: z.string().trim().max(2000).default(''),
  customerNote: z.string().trim().max(2000).default(''),
  internalNote: z.string().trim().max(2000).default(''),
  assignedStaffId: z.string().trim().max(128).nullable().default(null),
  warehouseId: z.string().trim().max(64).nullable().default(null),
  validUntil: z.number().int().min(0).nullable().default(null),
  convertedOrderId: z.string().regex(/^[a-f0-9]{24}$/).nullable().default(null),
  estimatedCost: z.number().nonnegative().default(0),
  estimatedProfit: z.number().default(0),
  version: z.number().int().min(1).default(1),
})

export type QuotationDraft = z.infer<typeof QuotationDraftSchema>

export interface QuotationDocument {
  siteId: string
  code: string
  customerId: Types.ObjectId | null
  userId: string
  channel: QuotationChannel
  status: QuotationStatus
  currency: string
  items: QuotationItem[]
  itemsPrice: number
  shippingFee: number
  discountAmount: number
  totalAmount: number
  shippingAddress: QuotationAddress
  adminNote: string
  customerNote: string
  internalNote: string
  assignedStaffId: string | null
  warehouseId: string | null
  validUntil: number | null
  convertedOrderId: Types.ObjectId | null
  estimatedCost: number
  estimatedProfit: number
  version: number
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

function normalizeItems(value: unknown): QuotationItem[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => QuotationItemSchema.parse(readRecord(entry)))
}

export function normalizeQuotationInput(input: unknown): QuotationDraft {
  const source = readRecord(input)
  const code = normalizeQuotationCode(source.code)
  try {
    return QuotationDraftSchema.parse({
      ...source,
      code: code || undefined,
      items: normalizeItems(source.items),
    })
  } catch (error) {
    if (error instanceof QuotationInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new QuotationInvariantError('QUOTATION_PAYLOAD_INVALID', 'Quotation payload is invalid')
    }
    throw error
  }
}

const QuotationItemMongooseSchema = new Schema(
  {
    itemId: { type: String, default: null },
    variantId: { type: String, default: null },
    itemName: { type: String, required: true },
    sku: { type: String, default: '' },
    attributes: { type: Schema.Types.Mixed, default: {} },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    thumbnail: { type: String, default: null },
  },
  { _id: false },
)

const QuotationAddressMongooseSchema = new Schema(
  {
    fullName: { type: String, default: '' },
    phone: { type: String, default: '' },
    street: { type: String, default: '' },
    ward: { type: String, default: '' },
    district: { type: String, default: '' },
    city: { type: String, default: '' },
    country: { type: String, default: '' },
  },
  { _id: false },
)

export const quotationSchema = new Schema<QuotationDocument>(
  {
    siteId: { type: String, required: true },
    code: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, default: null },
    userId: { type: String, default: '' },
    channel: { type: String, enum: QUOTATION_CHANNELS, default: 'admin' },
    status: { type: String, enum: QUOTATION_STATUSES, default: 'draft' },
    currency: { type: String, default: 'VND' },
    items: { type: [QuotationItemMongooseSchema], default: [] },
    itemsPrice: { type: Number, default: 0 },
    shippingFee: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    shippingAddress: { type: QuotationAddressMongooseSchema, default: {} },
    adminNote: { type: String, default: '' },
    customerNote: { type: String, default: '' },
    internalNote: { type: String, default: '' },
    assignedStaffId: { type: String, default: null },
    warehouseId: { type: String, default: null },
    validUntil: { type: Number, default: null },
    convertedOrderId: { type: Schema.Types.ObjectId, default: null },
    estimatedCost: { type: Number, default: 0 },
    estimatedProfit: { type: Number, default: 0 },
    version: { type: Number, default: 1 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: QUOTATION_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_quotations',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

quotationSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'quotation_site_code' })
quotationSchema.index({ siteId: 1, customerId: 1, createdAt: -1 }, { name: 'quotation_site_customer_created' })
quotationSchema.index({ siteId: 1, status: 1, createdAt: -1 }, { name: 'quotation_site_status_created' })
quotationSchema.index({ siteId: 1, isDeleted: 1, createdAt: -1 }, { name: 'quotation_site_created' })

export function quotationModel(connection: Connection): Model<QuotationDocument> {
  const registered = connection.models.Quotation as Model<QuotationDocument> | undefined
  if (registered) return registered
  return connection.model<QuotationDocument>('Quotation', quotationSchema, 'crm_quotations')
}

export async function syncQuotationIndexes(connection: Connection): Promise<void> {
  await quotationModel(connection).createIndexes()
}
