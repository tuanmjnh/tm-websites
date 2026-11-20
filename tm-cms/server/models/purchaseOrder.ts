import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

export const PURCHASE_ORDER_SCHEMA_VERSION = 1

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/

export const PURCHASE_ORDER_STATUSES = ['draft', 'ordered', 'partial', 'received', 'cancelled'] as const
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number]
export const PURCHASE_PAYMENT_STATUSES = ['unpaid', 'paid', 'partial', 'refunded'] as const
export type PurchasePaymentStatus = (typeof PURCHASE_PAYMENT_STATUSES)[number]
export const PURCHASE_PAYMENT_METHODS = ['cash', 'banking', 'cod', 'card', 'other'] as const
export type PurchasePaymentMethod = (typeof PURCHASE_PAYMENT_METHODS)[number]

export class PurchaseOrderInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'PurchaseOrderInvariantError'
    this.code = code
  }
}

export function normalizePurchaseOrderCode(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '')
}

export const PurchaseOrderItemSchema = z.object({
  itemId: z.string().trim().max(64).nullable().default(null),
  variantId: z.string().trim().max(64).nullable().default(null),
  itemName: z.string().trim().min(1).max(300),
  sku: z.string().trim().max(120).default(''),
  quantity: z.number().int().min(1).max(999999),
  unitCost: z.number().nonnegative(),
  receivedQuantity: z.number().int().min(0).default(0),
  rejectedQuantity: z.number().int().min(0).default(0),
  note: z.string().trim().max(500).default(''),
})

export type PurchaseOrderItem = z.infer<typeof PurchaseOrderItemSchema>

export const PurchaseOrderDraftSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  code: z.string().regex(CODE_PATTERN).max(32),
  supplierId: z.string().trim().max(64).nullable().default(null),
  warehouseId: z.string().trim().max(64).nullable().default(null),
  status: z.enum(PURCHASE_ORDER_STATUSES).default('draft'),
  paymentStatus: z.enum(PURCHASE_PAYMENT_STATUSES).default('unpaid'),
  paymentMethod: z.enum(PURCHASE_PAYMENT_METHODS).default('cash'),
  items: z.array(PurchaseOrderItemSchema).min(1).max(200),
  totalAmount: z.number().nonnegative().default(0),
  orderedTotalAmount: z.number().nonnegative().default(0),
  paidAmount: z.number().nonnegative().default(0),
  expectedDeliveryDate: z.string().trim().max(64).nullable().default(null),
  reconcileNote: z.string().trim().max(2000).default(''),
  note: z.string().trim().max(2000).default(''),
})

export type PurchaseOrderDraft = z.infer<typeof PurchaseOrderDraftSchema>

export interface PurchaseOrderDocument {
  siteId: string
  code: string
  supplierId: string | null
  warehouseId: string | null
  status: PurchaseOrderStatus
  paymentStatus: PurchasePaymentStatus
  paymentMethod: PurchasePaymentMethod
  items: PurchaseOrderItem[]
  totalAmount: number
  orderedTotalAmount: number
  paidAmount: number
  expectedDeliveryDate: string | null
  reconcileNote: string
  note: string
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

function normalizeItems(value: unknown): PurchaseOrderItem[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => PurchaseOrderItemSchema.parse(readRecord(entry)))
}

export function normalizePurchaseOrderInput(input: unknown): PurchaseOrderDraft {
  const source = readRecord(input)
  const code = normalizePurchaseOrderCode(source.code)
  try {
    return PurchaseOrderDraftSchema.parse({
      ...source,
      code: code || undefined,
      items: normalizeItems(source.items),
    })
  } catch (error) {
    if (error instanceof PurchaseOrderInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new PurchaseOrderInvariantError('PURCHASE_ORDER_PAYLOAD_INVALID', 'Purchase order payload is invalid')
    }
    throw error
  }
}

const PurchaseOrderItemMongooseSchema = new Schema(
  {
    itemId: { type: String, default: null },
    variantId: { type: String, default: null },
    itemName: { type: String, required: true },
    sku: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 1 },
    unitCost: { type: Number, required: true, min: 0 },
    receivedQuantity: { type: Number, default: 0, min: 0 },
    rejectedQuantity: { type: Number, default: 0, min: 0 },
    note: { type: String, default: '' },
  },
  { _id: false },
)

export const purchaseOrderSchema = new Schema<PurchaseOrderDocument>(
  {
    siteId: { type: String, required: true },
    code: { type: String, required: true },
    supplierId: { type: String, default: null },
    warehouseId: { type: String, default: null },
    status: { type: String, enum: PURCHASE_ORDER_STATUSES, default: 'draft' },
    paymentStatus: { type: String, enum: PURCHASE_PAYMENT_STATUSES, default: 'unpaid' },
    paymentMethod: { type: String, enum: PURCHASE_PAYMENT_METHODS, default: 'cash' },
    items: { type: [PurchaseOrderItemMongooseSchema], default: [] },
    totalAmount: { type: Number, default: 0 },
    orderedTotalAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    expectedDeliveryDate: { type: String, default: null },
    reconcileNote: { type: String, default: '' },
    note: { type: String, default: '' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: PURCHASE_ORDER_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_purchase_orders',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

purchaseOrderSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'purchase_order_site_code' })
purchaseOrderSchema.index({ siteId: 1, supplierId: 1, createdAt: -1 }, { name: 'purchase_order_site_supplier_created' })
purchaseOrderSchema.index({ siteId: 1, status: 1, createdAt: -1 }, { name: 'purchase_order_site_status_created' })
purchaseOrderSchema.index({ siteId: 1, isDeleted: 1, createdAt: -1 }, { name: 'purchase_order_site_created' })

export function purchaseOrderModel(connection: Connection): Model<PurchaseOrderDocument> {
  const registered = connection.models.PurchaseOrder as Model<PurchaseOrderDocument> | undefined
  if (registered) return registered
  return connection.model<PurchaseOrderDocument>('PurchaseOrder', purchaseOrderSchema, 'crm_purchase_orders')
}

export async function syncPurchaseOrderIndexes(connection: Connection): Promise<void> {
  await purchaseOrderModel(connection).createIndexes()
}
