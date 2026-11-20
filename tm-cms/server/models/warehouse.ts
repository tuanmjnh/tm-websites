import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

export const WAREHOUSE_SCHEMA_VERSION = 1

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/

export const WAREHOUSE_STATUSES = ['active', 'inactive'] as const
export type WarehouseStatus = (typeof WAREHOUSE_STATUSES)[number]

export class WarehouseInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'WarehouseInvariantError'
    this.code = code
  }
}

export function normalizeWarehouseCode(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '')
}

export const WarehouseDraftSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  code: z.string().regex(CODE_PATTERN).max(32),
  title: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).default(''),
  phone: z.string().trim().max(40).default(''),
  status: z.enum(WAREHOUSE_STATUSES).default('active'),
  description: z.string().trim().max(2000).default(''),
  avatar: z.string().trim().max(500).nullable().default(null),
  sort: z.number().int().min(0).max(9999).default(0),
})

export type WarehouseDraft = z.infer<typeof WarehouseDraftSchema>

export interface WarehouseDocument {
  siteId: string
  code: string
  title: string
  address: string
  phone: string
  status: WarehouseStatus
  description: string
  avatar: string | null
  sort: number
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

export function normalizeWarehouseInput(input: unknown): WarehouseDraft {
  const source = readRecord(input)
  const code = normalizeWarehouseCode(source.code)
  try {
    return WarehouseDraftSchema.parse({ ...source, code: code || undefined })
  } catch (error) {
    if (error instanceof WarehouseInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new WarehouseInvariantError('WAREHOUSE_PAYLOAD_INVALID', 'Warehouse payload is invalid')
    }
    throw error
  }
}

const WarehouseMongooseSchema = new Schema<WarehouseDocument>(
  {
    siteId: { type: String, required: true },
    code: { type: String, required: true },
    title: { type: String, required: true },
    address: { type: String, default: '' },
    phone: { type: String, default: '' },
    status: { type: String, enum: WAREHOUSE_STATUSES, default: 'active' },
    description: { type: String, default: '' },
    avatar: { type: String, default: null },
    sort: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: WAREHOUSE_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_warehouses',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

WarehouseMongooseSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'warehouse_site_code' })
WarehouseMongooseSchema.index({ siteId: 1, isDeleted: 1, createdAt: -1 }, { name: 'warehouse_site_created' })

export function warehouseModel(connection: Connection): Model<WarehouseDocument> {
  const registered = connection.models.Warehouse as Model<WarehouseDocument> | undefined
  if (registered) return registered
  return connection.model<WarehouseDocument>('Warehouse', WarehouseMongooseSchema, 'crm_warehouses')
}

export async function syncWarehouseIndexes(connection: Connection): Promise<void> {
  await warehouseModel(connection).createIndexes()
}
