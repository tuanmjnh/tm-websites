import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'
import { normalizeSlug } from './content'

/**
 * Content category tree. A category is an immutable `key` plus a parent key, so
 * a subtree can be moved without rewriting ids and a URL never depends on the
 * database id. Names and slugs are per locale; the tree itself is shared.
 */

export const CATEGORY_MAX_DEPTH = 5
export const CATEGORY_MAX_ORDER = 9999
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Za-z]{2})?$/
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export class CategoryInvariantError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CategoryInvariantError'
    this.code = code
  }
}

export const CategoryLocaleSchema = z.object({
  locale: z.string().regex(LOCALE_PATTERN),
  name: z.string().trim().min(1).max(120),
  slug: z.string().regex(SLUG_PATTERN).max(120),
})

export const CategoryDraftSchema = z.object({
  key: z.string().regex(SLUG_PATTERN).max(120),
  parent: z.string().regex(SLUG_PATTERN).max(120).nullable().default(null),
  order: z.number().int().min(0).max(CATEGORY_MAX_ORDER).default(0),
  locales: z.array(CategoryLocaleSchema).min(1).max(10),
})

export type CategoryDraft = z.infer<typeof CategoryDraftSchema>
export type CategoryLocale = z.infer<typeof CategoryLocaleSchema>

export interface CategoryDocument {
  siteId: string
  key: string
  parent: string | null
  order: number
  revision: number
  locales: CategoryLocale[]
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Editor input normalization: the key and every slug are folded (`Trang sức` →
 * `trang-suc`), duplicate locales are rejected, and the parent is optional.
 */
export function normalizeCategoryInput(input: unknown): CategoryDraft {
  const source = readRecord(input)
  const key = normalizeSlug(source.key)
  if (!key) {
    throw new CategoryInvariantError('CATEGORY_KEY_INVALID', 'Category key is missing or unsafe')
  }

  const rawLocales = Array.isArray(source.locales) ? source.locales : []
  const locales = rawLocales.map((entry) => {
    const locale = readRecord(entry)
    return { ...locale, slug: normalizeSlug(locale.slug ?? locale.name) }
  })

  const parent = source.parent === null || source.parent === undefined || source.parent === ''
    ? null
    : normalizeSlug(source.parent)

  try {
    const draft = CategoryDraftSchema.parse({ ...source, key, parent, locales })
    const seen = new Set<string>()
    for (const entry of draft.locales) {
      if (seen.has(entry.locale)) {
        throw new CategoryInvariantError('CATEGORY_LOCALE_DUPLICATE', `Duplicate locale ${entry.locale}`)
      }
      seen.add(entry.locale)
    }
    return draft
  } catch (error) {
    if (error instanceof CategoryInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new CategoryInvariantError('CATEGORY_PAYLOAD_INVALID', 'Category payload is invalid')
    }
    throw error
  }
}

const CategoryLocaleMongooseSchema = new Schema(
  {
    locale: { type: String, required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
  },
  { _id: false },
)

export const categorySchema = new Schema<CategoryDocument>(
  {
    siteId: { type: String, required: true },
    key: { type: String, required: true },
    parent: { type: String, default: null },
    order: { type: Number, default: 0, required: true },
    revision: { type: Number, default: 1, required: true },
    locales: { type: [CategoryLocaleMongooseSchema], required: true },
    schemaVersion: { type: Number, default: 1, required: true },
  },
  {
    collection: 'categories',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

categorySchema.index({ siteId: 1, key: 1 }, { unique: true, name: 'category_site_key' })
categorySchema.index(
  { siteId: 1, 'locales.locale': 1, 'locales.slug': 1 },
  { unique: true, name: 'category_site_locale_slug' },
)
categorySchema.index({ siteId: 1, parent: 1, order: 1 }, { name: 'category_site_parent_order' })

export function categoryModel(connection: Connection): Model<CategoryDocument> {
  const registered = connection.models.Category as Model<CategoryDocument> | undefined
  if (registered) return registered
  return connection.model<CategoryDocument>('Category', categorySchema, 'categories')
}

export async function syncCategoryIndexes(connection: Connection): Promise<void> {
  await categoryModel(connection).createIndexes()
}
