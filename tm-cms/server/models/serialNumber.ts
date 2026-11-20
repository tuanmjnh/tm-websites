import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

export const SERIAL_NUMBER_SCHEMA_VERSION = 1

const SERIAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/

export const SERIAL_STATUSES = ['in_stock', 'sold', 'returned', 'scrapped'] as const
export type SerialStatus = (typeof SERIAL_STATUSES)[number]

export class SerialNumberInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'SerialNumberInvariantError'
    this.code = code
  }
}

export const SerialNumberRegisterSchema = z.object({
  serial: z.string().trim().regex(SERIAL_PATTERN, 'Invalid serial').max(64),
  itemId: z.string().trim().min(1).max(64),
  variantId: z.string().trim().max(64).nullable().default(null),
  warehouseId: z.string().trim().max(64).nullable().default(null),
  purchaseOrderId: z.string().trim().max(64).nullable().default(null),
  note: z.string().trim().max(500).default(''),
})

export type SerialNumberRegisterInput = z.infer<typeof SerialNumberRegisterSchema>

export interface SerialNumberDocument {
  siteId: string
  serial: string
  itemId: string
  variantId: string | null
  warehouseId: string | null
  status: SerialStatus
  purchaseOrderId: string | null
  orderId: string | null
  note: string
  receivedAt: Date
  soldAt: Date | null
  returnedAt: Date | null
  scrappedAt: Date | null
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

export function normalizeSerialNumberInput(input: unknown): SerialNumberRegisterInput {
  const source = readRecord(input)
  try {
    return SerialNumberRegisterSchema.parse(source)
  } catch (error) {
    if (error instanceof SerialNumberInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new SerialNumberInvariantError('SERIAL_NUMBER_PAYLOAD_INVALID', 'Serial number payload is invalid')
    }
    throw error
  }
}

const SerialNumberMongooseSchema = new Schema<SerialNumberDocument>(
  {
    siteId: { type: String, required: true },
    serial: { type: String, required: true },
    itemId: { type: String, required: true },
    variantId: { type: String, default: null },
    warehouseId: { type: String, default: null },
    status: { type: String, enum: SERIAL_STATUSES, default: 'in_stock' },
    purchaseOrderId: { type: String, default: null },
    orderId: { type: String, default: null },
    note: { type: String, default: '' },
    receivedAt: { type: Date, default: () => new Date() },
    soldAt: { type: Date, default: null },
    returnedAt: { type: Date, default: null },
    scrappedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: SERIAL_NUMBER_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_serial_numbers',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

SerialNumberMongooseSchema.index({ siteId: 1, serial: 1 }, { unique: true, name: 'serial_site_serial' })
SerialNumberMongooseSchema.index({ siteId: 1, itemId: 1, status: 1 }, { name: 'serial_site_item_status' })
SerialNumberMongooseSchema.index({ siteId: 1, warehouseId: 1, status: 1 }, { name: 'serial_site_warehouse_status' })

export function serialNumberModel(connection: Connection): Model<SerialNumberDocument> {
  const registered = connection.models.SerialNumber as Model<SerialNumberDocument> | undefined
  if (registered) return registered
  return connection.model<SerialNumberDocument>('SerialNumber', SerialNumberMongooseSchema, 'crm_serial_numbers')
}

export async function syncSerialNumberIndexes(connection: Connection): Promise<void> {
  await serialNumberModel(connection).createIndexes()
}
