import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

export const SUPPLIER_SCHEMA_VERSION = 1

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/

export const SUPPLIER_STATUSES = ['active', 'inactive'] as const
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number]

export class SupplierInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'SupplierInvariantError'
    this.code = code
  }
}

export function normalizeSupplierCode(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '')
}

export const SupplierDraftSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  code: z.string().regex(CODE_PATTERN).max(32),
  title: z.string().trim().min(1).max(200),
  email: z.string().trim().max(200).default(''),
  phone: z.string().trim().max(40).default(''),
  status: z.enum(SUPPLIER_STATUSES).default('active'),
  rating: z.number().min(0).max(5).default(0),
  itemsSupplied: z.array(z.string().trim().max(64)).max(500).default([]),
  avatar: z.string().trim().max(500).nullable().default(null),
  note: z.string().trim().max(2000).default(''),
})

export type SupplierDraft = z.infer<typeof SupplierDraftSchema>

export interface SupplierDocument {
  siteId: string
  code: string
  title: string
  email: string
  phone: string
  status: SupplierStatus
  rating: number
  itemsSupplied: string[]
  avatar: string | null
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

export function normalizeSupplierInput(input: unknown): SupplierDraft {
  const source = readRecord(input)
  const code = normalizeSupplierCode(source.code)
  try {
    return SupplierDraftSchema.parse({ ...source, code: code || undefined })
  } catch (error) {
    if (error instanceof SupplierInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new SupplierInvariantError('SUPPLIER_PAYLOAD_INVALID', 'Supplier payload is invalid')
    }
    throw error
  }
}

const SupplierMongooseSchema = new Schema<SupplierDocument>(
  {
    siteId: { type: String, required: true },
    code: { type: String, required: true },
    title: { type: String, required: true },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    status: { type: String, enum: SUPPLIER_STATUSES, default: 'active' },
    rating: { type: Number, default: 0 },
    itemsSupplied: { type: [String], default: [] },
    avatar: { type: String, default: null },
    note: { type: String, default: '' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: SUPPLIER_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_suppliers',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

SupplierMongooseSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'supplier_site_code' })
SupplierMongooseSchema.index({ siteId: 1, isDeleted: 1, createdAt: -1 }, { name: 'supplier_site_created' })

export function supplierModel(connection: Connection): Model<SupplierDocument> {
  const registered = connection.models.Supplier as Model<SupplierDocument> | undefined
  if (registered) return registered
  return connection.model<SupplierDocument>('Supplier', SupplierMongooseSchema, 'crm_suppliers')
}

export async function syncSupplierIndexes(connection: Connection): Promise<void> {
  await supplierModel(connection).createIndexes()
}
