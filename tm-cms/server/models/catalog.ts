import { Schema } from 'mongoose'
import type { Connection, Model, Types } from 'mongoose'
import { z } from 'zod'
import { normalizeSlug } from './content'

/**
 * CMS-owned catalog. The storefront used to read the legacy tenant collections
 * (`items`/`item_categories`) directly; these two collections are now the write
 * model, and the storefront reader points at them. Field names are kept close to
 * the public projection the mapper already understands (`title.vi`, `basePrice`,
 * `salePrice`, `thumbnail`, `categories` as ids) so a migrated record renders
 * exactly as it did before.
 */

export const CATALOG_ITEM_STATUSES = ['draft', 'published', 'archived', 'deleted'] as const
export type CatalogItemStatus = (typeof CATALOG_ITEM_STATUSES)[number]

export const CATALOG_ITEM_TYPES = ['simple', 'variable'] as const
export type CatalogItemType = (typeof CATALOG_ITEM_TYPES)[number]

export const CATALOG_EVENTS = ['publish', 'archive', 'restore', 'delete'] as const
export type CatalogEvent = (typeof CATALOG_EVENTS)[number]

export const CATALOG_SCHEMA_VERSION = 1
export const CATALOG_MAX_LOCALES = 5
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Za-z]{2})?$/
const KEY_MAX = 120
const TEXT_MAX = 5000
const SEARCH_MAX = 500

export class CatalogInvariantError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CatalogInvariantError'
    this.code = code
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Localized maps store only non-empty, trimmed values; the default locale is not required to exist. */
function normalizeLocalized(value: unknown, max = TEXT_MAX): Record<string, string> {
  const source = readRecord(value)
  const result: Record<string, string> = {}
  for (const [rawLocale, rawText] of Object.entries(source)) {
    const locale = rawLocale.trim().toLowerCase()
    if (!LOCALE_PATTERN.test(locale)) continue
    const text = typeof rawText === 'string' ? rawText.trim() : ''
    if (!text) continue
    result[locale] = text.slice(0, max)
  }
  if (Object.keys(result).length > CATALOG_MAX_LOCALES) {
    throw new CatalogInvariantError('CATALOG_LOCALE_LIMIT', 'Too many locales on one field')
  }
  return result
}

const LocalizedTextSchema = z.record(z.string(), z.string().max(TEXT_MAX))

const CatalogAttributeSchema = z.object({
  name: LocalizedTextSchema,
  value: LocalizedTextSchema,
})

const CatalogVariantSchema = z.object({
  sku: z.string().trim().max(80).default(''),
  name: LocalizedTextSchema.default({}),
  basePrice: z.number().nonnegative().default(0),
  salePrice: z.number().nonnegative().nullable().default(null),
  stock: z.number().int().default(0),
  manageStock: z.boolean().default(true),
  isActive: z.boolean().default(true),
  attributes: z.array(CatalogAttributeSchema).max(30).default([]),
})

const CatalogSeoSchema = z.object({
  title: LocalizedTextSchema.default({}),
  description: LocalizedTextSchema.default({}),
  image: z.string().trim().max(500).default(''),
})

/**
 * The editable payload. `key` is immutable after creation; status, revision and
 * timestamps are server-controlled and intentionally absent.
 */
export const CatalogItemDraftSchema = z.object({
  key: z.string().regex(SLUG_PATTERN).max(KEY_MAX),
  type: z.enum(CATALOG_ITEM_TYPES).default('simple'),
  title: LocalizedTextSchema,
  slug: LocalizedTextSchema,
  shortDesc: LocalizedTextSchema.default({}),
  description: LocalizedTextSchema.default({}),
  thumbnail: z.string().trim().max(500).nullable().default(null),
  gallery: z.array(z.string().trim().max(500)).max(20).default([]),
  basePrice: z.number().nonnegative().default(0),
  salePrice: z.number().nonnegative().nullable().default(null),
  sku: z.string().trim().max(80).default(''),
  uom: z.string().trim().max(40).default(''),
  stock: z.number().int().default(0),
  manageStock: z.boolean().default(true),
  categories: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  attributes: z.array(CatalogAttributeSchema).max(30).default([]),
  variants: z.array(CatalogVariantSchema).max(200).default([]),
  seo: CatalogSeoSchema.default({ title: {}, description: {}, image: '' }),
}).superRefine((draft, ctx) => {
  if (!draft.title.vi) {
    ctx.addIssue({ code: 'custom', path: ['title', 'vi'], message: 'A Vietnamese title is required' })
  }
  if (!draft.slug.vi) {
    ctx.addIssue({ code: 'custom', path: ['slug', 'vi'], message: 'A Vietnamese slug is required' })
  }
  if (draft.salePrice !== null && draft.salePrice > draft.basePrice) {
    ctx.addIssue({ code: 'custom', path: ['salePrice'], message: 'salePrice cannot exceed basePrice' })
  }
  const skus = new Set<string>()
  for (const [index, variant] of draft.variants.entries()) {
    if (!variant.sku) {
      ctx.addIssue({ code: 'custom', path: ['variants', index, 'sku'], message: 'A variant needs a SKU' })
      continue
    }
    const sku = variant.sku.toLowerCase()
    if (skus.has(sku)) {
      ctx.addIssue({ code: 'custom', path: ['variants', index, 'sku'], message: `Duplicate variant SKU ${variant.sku}` })
    }
    skus.add(sku)
    if (variant.salePrice !== null && variant.salePrice > variant.basePrice) {
      ctx.addIssue({ code: 'custom', path: ['variants', index, 'salePrice'], message: 'salePrice cannot exceed basePrice' })
    }
  }
})

