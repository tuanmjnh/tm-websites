import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

export const ORDER_RETURN_SCHEMA_VERSION = 1

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/

export const ORDER_RETURN_STATUSES = ['draft', 'approved', 'refunded', 'cancelled'] as const
export type OrderReturnStatus = (typeof ORDER_RETURN_STATUSES)[number]

export const OrderReturnItemSchema = z.object({
  itemId: z.string().trim().max(64).nullable().default(null),
  variantId: z.string().trim().max(64).nullable().default(null),
  itemName: z.string().trim().min(1).max(300),
  sku: z.string().trim().max(120).default(''),
  quantity: z.number().int().min(1).max(999999),
  unitPrice: z.number().nonnegative().default(0),
  reason: z.string().trim().max(500).default(''),
})

export type OrderReturnItem = z.infer<typeof OrderReturnItemSchema>

export class OrderReturnInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'OrderReturnInvariantError'
    this.code = code
  }
}

export const OrderReturnDraftSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  code: z.string().regex(CODE_PATTERN).max(32),
  orderId: z.string().trim().min(1).max(64),
  status: z.enum(ORDER_RETURN_STATUSES).default('draft'),
  items: z.array(OrderReturnItemSchema).min(1).max(200),
  refundAmount: z.number().nonnegative().default(0),
  refundMethod: z.enum(['cash', 'card', 'bank', 'credit']).default('cash'),
  note: z.string().trim().max(2000).default(''),
})

export type OrderReturnDraft = z.infer<typeof OrderReturnDraftSchema>

export interface OrderReturnDocument {
  siteId: string
  code: string
  orderId: string
  status: OrderReturnStatus
  items: OrderReturnItem[]
  refundAmount: number
  refundMethod: 'cash' | 'card' | 'bank' | 'credit'
  note: string
  approvedAt: Date | null
  refundedAt: Date | null
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

export function normalizeOrderReturnInput(input: unknown): OrderReturnDraft {
  const source = readRecord(input)
  const code = typeof source.code === 'string' ? source.code.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '') : ''
  try {
    return OrderReturnDraftSchema.parse({ ...source, code: code || undefined })
  } catch (error) {
    if (error instanceof OrderReturnInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new OrderReturnInvariantError('ORDER_RETURN_PAYLOAD_INVALID', 'Order return payload is invalid')
    }
    throw error
  }
}

const OrderReturnMongooseSchema = new Schema<OrderReturnDocument>(
  {
    siteId: { type: String, required: true },
    code: { type: String, required: true },
    orderId: { type: String, required: true },
    status: { type: String, enum: ORDER_RETURN_STATUSES, default: 'draft' },
    items: { type: Schema.Types.Mixed, default: [] },
    refundAmount: { type: Number, default: 0 },
    refundMethod: { type: String, enum: ['cash', 'card', 'bank', 'credit'], default: 'cash' },
    note: { type: String, default: '' },
    approvedAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: ORDER_RETURN_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_order_returns',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

OrderReturnMongooseSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'order_return_site_code' })
OrderReturnMongooseSchema.index({ siteId: 1, orderId: 1, createdAt: -1 }, { name: 'order_return_site_order_created' })
OrderReturnMongooseSchema.index({ siteId: 1, status: 1, createdAt: -1 }, { name: 'order_return_site_status_created' })

export function orderReturnModel(connection: Connection): Model<OrderReturnDocument> {
  const registered = connection.models.OrderReturn as Model<OrderReturnDocument> | undefined
  if (registered) return registered
  return connection.model<OrderReturnDocument>('OrderReturn', OrderReturnMongooseSchema, 'crm_order_returns')
}

export async function syncOrderReturnIndexes(connection: Connection): Promise<void> {
  await orderReturnModel(connection).createIndexes()
}
