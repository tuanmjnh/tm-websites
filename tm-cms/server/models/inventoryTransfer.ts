import { Schema } from 'mongoose'
import type { Connection, Model, Types } from 'mongoose'
import { z } from 'zod'

export const INVENTORY_TRANSFER_SCHEMA_VERSION = 1

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/

/**
 * `draft` holds no stock, `in_transit` means the source has been debited, and
 * `received` means the destination has been credited. A transfer never skips a
 * state, so the ledger can be reconciled at any point.
 */
export const INVENTORY_TRANSFER_STATUSES = ['draft', 'in_transit', 'received', 'cancelled'] as const
export type InventoryTransferStatus = (typeof INVENTORY_TRANSFER_STATUSES)[number]

export class InventoryTransferInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'InventoryTransferInvariantError'
    this.code = code
  }
}

export function normalizeInventoryTransferCode(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '')
}

export const InventoryTransferLineSchema = z.object({
  itemId: z.string().trim().min(1).max(64),
  variantId: z.string().trim().max(64).nullable().default(null),
  sku: z.string().trim().max(120).default(''),
  itemName: z.string().trim().max(300).default(''),
  quantity: z.number().int().min(1).max(999999),
  /** Cumulative: a second partial receipt reports the new total, not a delta. */
  receivedQuantity: z.number().int().min(0).default(0),
})

export type InventoryTransferLine = z.infer<typeof InventoryTransferLineSchema>

export const InventoryTransferDraftSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  code: z.string().regex(CODE_PATTERN).max(32),
  fromWarehouseId: z.string().trim().min(1).max(64),
  toWarehouseId: z.string().trim().min(1).max(64),
  lines: z.array(InventoryTransferLineSchema).min(1).max(200),
  note: z.string().trim().max(2000).default(''),
})

export type InventoryTransferDraft = z.infer<typeof InventoryTransferDraftSchema>

export interface InventoryTransferDocument {
  siteId: string
  code: string
  fromWarehouseId: Types.ObjectId
  toWarehouseId: Types.ObjectId
  status: InventoryTransferStatus
  lines: InventoryTransferLine[]
  note: string
  shippedAt: Date | null
  receivedAt: Date | null
  cancelledAt: Date | null
  cancelReason: string
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

export function normalizeInventoryTransferInput(input: unknown): Omit<InventoryTransferDraft, 'siteId'> {
  const source = readRecord(input)
  const code = normalizeInventoryTransferCode(source.code)
  try {
    const parsed = InventoryTransferDraftSchema.parse({ ...source, siteId: 'site', code: code || 'TRF-PLACEHOLDER' })
    const { siteId: _siteId, ...rest } = parsed
    return rest
  } catch (error) {
    if (error instanceof InventoryTransferInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new InventoryTransferInvariantError('INVENTORY_TRANSFER_PAYLOAD_INVALID', 'Transfer payload is invalid')
    }
    throw error
  }
}

const InventoryTransferMongooseSchema = new Schema<InventoryTransferDocument>(
  {
    siteId: { type: String, required: true },
    code: { type: String, required: true },
    fromWarehouseId: { type: Schema.Types.ObjectId, required: true },
    toWarehouseId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: INVENTORY_TRANSFER_STATUSES, default: 'draft' },
    lines: { type: [new Schema({
      itemId: { type: String, required: true },
      variantId: { type: String, default: null },
      sku: { type: String, default: '' },
      itemName: { type: String, default: '' },
      quantity: { type: Number, required: true, min: 1 },
      receivedQuantity: { type: Number, default: 0, min: 0 },
    }, { _id: false })], default: [] },
    note: { type: String, default: '' },
    shippedAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: INVENTORY_TRANSFER_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_inventory_transfers',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

InventoryTransferMongooseSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'inventory_transfer_site_code' })
InventoryTransferMongooseSchema.index({ siteId: 1, status: 1, createdAt: -1 }, { name: 'inventory_transfer_site_status' })
InventoryTransferMongooseSchema.index({ siteId: 1, isDeleted: 1, createdAt: -1 }, { name: 'inventory_transfer_site_created' })

export function inventoryTransferModel(connection: Connection): Model<InventoryTransferDocument> {
  const registered = connection.models.InventoryTransfer as Model<InventoryTransferDocument> | undefined
  if (registered) return registered
  return connection.model<InventoryTransferDocument>('InventoryTransfer', InventoryTransferMongooseSchema, 'crm_inventory_transfers')
}

export async function syncInventoryTransferIndexes(connection: Connection): Promise<void> {
  await inventoryTransferModel(connection).createIndexes()
}