export type CatalogItemDraft = z.infer<typeof CatalogItemDraftSchema>

export const CatalogCategoryDraftSchema = z.object({
  key: z.string().regex(SLUG_PATTERN).max(KEY_MAX),
  parent: z.string().regex(SLUG_PATTERN).max(KEY_MAX).nullable().default(null),
  order: z.number().int().min(0).max(9999).default(0),
  title: LocalizedTextSchema,
  slug: LocalizedTextSchema,
  description: LocalizedTextSchema.default({}),
  thumbnail: z.string().trim().max(500).nullable().default(null),
}).superRefine((draft, ctx) => {
  if (!draft.title.vi) {
    ctx.addIssue({ code: 'custom', path: ['title', 'vi'], message: 'A Vietnamese title is required' })
  }
  if (!draft.slug.vi) {
    ctx.addIssue({ code: 'custom', path: ['slug', 'vi'], message: 'A Vietnamese slug is required' })
  }
})

export type CatalogCategoryDraft = z.infer<typeof CatalogCategoryDraftSchema>

function translateZod(error: unknown): never {
  if (error instanceof z.ZodError) {
    throw new CatalogInvariantError('CATALOG_PAYLOAD_INVALID', error.issues[0]?.message ?? 'Catalog payload is invalid')
  }
  throw error
}

/** Editor input is folded before validation, so `Áo Thun` and `ao thun` cannot create two slugs. */
export function normalizeCatalogItemInput(input: unknown): CatalogItemDraft {
  const source = readRecord(input)
  const key = normalizeSlug(source.key)
  if (!key) throw new CatalogInvariantError('CATALOG_KEY_INVALID', 'Catalog key is missing or unsafe')

  const slugSource = readRecord(source.slug)
  const slug: Record<string, string> = {}
  for (const [rawLocale, value] of Object.entries(slugSource)) {
    const locale = rawLocale.trim().toLowerCase()
    const normalized = normalizeSlug(value)
    if (LOCALE_PATTERN.test(locale) && normalized) slug[locale] = normalized
  }
  if (!slug.vi) {
    const title = readRecord(source.title).vi
    const fromTitle = normalizeSlug(title)
    if (fromTitle) slug.vi = fromTitle
  }

  try {
    return CatalogItemDraftSchema.parse({
      ...source,
      key,
      title: normalizeLocalized(source.title, 200),
      slug,
      shortDesc: normalizeLocalized(source.shortDesc, 500),
      description: normalizeLocalized(source.description),
      gallery: Array.isArray(source.gallery) ? source.gallery : [],
      categories: Array.isArray(source.categories) ? source.categories : [],
      tags: [...new Set((Array.isArray(source.tags) ? source.tags : [])
        .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
        .map(tag => tag.trim().slice(0, 60)))],
      attributes: Array.isArray(source.attributes)
        ? source.attributes.map(entry => {
            const record = readRecord(entry)
            return { name: normalizeLocalized(record.name, 200), value: normalizeLocalized(record.value, 500) }
          }).filter(entry => Object.keys(entry.name).length && Object.keys(entry.value).length)
        : [],
      variants: Array.isArray(source.variants)
        ? source.variants.map(entry => {
            const record = readRecord(entry)
            return {
              ...record,
              sku: typeof record.sku === 'string' ? record.sku.trim() : '',
              name: normalizeLocalized(record.name, 200),
              attributes: Array.isArray(record.attributes)
                ? record.attributes.map(attribute => {
                    const value = readRecord(attribute)
                    return {
                      name: normalizeLocalized(value.name, 200),
                      value: normalizeLocalized(value.value, 500),
                    }
                  }).filter(attribute => Object.keys(attribute.name).length && Object.keys(attribute.value).length)
                : [],
            }
          })
        : [],
      seo: (() => {
        const seo = readRecord(source.seo)
        return {
          title: normalizeLocalized(seo.title, 200),
          description: normalizeLocalized(seo.description, 500),
          image: typeof seo.image === 'string' ? seo.image.trim().slice(0, 500) : '',
        }
      })(),
    })
  } catch (error) {
    return translateZod(error)
  }
}

