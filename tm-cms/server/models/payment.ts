import { Schema } from 'mongoose'
import type { Connection, Model, Types } from 'mongoose'
import { z } from 'zod'

export const PAYMENT_SCHEMA_VERSION = 1

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/

/** Who owes what: a customer paying an order, or us paying a supplier. */
export const PAYMENT_DIRECTIONS = ['receivable', 'payable'] as const
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number]

/** The document the money is applied to. */
export const PAYMENT_REFERENCES = ['Order', 'PurchaseOrder'] as const
export type PaymentReference = (typeof PAYMENT_REFERENCES)[number]

export const PAYMENT_METHODS = ['cash', 'banking', 'cod', 'card', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/**
 * A posted payment is money that moved. It is never deleted: voiding keeps the
 * row for the ledger and reverses its effect on the document it paid.
 */
export const PAYMENT_STATES = ['posted', 'voided'] as const
export type PaymentState = (typeof PAYMENT_STATES)[number]

export class PaymentInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'PaymentInvariantError'
    this.code = code
  }
}

export function normalizePaymentCode(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '')
}

export const PaymentDraftSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  code: z.string().regex(CODE_PATTERN).max(32),
  direction: z.enum(PAYMENT_DIRECTIONS),
  referenceModel: z.enum(PAYMENT_REFERENCES),
  referenceCode: z.string().trim().max(40).default(''),
  amount: z.number().positive().max(99_999_999_999),
  currency: z.string().regex(/^[A-Z]{3}$/).default('VND'),
  method: z.enum(PAYMENT_METHODS).default('cash'),
  note: z.string().trim().max(1000).default(''),
  paidAt: z.date(),
})

export type PaymentDraft = z.infer<typeof PaymentDraftSchema>

export interface PaymentDocument {
  siteId: string
  code: string
  direction: PaymentDirection
  referenceModel: PaymentReference
  referenceId: Types.ObjectId
  referenceCode: string
  partyId: Types.ObjectId | null
  amount: number
  currency: string
  method: PaymentMethod
  state: PaymentState
  note: string
  paidAt: Date
  performerId: string | null
  voidedAt: Date | null
  voidedBy: string | null
  voidReason: string
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

export function normalizePaymentInput(input: unknown, now: Date = new Date()): PaymentDraft {
  const source = readRecord(input)
  const code = normalizePaymentCode(source.code)
  const paidAt = source.paidAt instanceof Date ? source.paidAt : (now)
  try {
    return PaymentDraftSchema.parse({ ...source, code: code || undefined, paidAt })
  } catch (error) {
    if (error instanceof PaymentInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new PaymentInvariantError('PAYMENT_PAYLOAD_INVALID', 'Payment payload is invalid')
    }
    throw error
  }
}

const PaymentMongooseSchema = new Schema<PaymentDocument>(
  {
    siteId: { type: String, required: true },
    code: { type: String, required: true },
    direction: { type: String, enum: PAYMENT_DIRECTIONS, required: true },
    referenceModel: { type: String, enum: PAYMENT_REFERENCES, required: true },
    referenceId: { type: Schema.Types.ObjectId, required: true },
    referenceCode: { type: String, default: '' },
    partyId: { type: Schema.Types.ObjectId, default: null },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'VND' },
    method: { type: String, enum: PAYMENT_METHODS, default: 'cash' },
    state: { type: String, enum: PAYMENT_STATES, default: 'posted' },
    note: { type: String, default: '' },
    paidAt: { type: Date, required: true },
    performerId: { type: String, default: null },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: String, default: null },
    voidReason: { type: String, default: '' },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: PAYMENT_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_payments',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

PaymentMongooseSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'payment_site_code' })
PaymentMongooseSchema.index({ siteId: 1, referenceModel: 1, referenceId: 1 }, { name: 'payment_site_reference' })
PaymentMongooseSchema.index({ siteId: 1, direction: 1, state: 1, paidAt: -1 }, { name: 'payment_site_direction_state' })
PaymentMongooseSchema.index({ siteId: 1, partyId: 1, paidAt: -1 }, { name: 'payment_site_party' })

export function paymentModel(connection: Connection): Model<PaymentDocument> {
  const registered = connection.models.Payment as Model<PaymentDocument> | undefined
  if (registered) return registered
  return connection.model<PaymentDocument>('Payment', PaymentMongooseSchema, 'crm_payments')
}

export async function syncPaymentIndexes(connection: Connection): Promise<void> {
  await paymentModel(connection).createIndexes()
}
