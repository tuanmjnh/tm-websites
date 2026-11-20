import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

export const SHIPMENT_SCHEMA_VERSION = 1

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/

export const SHIPMENT_STATUSES = ['draft', 'shipped', 'in_transit', 'delivered', 'returned', 'cancelled'] as const
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number]

export const ShipmentItemSchema = z.object({
  itemId: z.string().trim().max(64).nullable().default(null),
  variantId: z.string().trim().max(64).nullable().default(null),
  itemName: z.string().trim().min(1).max(300),
  sku: z.string().trim().max(120).default(''),
  quantity: z.number().int().min(1).max(999999),
  /** Optional IMEI/serial numbers shipped with this line. */
  serials: z.array(z.string().trim().min(1).max(120)).max(1000).default([]),
})

export type ShipmentItem = z.infer<typeof ShipmentItemSchema>

export class ShipmentInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ShipmentInvariantError'
    this.code = code
  }
}

export const ShipmentDraftSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  code: z.string().regex(CODE_PATTERN).max(32),
  orderId: z.string().trim().min(1).max(64),
  status: z.enum(SHIPMENT_STATUSES).default('draft'),
  carrier: z.string().trim().max(120).default(''),
  trackingNumber: z.string().trim().max(200).default(''),
  items: z.array(ShipmentItemSchema).min(1).max(200),
  shippingAddress: z.record(z.string(), z.string()).default({}),
  note: z.string().trim().max(2000).default(''),
})

export type ShipmentDraft = z.infer<typeof ShipmentDraftSchema>

export interface ShipmentDocument {
  siteId: string
  code: string
  orderId: string
  status: ShipmentStatus
  carrier: string
  trackingNumber: string
  items: ShipmentItem[]
  shippingAddress: Record<string, string>
  note: string
  shippedAt: Date | null
  deliveredAt: Date | null
  cancelledAt: Date | null
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

export function normalizeShipmentInput(input: unknown): ShipmentDraft {
  const source = readRecord(input)
  const code = typeof source.code === 'string' ? source.code.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '') : ''
  try {
    return ShipmentDraftSchema.parse({ ...source, code: code || undefined })
  } catch (error) {
    if (error instanceof ShipmentInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new ShipmentInvariantError('SHIPMENT_PAYLOAD_INVALID', 'Shipment payload is invalid')
    }
    throw error
  }
}

const ShipmentMongooseSchema = new Schema<ShipmentDocument>(
  {
    siteId: { type: String, required: true },
    code: { type: String, required: true },
    orderId: { type: String, required: true },
    status: { type: String, enum: SHIPMENT_STATUSES, default: 'draft' },
    carrier: { type: String, default: '' },
    trackingNumber: { type: String, default: '' },
    items: { type: Schema.Types.Mixed, default: [] },
    shippingAddress: { type: Schema.Types.Mixed, default: {} },
    note: { type: String, default: '' },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: SHIPMENT_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_shipments',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

ShipmentMongooseSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'shipment_site_code' })
ShipmentMongooseSchema.index({ siteId: 1, orderId: 1, createdAt: -1 }, { name: 'shipment_site_order_created' })
ShipmentMongooseSchema.index({ siteId: 1, status: 1, createdAt: -1 }, { name: 'shipment_site_status_created' })

export function shipmentModel(connection: Connection): Model<ShipmentDocument> {
  const registered = connection.models.Shipment as Model<ShipmentDocument> | undefined
  if (registered) return registered
  return connection.model<ShipmentDocument>('Shipment', ShipmentMongooseSchema, 'crm_shipments')
}

export async function syncShipmentIndexes(connection: Connection): Promise<void> {
  await shipmentModel(connection).createIndexes()
}
