import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

export const PAYABLE_STATUSES = ['posted', 'voided'] as const
export type PayableStatus = (typeof PAYABLE_STATUSES)[number]

export const PayableCreateSchema = z.object({
  purchaseOrderId: z.string().min(1),
  purchaseOrderCode: z.string().trim().max(64).default(''),
  supplierId: z.string().nullable().default(null),
  amount: z.number().nonnegative(),
  currency: z.string().trim().max(8).default('VND'),
})

export type PayableCreateInput = z.infer<typeof PayableCreateSchema>

export interface PayableDocument {
  siteId: string
  code: string
  purchaseOrderId: string
  purchaseOrderCode: string
  supplierId: string | null
  amount: number
  currency: string
  status: PayableStatus
  postedAt: Date
  voidedAt: Date | null
  voidReason: string
  isDeleted: boolean
  deletedAt: Date | null
  revision: number
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

const PAYABLE_SCHEMA_VERSION = 1

const PayableMongooseSchema = new Schema<PayableDocument>(
  {
    siteId: { type: String, required: true },
    code: { type: String, required: true },
    purchaseOrderId: { type: String, required: true },
    purchaseOrderCode: { type: String, default: '' },
    supplierId: { type: String, default: null },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'VND' },
    status: { type: String, enum: PAYABLE_STATUSES, default: 'posted', required: true },
    postedAt: { type: Date, default: () => new Date() },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, default: '' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: PAYABLE_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_payables',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

PayableMongooseSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'payable_site_code' })
PayableMongooseSchema.index({ siteId: 1, purchaseOrderId: 1 }, { unique: true, name: 'payable_site_po' })
PayableMongooseSchema.index({ siteId: 1, status: 1, postedAt: -1 }, { name: 'payable_site_status_posted' })

export function payableModel(connection: Connection): Model<PayableDocument> {
  const registered = connection.models.Payable as Model<PayableDocument> | undefined
  if (registered) return registered
  return connection.model<PayableDocument>('Payable', PayableMongooseSchema, 'crm_payables')
}

export async function syncPayableIndexes(connection: Connection): Promise<void> {
  await payableModel(connection).createIndexes()
}