import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'

/**
 * Idempotency keys for retryable admin mutations. A retry with the same key and
 * the same payload replays the stored response instead of running the command a
 * second time; the same key with a different payload is a conflict, never a
 * silent second write.
 */

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

export interface IdempotencyRecordDocument {
  siteId: string
  key: string
  action: string
  requestHash: string
  responseStatus: number
  responseBody: string
  createdAt: Date
  expiresAt: Date
}

export const idempotencySchema = new Schema<IdempotencyRecordDocument>(
  {
    siteId: { type: String, required: true },
    key: { type: String, required: true },
    action: { type: String, required: true },
    requestHash: { type: String, required: true },
    responseStatus: { type: Number, required: true },
    responseBody: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  {
    collection: 'idempotency_keys',
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
)

// One key per site: the same key value on another customer is a different write.
idempotencySchema.index({ siteId: 1, key: 1 }, { unique: true, name: 'idempotency_site_key' })
// Expiry is enforced by MongoDB, so replay records cannot grow without bound.
idempotencySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'idempotency_expiry' })

/** Model factory: one registration per connection, never a global model. */
export function idempotencyModel(connection: Connection): Model<IdempotencyRecordDocument> {
  const registered = connection.models.IdempotencyKey as Model<IdempotencyRecordDocument> | undefined
  if (registered) return registered
  return connection.model<IdempotencyRecordDocument>('IdempotencyKey', idempotencySchema, 'idempotency_keys')
}

export async function syncIdempotencyIndexes(connection: Connection): Promise<void> {
  await idempotencyModel(connection).createIndexes()
}
