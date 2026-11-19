import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'

export const INVENTORY_TRANSACTION_SCHEMA_VERSION = 1

export const INVENTORY_TRANSACTION_TYPES = [
  'import',
  'export',
  'return_in',
  'return_out',
  'transfer_in',
  'transfer_out',
  'adjustment_inc',
  'adjustment_dec',
] as const
export type InventoryTransactionType = (typeof INVENTORY_TRANSACTION_TYPES)[number]

export const INVENTORY_REFERENCE_MODELS = [
  'PurchaseOrder',
  'Order',
  'InventoryTransfer',
  'Stocktake',
  'InventoryAdjustment',
  'Other',
  'None',
] as const
export type InventoryReferenceModel = (typeof INVENTORY_REFERENCE_MODELS)[number]

export interface InventoryTransactionDocument {
  siteId: string
  code: string
  inventoryId: string
  itemId: string
  variantId: string | null
  warehouseId: string
  type: InventoryTransactionType
  quantityChange: number
  previousQuantity: number
  newQuantity: number
  unitCost: number
  totalValue: number
  imeiCodes: string[]
  referenceId: string | null
  referenceCode: string | null
  referenceModel: InventoryReferenceModel
  reason: string
  performerId: string | null
  revision: number
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

const InventoryTransactionMongooseSchema = new Schema<InventoryTransactionDocument>(
  {
    siteId: { type: String, required: true },
    code: { type: String, required: true },
    inventoryId: { type: String, required: true },
    itemId: { type: String, required: true },
    variantId: { type: String, default: null },
    warehouseId: { type: String, required: true },
    type: { type: String, enum: INVENTORY_TRANSACTION_TYPES, required: true },
    quantityChange: { type: Number, required: true },
    previousQuantity: { type: Number, required: true, min: 0 },
    newQuantity: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, default: 0, min: 0 },
    totalValue: { type: Number, default: 0, min: 0 },
    imeiCodes: { type: [String], default: [] },
    referenceId: { type: String, default: null },
    referenceCode: { type: String, default: null },
    referenceModel: { type: String, enum: INVENTORY_REFERENCE_MODELS, default: 'None' },
    reason: { type: String, default: '' },
    performerId: { type: String, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: INVENTORY_TRANSACTION_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_inventory_transactions',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

InventoryTransactionMongooseSchema.index({ siteId: 1, createdAt: -1 }, { name: 'inventory_transaction_site_created' })
InventoryTransactionMongooseSchema.index({ siteId: 1, itemId: 1, warehouseId: 1, createdAt: -1 }, { name: 'inventory_transaction_site_item_warehouse_created' })
InventoryTransactionMongooseSchema.index({ siteId: 1, referenceModel: 1, referenceId: 1 }, { name: 'inventory_transaction_site_reference' })
InventoryTransactionMongooseSchema.index({ siteId: 1, type: 1, createdAt: -1 }, { name: 'inventory_transaction_site_type_created' })

export function inventoryTransactionModel(connection: Connection): Model<InventoryTransactionDocument> {
  const registered = connection.models.InventoryTransaction as Model<InventoryTransactionDocument> | undefined
  if (registered) return registered
  return connection.model<InventoryTransactionDocument>('InventoryTransaction', InventoryTransactionMongooseSchema, 'crm_inventory_transactions')
}

export async function syncInventoryTransactionIndexes(connection: Connection): Promise<void> {
  await inventoryTransactionModel(connection).createIndexes()
}
