import { Schema } from 'mongoose'
import type { Connection, Model, Types } from 'mongoose'
import { z } from 'zod'

export const ORDER_SCHEMA_VERSION = 1

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/
const CURRENCY_PATTERN = /^[A-Z]{3}$/i

export const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'completed', 'cancelled'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]
export const PAYMENT_STATUSES = ['unpaid', 'paid', 'partial', 'refunded'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]
export const PAYMENT_METHODS = ['cash', 'banking', 'cod', 'card', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export const ORDER_CHANNELS = ['admin', 'portal', 'pos'] as const
export type OrderChannel = (typeof ORDER_CHANNELS)[number]

export class OrderInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'OrderInvariantError'
    this.code = code
  }
}

export function normalizeOrderCode(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '')
}

export const OrderAddressSchema = z.object({
  fullName: z.string().trim().max(200).default(''),
  phone: z.string().trim().max(40).default(''),
  street: z.string().trim().max(300).default(''),
  ward: z.string().trim().max(120).default(''),
  district: z.string().trim().max(120).default(''),
  city: z.string().trim().max(120).default(''),
  country: z.string().trim().max(120).default(''),
})

export type OrderAddress = z.infer<typeof OrderAddressSchema>

export const OrderItemSchema = z.object({
  itemId: z.string().trim().max(64).nullable().default(null),
  variantId: z.string().trim().max(64).nullable().default(null),
  supplierId: z.string().trim().max(64).nullable().default(null),
  itemName: z.string().trim().min(1).max(300),
  sku: z.string().trim().max(120).default(''),
  attributes: z.record(z.string(), z.string()).default({}),
  price: z.number().nonnegative(),
  quantity: z.number().int().min(1).max(999999),
  thumbnail: z.string().trim().max(500).nullable().default(null),
  returnedQuantity: z.number().int().min(0).default(0),
})

export type OrderItem = z.infer<typeof OrderItemSchema>

export const OrderHistoryEntrySchema = z.object({
  status: z.enum(ORDER_STATUSES),
  at: z.string(),
  note: z.string().trim().max(500).default(''),
  actorId: z.string().trim().max(128).default(''),
})

export type OrderHistoryEntry = z.infer<typeof OrderHistoryEntrySchema>

export const OrderDraftSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  code: z.string().regex(CODE_PATTERN).max(32),
  customerId: z.string().regex(/^[a-f0-9]{24}$/).nullable().default(null),
  channel: z.enum(ORDER_CHANNELS).default('admin'),
  status: z.enum(ORDER_STATUSES).default('pending'),
  paymentStatus: z.enum(PAYMENT_STATUSES).default('unpaid'),
  paymentMethod: z.enum(PAYMENT_METHODS).default('cash'),
  currency: z.string().trim().regex(CURRENCY_PATTERN).default('VND'),
  items: z.array(OrderItemSchema).min(1).max(200),
  itemsPrice: z.number().nonnegative().default(0),
  shippingFee: z.number().nonnegative().default(0),
  discountAmount: z.number().nonnegative().default(0),
  totalAmount: z.number().nonnegative().default(0),
  paidAmount: z.number().nonnegative().default(0),
  shippingAddress: OrderAddressSchema.default({ fullName: '', phone: '', street: '', ward: '', district: '', city: '', country: '' }),
  note: z.string().trim().max(2000).default(''),
  warehouseId: z.string().trim().max(64).nullable().default(null),
  history: z.array(OrderHistoryEntrySchema).default([]),
})

export type OrderDraft = z.infer<typeof OrderDraftSchema>

export interface OrderDocument {
  siteId: string
  code: string
  customerId: Types.ObjectId | null
  /**
   * Where checkout sent the order's mail. Written by the storefront, read by
   * the status notification; a CMS-created order leaves it empty.
   */
  customerEmail: string
  channel: OrderChannel
  status: OrderStatus
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod
  currency: string
  items: OrderItem[]
  itemsPrice: number
  shippingFee: number
  discountAmount: number
  totalAmount: number
  paidAmount: number
  shippingAddress: OrderAddress
  note: string
  warehouseId: string | null
  history: OrderHistoryEntry[]
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

function normalizeItems(value: unknown): OrderItem[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => OrderItemSchema.parse(readRecord(entry)))
}

export function normalizeOrderInput(input: unknown): OrderDraft {
  const source = readRecord(input)
  const code = normalizeOrderCode(source.code)
  try {
    return OrderDraftSchema.parse({
      ...source,
      code: code || undefined,
      items: normalizeItems(source.items),
    })
  } catch (error) {
    if (error instanceof OrderInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new OrderInvariantError('ORDER_PAYLOAD_INVALID', 'Order payload is invalid')
    }
    throw error
  }
}

const OrderItemMongooseSchema = new Schema(
  {
    itemId: { type: String, default: null },
    variantId: { type: String, default: null },
    supplierId: { type: String, default: null },
    itemName: { type: String, required: true },
    sku: { type: String, default: '' },
    attributes: { type: Schema.Types.Mixed, default: {} },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    thumbnail: { type: String, default: null },
    returnedQuantity: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
)

const OrderAddressMongooseSchema = new Schema(
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

const OrderHistoryMongooseSchema = new Schema(
  {
    status: { type: String, enum: ORDER_STATUSES, required: true },
    at: { type: String, required: true },
    note: { type: String, default: '' },
    actorId: { type: String, default: '' },
  },
  { _id: false },
)

export const orderSchema = new Schema<OrderDocument>(
  {
    siteId: { type: String, required: true },
    code: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, default: null },
    customerEmail: { type: String, default: '' },
    channel: { type: String, enum: ORDER_CHANNELS, default: 'admin' },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending' },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'unpaid' },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'cash' },
    currency: { type: String, default: 'VND' },
    items: { type: [OrderItemMongooseSchema], default: [] },
    itemsPrice: { type: Number, default: 0 },
    shippingFee: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    shippingAddress: { type: OrderAddressMongooseSchema, default: {} },
    note: { type: String, default: '' },
    warehouseId: { type: String, default: null },
    history: { type: [OrderHistoryMongooseSchema], default: [] },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: ORDER_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_orders',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

orderSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'order_site_code' })
orderSchema.index({ siteId: 1, customerId: 1, createdAt: -1 }, { name: 'order_site_customer_created' })
orderSchema.index({ siteId: 1, status: 1, createdAt: -1 }, { name: 'order_site_status_created' })
orderSchema.index({ siteId: 1, isDeleted: 1, createdAt: -1 }, { name: 'order_site_created' })

export function orderModel(connection: Connection): Model<OrderDocument> {
  const registered = connection.models.Order as Model<OrderDocument> | undefined
  if (registered) return registered
  return connection.model<OrderDocument>('Order', orderSchema, 'crm_orders')
}

export async function syncOrderIndexes(connection: Connection): Promise<void> {
  await orderModel(connection).createIndexes()
}
