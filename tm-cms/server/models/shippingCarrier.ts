import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

export class ShippingCarrierInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ShippingCarrierInvariantError'
    this.code = code
  }
}

export function normalizeShippingCarrierCode(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 64).replace(/-+$/, '')
}

export const ShippingCarrierDraftSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  code: z.string().regex(CODE_PATTERN).max(64),
  name: z.string().trim().min(1).max(200),
  trackingUrl: z.string().trim().max(500).default(''),
  phone: z.string().trim().max(40).default(''),
  note: z.string().trim().max(500).default(''),
  isActive: z.boolean().default(true),
  sort: z.number().int().min(0).default(0),
})

export type ShippingCarrierDraft = z.infer<typeof ShippingCarrierDraftSchema>

export interface ShippingCarrierDocument {
  siteId: string
  code: string
  name: string
  trackingUrl: string
  phone: string
  note: string
  isActive: boolean
  sort: number
  isDeleted: boolean
  deletedAt: Date | null
  revision: number
  createdAt?: Date
  updatedAt?: Date
}

const ShippingCarrierMongooseSchema = new Schema<ShippingCarrierDocument>(
  {
    siteId: { type: String, required: true, index: true },
    code: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    trackingUrl: { type: String, default: '', trim: true, maxlength: 500 },
    phone: { type: String, default: '', trim: true, maxlength: 40 },
    note: { type: String, default: '', trim: true, maxlength: 500 },
    isActive: { type: Boolean, default: true },
    sort: { type: Number, default: 0, min: 0 },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true, collection: 'crm_shipping_carriers' },
)

ShippingCarrierMongooseSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'shipping_carrier_site_code' })
ShippingCarrierMongooseSchema.index({ siteId: 1, isDeleted: 1, sort: 1 }, { name: 'shipping_carrier_site_deleted_sort' })

export function shippingCarrierModel(connection: Connection): Model<ShippingCarrierDocument> {
  const registered = connection.models.ShippingCarrier as Model<ShippingCarrierDocument> | undefined
  if (registered) return registered
  return connection.model<ShippingCarrierDocument>('ShippingCarrier', ShippingCarrierMongooseSchema, 'crm_shipping_carriers')
}

export function syncShippingCarrierIndexes(connection: Connection): Promise<void> {
  return shippingCarrierModel(connection).createIndexes().then(() => undefined)
}

export function normalizeShippingCarrierInput(input: unknown): ShippingCarrierDraft {
  const source = (input ?? {}) as Record<string, unknown>
  try {
    return ShippingCarrierDraftSchema.parse({
      siteId: source.siteId,
      code: normalizeShippingCarrierCode(source.code ?? source.name ?? ''),
      name: source.name ?? source.title ?? '',
      trackingUrl: source.trackingUrl ?? source.tracking_url ?? '',
      phone: source.phone ?? '',
      note: source.note ?? '',
      isActive: source.isActive !== false && source.isDeleted !== true,
      sort: typeof source.sort === 'number' ? source.sort : 0,
    })
  } catch (error) {
    const issue = (error as { issues?: { message?: string }[] })?.issues?.[0]?.message
    throw new ShippingCarrierInvariantError('SHIPPING_CARRIER_PAYLOAD_INVALID', issue ?? 'Invalid shipping carrier payload')
  }
}