export function normalizeCatalogCategoryInput(input: unknown): CatalogCategoryDraft {
  const source = readRecord(input)
  const key = normalizeSlug(source.key)
  if (!key) throw new CatalogInvariantError('CATALOG_KEY_INVALID', 'Catalog key is missing or unsafe')

  const slugSource = readRecord(source.slug)
  const slug: Record<string, string> = {}
  for (const [rawLocale, value] of Object.entries(slugSource)) {
    const locale = rawLocale.trim().toLowerCase()
    const normalized = normalizeSlug(value)
    if (LOCALE_PATTERN.test(locale) && normalized) slug[locale] = normalized
  }
  if (!slug.vi) {
    const fromTitle = normalizeSlug(readRecord(source.title).vi)
    if (fromTitle) slug.vi = fromTitle
  }

  const parent = source.parent === null || source.parent === undefined || source.parent === ''
    ? null
    : normalizeSlug(source.parent)

  try {
    return CatalogCategoryDraftSchema.parse({
      ...source,
      key,
      parent,
      title: normalizeLocalized(source.title, 200),
      slug,
      description: normalizeLocalized(source.description, 500),
      thumbnail: typeof source.thumbnail === 'string' && source.thumbnail.trim() ? source.thumbnail.trim() : null,
    })
  } catch (error) {
    return translateZod(error)
  }
}

/**
 * The public search reads `searchString` with a normalized regex, so the write
 * path folds title/slug/sku into one ASCII string. Without this a CMS-written
 * record is invisible to `/tim-kiem` even though it renders on its own page.
 */
export function buildSearchString(input: {
  title?: Record<string, string>
  slug?: Record<string, string>
  sku?: string
  shortDesc?: Record<string, string>
  tags?: string[]
}): string {
  const parts = [
    ...Object.values(input.title ?? {}),
    ...Object.values(input.slug ?? {}),
    ...Object.values(input.shortDesc ?? {}),
    input.sku ?? '',
    ...(input.tags ?? []),
  ]
  return parts
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_MAX)
}

/** Localized URL prefix from a category chain: `/trang-suc/nhan`. */
export function buildFullPath(slug: Record<string, string>, parentPath: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [locale, value] of Object.entries(slug)) {
    const prefix = parentPath[locale] ?? ''
    result[locale] = `${prefix}/${value}`.replace(/\/+/g, '/').slice(0, 500)
  }
  return result
}

