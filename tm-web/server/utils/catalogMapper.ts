import {
  catalogCategoryPath,
  catalogItemPath,
  type PublicCatalogAttribute,
  type PublicCatalogCategory,
  type PublicCatalogCategoryRef,
  type PublicCatalogItemDetail,
  type PublicCatalogItemSummary,
  type PublicCatalogVariant,
} from '@tm/flow-contracts'
import { getImage, getItemDisplayPrice, pickLocalized, toLocalizedString } from '@tm/flow-utils'

const DEFAULT_LOCALE = 'vi'
const PLACEHOLDER_IMAGE = '/placeholder.png'

export type CatalogRecord = Record<string, unknown>

export interface CatalogMappingContext {
  currency: string
  categoriesById: Map<string, CatalogRecord>
}

function asRecord(value: unknown): CatalogRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as CatalogRecord
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toIsoDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function realImage(value: unknown): string | null {
  const url = getImage(value)
  return url && url !== PLACEHOLDER_IMAGE ? url : null
}

/**
 * Public slug for a record. URLs are locale-free, so the default-locale slug
 * wins; a record without one falls back to the last segment of its full path.
 */
function canonicalSlug(record: CatalogRecord): string {
  const fromSlug = pickLocalized(record.slug as never, DEFAULT_LOCALE).trim().toLowerCase()
  if (fromSlug) return fromSlug

  const fullPath = pickLocalized(record.fullPath as never, DEFAULT_LOCALE)
  const last = fullPath.split('/').map(part => part.trim()).filter(Boolean).pop() ?? ''
  return last.toLowerCase()
}

/**
 * Sitemap row for a published product. A record without a usable slug is
 * skipped instead of producing the landing page URL twice.
 */
export function toCatalogSitemapEntry(record: CatalogRecord): { path: string, lastmod: string | null } | null {
  const slug = canonicalSlug(record)
  if (!slug) return null
  return { path: catalogItemPath(slug), lastmod: toIsoDate(record.updatedAt) }
}

/**
 * Sitemap row for a live category landing page. The page changes when the
 * category record does, so it carries the same freshness stamp a product row
 * does; a category without a path is skipped.
 */
export function toCatalogCategorySitemapEntry(record: CatalogRecord): { path: string, lastmod: string | null } | null {
  const category = toCatalogCategory(record)
  if (!category?.path) return null
  return { path: category.path, lastmod: toIsoDate(record.updatedAt) }
}

function toImages(value: unknown): string[] {
  const list = Array.isArray(value) ? value : []
  const images: string[] = []

  for (const entry of list) {
    if (typeof entry === 'string' && entry.trim()) {
      images.push(entry.trim())
      continue
    }
    const record = asRecord(entry)
    const url = record?.url ?? record?.secure_url
    if (typeof url === 'string' && url.trim()) images.push(url.trim())
  }

  return images
}

function toTags(value: unknown): string[] {
  const list = Array.isArray(value) ? value : []
  const tags: string[] = []

  for (const entry of list) {
    if (typeof entry === 'string' && entry.trim()) {
      tags.push(entry.trim())
      continue
    }
    const record = asRecord(entry)
    const label = record?.slug ?? record?.title ?? record?.name
    if (typeof label === 'string' && label.trim()) tags.push(label.trim())
  }

  return tags
}

/** Handles both `{ k, v }` and `{ name, value }` attribute shapes. */
function toAttributes(value: unknown): PublicCatalogAttribute[] {
  const list = Array.isArray(value) ? value : []
  const attributes: PublicCatalogAttribute[] = []

  for (const entry of list) {
    const record = asRecord(entry)
    if (!record) continue

    const name = toLocalizedString(record.k ?? record.key ?? record.name ?? record.title)
    const text = toLocalizedString(record.v ?? record.value ?? record.label)
    if (Object.keys(name).length && Object.keys(text).length) {
      attributes.push({ name, value: text })
    }
  }

  return attributes
}

function isStocked(record: CatalogRecord): boolean {
  if (record.manageStock === false) return true
  const stock = Number(record.stock ?? 0)
  return Number.isFinite(stock) ? stock > 0 : true
}

/** A variable product is sellable while any of its active variants is stocked. */
function resolveAvailability(record: CatalogRecord): boolean {
  if (record.type === 'variable') {
    const variants = (Array.isArray(record.variants) ? record.variants : [])
      .map(asRecord)
      .filter((entry): entry is CatalogRecord => entry !== null && entry.isActive !== false)

    if (variants.length) return variants.some(isStocked)
  }

  return isStocked(record)
}

function toVariants(record: CatalogRecord): PublicCatalogVariant[] {
  const list = Array.isArray(record.variants) ? record.variants : []
  const variants: PublicCatalogVariant[] = []

  for (const entry of list) {
    const variant = asRecord(entry)
    if (!variant || variant.isActive === false) continue

    const { price, basePrice } = getItemDisplayPrice({
      type: 'simple',
      basePrice: toNumber(variant.basePrice),
      salePrice: toNumber(variant.salePrice),
    })

    const attributes = toAttributes(variant.attributes)
    const label = attributes
      .map(attribute => pickLocalized(attribute.value, DEFAULT_LOCALE))
      .filter(Boolean)
      .join(' / ')

    variants.push({
      sku: typeof variant.sku === 'string' && variant.sku.trim() ? variant.sku.trim() : undefined,
      ...(label ? { name: { [DEFAULT_LOCALE]: label } } : {}),
      price,
      compareAtPrice: basePrice > price ? basePrice : undefined,
      inStock: isStocked(variant),
    })
  }

  return variants
}

