import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

export class KeywordInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'KeywordInvariantError'
    this.code = code
  }
}

export function normalizeKeywordSlug(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 64).replace(/-+$/, '')
}

export const KeywordDraftSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  slug: z.string().regex(SLUG_PATTERN).max(64),
  title: z.string().trim().min(1).max(200),
  color: z.string().trim().max(20).default(''),
  count: z.number().int().min(0).default(0),
  scope: z.string().trim().max(40).default('share'),
  isActive: z.boolean().default(true),
})

export type KeywordDraft = z.infer<typeof KeywordDraftSchema>

export interface KeywordDocument {
  siteId: string
  slug: string
  title: string
  color: string
  count: number
  scope: string
  isActive: boolean
  isDeleted: boolean
  deletedAt: Date | null
  revision: number
  createdAt?: Date
  updatedAt?: Date
}

const KeywordMongooseSchema = new Schema<KeywordDocument>(
  {
    siteId: { type: String, required: true, index: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    color: { type: String, default: '', trim: true, maxlength: 20 },
    count: { type: Number, default: 0, min: 0 },
    scope: { type: String, default: 'share', trim: true, maxlength: 40 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true, collection: 'crm_keywords' },
)

KeywordMongooseSchema.index({ siteId: 1, slug: 1 }, { unique: true, name: 'keyword_site_slug' })
KeywordMongooseSchema.index({ siteId: 1, isDeleted: 1, scope: 1 }, { name: 'keyword_site_deleted_scope' })

export function keywordModel(connection: Connection): Model<KeywordDocument> {
  const registered = connection.models.Keyword as Model<KeywordDocument> | undefined
  if (registered) return registered
  return connection.model<KeywordDocument>('Keyword', KeywordMongooseSchema, 'crm_keywords')
}

export function syncKeywordIndexes(connection: Connection): Promise<void> {
  return keywordModel(connection).createIndexes().then(() => undefined)
}

export function normalizeKeywordInput(input: unknown): KeywordDraft {
  const source = (input ?? {}) as Record<string, unknown>
  try {
    return KeywordDraftSchema.parse({
      siteId: source.siteId,
      slug: normalizeKeywordSlug(source.slug ?? source.title ?? ''),
      title: source.title ?? source.name ?? '',
      color: source.color ?? '',
      count: typeof source.count === 'number' ? source.count : 0,
      scope: source.scope ?? 'share',
      isActive: source.isActive !== false && source.isDeleted !== true,
    })
  } catch (error) {
    const issue = (error as { issues?: { message?: string }[] })?.issues?.[0]?.message
    throw new KeywordInvariantError('KEYWORD_PAYLOAD_INVALID', issue ?? 'Invalid keyword payload')
  }
}