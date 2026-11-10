import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'

/**
 * Site redirect map.
 *
 * The collection is `content_redirects`, not `redirects`: every migrated
 * customer database already carries legacy `Redirect` documents (`tenantId`,
 * `oldPath`, no `siteId`), and they stay untouched until the import slice.
 *
 * One document is one old path for one site. `from` is normalized by the service
 * (leading slash, no trailing slash, no query/hash) and unique per site, so the
 * storefront lookup is a single indexed equality read.
 */

export interface RedirectDocument {
  siteId: string
  from: string
  to: string
  statusCode: 301 | 302
  isActive: boolean
  note: string
  revision: number
  createdAt: Date
  updatedAt: Date
}

export const redirectSchema = new Schema<RedirectDocument>(
  {
    siteId: { type: String, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    statusCode: { type: Number, enum: [301, 302], default: 301 },
    isActive: { type: Boolean, default: true },
    note: { type: String, default: '' },
    revision: { type: Number, required: true, default: 1 },
  },
  {
    collection: 'content_redirects',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

redirectSchema.index({ siteId: 1, from: 1 }, { name: 'content_redirect_site_path_unique', unique: true })
// The storefront reads only active rows; a partial index keeps that lookup small.
redirectSchema.index(
  { from: 1 },
  { name: 'content_redirect_active_path', partialFilterExpression: { isActive: true } },
)

export function redirectModel(connection: Connection): Model<RedirectDocument> {
  const registered = connection.models.Redirect as Model<RedirectDocument> | undefined
  if (registered) return registered
  return connection.model<RedirectDocument>('Redirect', redirectSchema, 'content_redirects')
}

export async function syncRedirectIndexes(connection: Connection): Promise<void> {
  await redirectModel(connection).createIndexes()
}