export function toCatalogCategoryRef(record: CatalogRecord): PublicCatalogCategoryRef | null {
  const id = record._id === undefined || record._id === null ? '' : String(record._id)
  const name = toLocalizedString(record.title)
  const slugText = toLocalizedString(record.slug)
  const canonical = canonicalSlug(record)
  if (!id || !canonical || !Object.keys(name).length) return null

  const path = catalogCategoryPath(canonical)
  if (!path) return null

  return {
    id,
    name,
    slug: Object.keys(slugText).length ? slugText : { [DEFAULT_LOCALE]: canonical },
    path,
  }
}

export function toCatalogCategory(record: CatalogRecord): PublicCatalogCategory | null {
  const ref = toCatalogCategoryRef(record)
  if (!ref) return null

  const description = toLocalizedString(record.description)
  const image = realImage(record.thumbnail)

  return {
    ...ref,
    ...(Object.keys(description).length ? { description } : {}),
    parentId: record.pid === undefined || record.pid === null ? null : String(record.pid),
    image,
  }
}

function resolveCategoryRefs(record: CatalogRecord, ctx: CatalogMappingContext): PublicCatalogCategoryRef[] {
  const list = Array.isArray(record.categories) ? record.categories : []
  const refs: PublicCatalogCategoryRef[] = []

  for (const raw of list) {
    const id = raw === undefined || raw === null ? '' : String(raw)
    const category = id ? ctx.categoriesById.get(id) : null
    if (!category) continue

    const ref = toCatalogCategoryRef(category)
    if (ref) refs.push(ref)
  }

  return refs
}

function resolveName(record: CatalogRecord, fallbackSlug: string): Record<string, string> {
  const name = toLocalizedString(record.title)
  return Object.keys(name).length ? name : { [DEFAULT_LOCALE]: fallbackSlug }
}

export function toCatalogItemSummary(
  record: CatalogRecord,
  ctx: CatalogMappingContext
): PublicCatalogItemSummary | null {
  const id = record._id === undefined || record._id === null ? '' : String(record._id)
  const canonical = canonicalSlug(record)
  if (!id || !canonical) return null

  const path = catalogItemPath(canonical)
  if (!path) return null

  const variantRecords = (Array.isArray(record.variants) ? record.variants : [])
    .map(asRecord)
    .filter((entry): entry is CatalogRecord => Boolean(entry))

  const { price, basePrice } = getItemDisplayPrice({
    type: typeof record.type === 'string' ? record.type : 'simple',
    basePrice: toNumber(record.basePrice),
    salePrice: toNumber(record.salePrice),
    variants: variantRecords.map(variant => ({
      basePrice: toNumber(variant.basePrice),
      salePrice: toNumber(variant.salePrice),
    })),
  })

  const summary = toLocalizedString(record.shortDesc)
  const slugText = toLocalizedString(record.slug)

  return {
    id,
    slug: Object.keys(slugText).length ? slugText : { [DEFAULT_LOCALE]: canonical },
    path,
    name: resolveName(record, canonical),
    ...(Object.keys(summary).length ? { summary } : {}),
    price,
    compareAtPrice: basePrice > price ? basePrice : undefined,
    currency: ctx.currency,
    thumbnail: realImage(record.thumbnail),
    categories: resolveCategoryRefs(record, ctx),
    tags: toTags(record.tags),
    inStock: resolveAvailability(record),
    updatedAt: toIsoDate(record.updatedAt),
  }
}

export function toCatalogItemDetail(
  record: CatalogRecord,
  ctx: CatalogMappingContext
): PublicCatalogItemDetail | null {
  const summary = toCatalogItemSummary(record, ctx)
  if (!summary) return null

  const description = toLocalizedString(record.description)
  const seo = asRecord(record.seo)
  const seoTitle = toLocalizedString(seo?.title)
  const seoDescription = toLocalizedString(seo?.description)
  const seoImage = seo ? realImage(seo.image) : null

  const hasSeo = Object.keys(seoTitle).length > 0 || Object.keys(seoDescription).length > 0 || Boolean(seoImage)

  return {
    ...summary,
    ...(Object.keys(description).length ? { description } : {}),
    sku: typeof record.sku === 'string' && record.sku.trim() ? record.sku.trim() : null,
    uom: typeof record.uom === 'string' && record.uom.trim() ? record.uom.trim() : null,
    gallery: toImages(record.gallery),
    variants: toVariants(record),
    attributes: toAttributes(record.attributes),
    seo: hasSeo
      ? {
          ...(Object.keys(seoTitle).length ? { title: seoTitle } : {}),
          ...(Object.keys(seoDescription).length ? { description: seoDescription } : {}),
          image: seoImage,
        }
      : undefined,
  }
}
