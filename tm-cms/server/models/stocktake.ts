import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

/**
 * A stocktake (INV-02): the physical count of one warehouse against the ledger.
 * Lines carry both the system quantity and the counted quantity, so a completed
 * stocktake explains every adjustment it made instead of silently rewriting a
 * balance. A draft can be edited and cancelled; a completed one is immutable.
 */

export const STOCKTAKE_SCHEMA_VERSION = 1

export const STOCKTAKE_STATUSES = ['draft', 'completed', 'cancelled'] as const
export type StocktakeStatus = (typeof STOCKTAKE_STATUSES)[number]

export class StocktakeInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'StocktakeInvariantError'
    this.code = code
  }
}

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/

export const StocktakeLineSchema = z.object({
  itemId: z.string().trim().min(1).max(64),
  variantId: z.string().trim().max(64).nullable().default(null),
  sku: z.string().trim().max(120).default(''),
  itemName: z.string().trim().max(300).default(''),
  expectedQuantity: z.number().int().min(0).default(0),
  countedQuantity: z.number().int().min(0).default(0),
  difference: z.number().int().default(0),
  note: z.string().trim().max(500).default(''),
})

export type StocktakeLine = z.infer<typeof StocktakeLineSchema>

export const StocktakeDraftSchema = z.object({
  code: z.string().trim().regex(CODE_PATTERN),
  warehouseId: z.string().trim().min(1).max(64),
  note: z.string().trim().max(2000).default(''),
  lines: z.array(StocktakeLineSchema).min(1).max(1000),
})

export type StocktakeDraft = z.infer<typeof StocktakeDraftSchema>

export interface StocktakeDocument {
  siteId: string
  code: string
  warehouseId: string
  status: StocktakeStatus
  lines: StocktakeLine[]
  note: string
  completedAt: Date | null
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

function normalizeLines(value: unknown): StocktakeLine[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => StocktakeLineSchema.parse(readRecord(entry)))
}

export function normalizeStocktakeInput(input: unknown): StocktakeDraft {
  const source = readRecord(input)
  const code = typeof source.code === 'string'
    ? source.code.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '')
    : source.code
  try {
    return StocktakeDraftSchema.parse({
      ...source,
      code: code || undefined,
      lines: normalizeLines(source.lines),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      throw new StocktakeInvariantError('STOCKTAKE_PAYLOAD_INVALID', 'Dữ liệu kiểm kê không hợp lệ')
    }
    throw error
  }
}

const StocktakeLineMongooseSchema = new Schema(
  {
    itemId: { type: String, required: true },
    variantId: { type: String, default: null },
    sku: { type: String, default: '' },
    itemName: { type: String, default: '' },
    expectedQuantity: { type: Number, default: 0, min: 0 },
    countedQuantity: { type: Number, default: 0, min: 0 },
    difference: { type: Number, default: 0 },
    note: { type: String, default: '' },
  },
  { _id: false },
)

const StocktakeMongooseSchema = new Schema<StocktakeDocument>(
  {
    siteId: { type: String, required: true },
    code: { type: String, required: true },
    warehouseId: { type: String, required: true },
    status: { type: String, enum: STOCKTAKE_STATUSES, default: 'draft' },
    lines: { type: [StocktakeLineMongooseSchema], default: [] },
    note: { type: String, default: '' },
    completedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: STOCKTAKE_SCHEMA_VERSION, required: true },
  },
  { collection: 'crm_stocktakes', timestamps: true, versionKey: false, minimize: false },
)

StocktakeMongooseSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'stocktake_site_code' })
StocktakeMongooseSchema.index({ siteId: 1, status: 1, createdAt: -1 }, { name: 'stocktake_site_status' })
StocktakeMongooseSchema.index({ siteId: 1, warehouseId: 1, createdAt: -1 }, { name: 'stocktake_site_warehouse' })

export function stocktakeModel(connection: Connection): Model<StocktakeDocument> {
  const registered = connection.models.Stocktake as Model<StocktakeDocument> | undefined
  if (registered) return registered
  return connection.model<StocktakeDocument>('Stocktake', StocktakeMongooseSchema, 'crm_stocktakes')
}

export async function syncStocktakeIndexes(connection: Connection): Promise<void> {
  await stocktakeModel(connection).createIndexes()
}
