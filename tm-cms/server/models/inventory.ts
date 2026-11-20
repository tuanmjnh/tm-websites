import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

export const INVENTORY_SCHEMA_VERSION = 1

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

export class InventoryInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'InventoryInvariantError'
    this.code = code
  }
}

export const InventoryDraftSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  itemId: z.string().trim().min(1).max(64),
  variantId: z.string().trim().max(64).nullable().default(null),
  warehouseId: z.string().trim().min(1).max(64),
  sku: z.string().trim().max(120).default(''),
  quantityOnHand: z.number().int().min(0).default(0),
  quantityReserved: z.number().int().min(0).default(0),
  binLocation: z.string().trim().max(120).default(''),
  lowStockThreshold: z.number().int().min(0).default(0),
})

export type InventoryDraft = z.infer<typeof InventoryDraftSchema>

export interface InventoryDocument {
  siteId: string
  itemId: string
  variantId: string | null
  warehouseId: string
  sku: string
  quantityOnHand: number
  quantityReserved: number
  binLocation: string
  lowStockThreshold: number
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

export function normalizeInventoryInput(input: unknown): InventoryDraft {
  const source = readRecord(input)
  try {
    return InventoryDraftSchema.parse(source)
  } catch (error) {
    if (error instanceof InventoryInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new InventoryInvariantError('INVENTORY_PAYLOAD_INVALID', 'Inventory payload is invalid')
    }
    throw error
  }
}

const InventoryMongooseSchema = new Schema<InventoryDocument>(
  {
    siteId: { type: String, required: true },
    itemId: { type: String, required: true },
    variantId: { type: String, default: null },
    warehouseId: { type: String, required: true },
    sku: { type: String, default: '' },
    quantityOnHand: { type: Number, default: 0, min: 0 },
    quantityReserved: { type: Number, default: 0, min: 0 },
    binLocation: { type: String, default: '' },
    lowStockThreshold: { type: Number, default: 0, min: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: INVENTORY_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_inventories',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

InventoryMongooseSchema.index({ siteId: 1, itemId: 1, variantId: 1, warehouseId: 1 }, { unique: true, name: 'inventory_site_item_variant_warehouse' })
InventoryMongooseSchema.index({ siteId: 1, warehouseId: 1, createdAt: -1 }, { name: 'inventory_site_warehouse_created' })
InventoryMongooseSchema.index({ siteId: 1, itemId: 1 }, { name: 'inventory_site_item' })

export function inventoryModel(connection: Connection): Model<InventoryDocument> {
  const registered = connection.models.Inventory as Model<InventoryDocument> | undefined
  if (registered) return registered
  return connection.model<InventoryDocument>('Inventory', InventoryMongooseSchema, 'crm_inventories')
}

export async function syncInventoryIndexes(connection: Connection): Promise<void> {
  await inventoryModel(connection).createIndexes()
}