export interface CatalogItemDocument {
  siteId: string
  key: string
  status: CatalogItemStatus
  type: CatalogItemType
  title: Record<string, string>
  slug: Record<string, string>
  shortDesc: Record<string, string>
  description: Record<string, string>
  thumbnail: string | null
  gallery: string[]
  basePrice: number
  salePrice: number | null
  sku: string
  uom: string
  stock: number
  manageStock: boolean
  categories: Types.ObjectId[]
  tags: string[]
  attributes: { name: Record<string, string>, value: Record<string, string> }[]
  variants: {
    sku: string
    name: Record<string, string>
    basePrice: number
    salePrice: number | null
    stock: number
    manageStock: boolean
    isActive: boolean
    attributes: { name: Record<string, string>, value: Record<string, string> }[]
  }[]
  seo: { title: Record<string, string>, description: Record<string, string>, image: string }
  searchString: string
  /** Storefront counters, kept from the legacy records so `popular` sorting still works. */
  sales: number
  views: number
  /** Id of the legacy document this row was migrated from, if any. */
  legacyId?: string
  isActive: boolean
  isDeleted: boolean
  publishedAt: Date | null
  deletedAt: Date | null
  revision: number
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

export interface CatalogCategoryDocument {
  siteId: string
  key: string
  parent: Types.ObjectId | null
  /** Mirror of `parent`; the public mapper reads `pid` on legacy rows. */
  pid: Types.ObjectId | null
  /** Every ancestor id, optional, so a category filter can include its subtree. */
  ancestors: Types.ObjectId[]
  order: number
  displayOrder: number
  title: Record<string, string>
  slug: Record<string, string>
  fullPath: Record<string, string>
  description: Record<string, string>
  thumbnail: string | null
  seo: { title: Record<string, string>, description: Record<string, string> }
  legacyId?: string
  isDeleted: boolean
  deletedAt: Date | null
  revision: number
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

const LocalizedSchemaDefinition = { type: Schema.Types.Mixed, default: {} }

const CatalogItemSchema = new Schema<CatalogItemDocument>(
  {
    siteId: { type: String, required: true },
    key: { type: String, required: true },
    status: { type: String, enum: CATALOG_ITEM_STATUSES, default: 'draft', required: true },
    type: { type: String, enum: CATALOG_ITEM_TYPES, default: 'simple', required: true },
    title: { ...LocalizedSchemaDefinition, required: true },
    slug: { ...LocalizedSchemaDefinition, required: true },
    shortDesc: LocalizedSchemaDefinition,
    description: LocalizedSchemaDefinition,
    thumbnail: { type: String, default: null },
    gallery: { type: [String], default: [] },
    basePrice: { type: Number, default: 0, required: true },
    salePrice: { type: Number, default: null },
    sku: { type: String, default: '' },
    uom: { type: String, default: '' },
    stock: { type: Number, default: 0 },
    manageStock: { type: Boolean, default: true },
    categories: { type: [Schema.Types.ObjectId], default: [] },
    tags: { type: [String], default: [] },
    attributes: { type: Schema.Types.Mixed, default: [] },
    variants: { type: Schema.Types.Mixed, default: [] },
    seo: { type: Schema.Types.Mixed, default: { title: {}, description: {}, image: '' } },
    searchString: { type: String, default: '' },
    sales: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    legacyId: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    publishedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: CATALOG_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'catalog_items',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

// A soft-deleted record keeps its key, exactly like content: a restore must not
// collide and a reused key would silently change what an old link resolves to.
CatalogItemSchema.index({ siteId: 1, key: 1 }, { unique: true, name: 'catalog_item_site_key' })
CatalogItemSchema.index(
  { siteId: 1, 'slug.vi': 1 },
  { unique: true, name: 'catalog_item_site_slug' },
)
CatalogItemSchema.index({ siteId: 1, status: 1, publishedAt: -1 }, { name: 'catalog_item_site_status' })
CatalogItemSchema.index({ siteId: 1, tags: 1 }, { name: 'catalog_item_site_tag' })
CatalogItemSchema.index({ siteId: 1, categories: 1 }, { name: 'catalog_item_site_category' })
CatalogItemSchema.index({ siteId: 1, legacyId: 1 }, { name: 'catalog_item_site_legacy', sparse: true })

const CatalogCategorySchema = new Schema<CatalogCategoryDocument>(
  {
    siteId: { type: String, required: true },
    key: { type: String, required: true },
    parent: { type: Schema.Types.ObjectId, default: null },
    pid: { type: Schema.Types.ObjectId, default: null },
    ancestors: { type: [Schema.Types.ObjectId], default: [] },
    order: { type: Number, default: 0, required: true },
    displayOrder: { type: Number, default: 0, required: true },
    title: { ...LocalizedSchemaDefinition, required: true },
    slug: { ...LocalizedSchemaDefinition, required: true },
    fullPath: LocalizedSchemaDefinition,
    description: LocalizedSchemaDefinition,
    thumbnail: { type: String, default: null },
    seo: { type: Schema.Types.Mixed, default: { title: {}, description: {} } },
    legacyId: { type: String, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: CATALOG_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'catalog_categories',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

CatalogCategorySchema.index({ siteId: 1, key: 1 }, { unique: true, name: 'catalog_category_site_key' })
CatalogCategorySchema.index(
  { siteId: 1, 'slug.vi': 1 },
  { unique: true, name: 'catalog_category_site_slug' },
)
CatalogCategorySchema.index({ siteId: 1, parent: 1, order: 1 }, { name: 'catalog_category_site_tree' })
CatalogCategorySchema.index({ siteId: 1, legacyId: 1 }, { name: 'catalog_category_site_legacy', sparse: true })

export function catalogItemModel(connection: Connection): Model<CatalogItemDocument> {
  const registered = connection.models.CatalogItem as Model<CatalogItemDocument> | undefined
  if (registered) return registered
  return connection.model<CatalogItemDocument>('CatalogItem', CatalogItemSchema, 'catalog_items')
}

export function catalogCategoryModel(connection: Connection): Model<CatalogCategoryDocument> {
  const registered = connection.models.CatalogCategory as Model<CatalogCategoryDocument> | undefined
  if (registered) return registered
  return connection.model<CatalogCategoryDocument>('CatalogCategory', CatalogCategorySchema, 'catalog_categories')
}

/** Only adds missing indexes; dropping is never done by the app. */
export async function syncCatalogIndexes(connection: Connection): Promise<void> {
  await catalogItemModel(connection).createIndexes()
  await catalogCategoryModel(connection).createIndexes()
}
