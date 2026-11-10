import mongoose from 'mongoose'

const { Schema, model } = mongoose

/**
 * The CMS owns `content_redirects`; the storefront only reads one row per
 * request. The schema is loose because the CMS may add a field at any time, and
 * only `from`, `to`, `statusCode` and `isActive` are ever selected.
 */

export interface PublicRedirectDoc {
  from: string
  to: string
  statusCode: number
  isActive: boolean
}

const redirectSchema = new Schema<PublicRedirectDoc>(
  {
    from: String,
    to: String,
    statusCode: Number,
    isActive: Boolean,
  },
  {
    collection: 'content_redirects',
    strict: false,
    versionKey: false,
    timestamps: false,
  },
)

export const PUBLIC_REDIRECT_PROJECTION = {
  _id: 0,
  from: 1,
  to: 1,
  statusCode: 1,
  isActive: 1,
} as const

export const PublicRedirectModel = (mongoose.models.PublicRedirect as mongoose.Model<PublicRedirectDoc> | undefined)
  ?? model<PublicRedirectDoc>('PublicRedirect', redirectSchema, 'content_redirects')
