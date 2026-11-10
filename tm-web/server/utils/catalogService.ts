import mongoose from 'mongoose'
import type { H3Event } from 'h3'
import { escapeRegExp, toNormalize } from '@tm/flow-utils'
import type {
  PublicCatalogCategory,
  PublicCatalogItemDetail,
  PublicCatalogItemSummary,
  PublicCatalogQuery,
  PublicCatalogSort,
} from '@tm/flow-contracts'
import {
  CatalogItemCategoryModel,
  CatalogItemModel,
  CATALOG_CATEGORY_PROJECTION,
  CATALOG_ITEM_DETAIL_PROJECTION,
  CATALOG_ITEM_SITEMAP_PROJECTION,
  CATALOG_ITEM_SUMMARY_PROJECTION,
} from '#server/models/catalog'
import { getMongoTarget, withCatalogDb } from './mongo'
import {
  toCatalogCategory,
  toCatalogItemDetail,
  toCatalogItemSummary,
  toCatalogSitemapEntry,
  type CatalogMappingContext,
  type CatalogRecord,
} from './catalogMapper'

export interface CatalogListResult {
  items: PublicCatalogItemSummary[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

// Only published, active, non-deleted records are ever readable by a visitor.
export const PUBLISHED_ITEM_FILTER = {
  isDeleted: { $ne: true },
  isActive: true,
  status: 'published',
} as const

const LIVE_CATEGORY_FILTER = { isDeleted: { $ne: true } } as const

/**
 * Upper bound for sitemap rows. A sitemap protocol file may hold 50k URLs; the
 * remaining pages are crawled through the listing and category pages instead of
 * loading every published product into memory.
 */
const CATALOG_SITEMAP_LIMIT = 5000

const SORT_MAP: Record<PublicCatalogSort, Record<string, 1 | -1>> = {
  newest: { updatedAt: -1, _id: -1 },
  'price-asc': { basePrice: 1, _id: 1 },
  'price-desc': { basePrice: -1, _id: -1 },
  'name-asc': { 'title.vi': 1, _id: 1 },
  popular: { sales: -1, views: -1, _id: -1 },
}

export function getCatalogCurrency(event: H3Event): string {
  const config = useRuntimeConfig(event)
  return String(config.public.currency || 'VND')
}

async function loadCategoriesById(ids: string[]): Promise<Map<string, CatalogRecord>> {
  const map = new Map<string, CatalogRecord>()
  if (!ids.length) return map

  const docs = await CatalogItemCategoryModel
    .find({ _id: { $in: ids } }, CATALOG_CATEGORY_PROJECTION)
    .lean()

  for (const doc of docs as unknown as CatalogRecord[]) {
    map.set(String(doc._id), doc)
  }
  return map
}

function buildMappingContext(currency: string, categories: Map<string, CatalogRecord>): CatalogMappingContext {
  return { currency, categoriesById: categories }
}

function objectIds(ids: string[]) {
  return ids
    .filter(id => mongoose.Types.ObjectId.isValid(id))
    .map(id => new mongoose.Types.ObjectId(id))
}

/**
 * Resolves a `category` filter to every category id in its subtree.
 * The CMS stores the ancestor ids on each category, so descendants are one
 * indexed lookup instead of walking parent pointers.
 */
async function resolveCategoryIds(value: string): Promise<string[] | null> {
  if (mongoose.Types.ObjectId.isValid(value)) return [value]

  const category = await CatalogItemCategoryModel.findOne(
    { ...LIVE_CATEGORY_FILTER, $or: [{ 'slug.vi': value }, { 'slug.en': value }] },
    '_id'
  ).lean()

  if (!category) return null

  const id = String((category as unknown as CatalogRecord)._id)
  const descendants = await CatalogItemCategoryModel
    .find({ ...LIVE_CATEGORY_FILTER, ancestors: new mongoose.Types.ObjectId(id) }, '_id')
    .lean()

  return [id, ...(descendants as unknown as CatalogRecord[]).map(doc => String(doc._id))]
}

export async function listCatalogItems(event: H3Event, query: PublicCatalogQuery): Promise<CatalogListResult> {
  const currency = getCatalogCurrency(event)

  return withCatalogDb(event, async () => {
    const filter: Record<string, unknown> = { ...PUBLISHED_ITEM_FILTER }
    const empty: CatalogListResult = { items: [], total: 0, page: query.page, limit: query.limit, hasMore: false }

    if (query.category) {
      const ids = await resolveCategoryIds(query.category)
      if (!ids) return empty
      filter.categories = { $in: objectIds(ids) }
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      const range: Record<string, number> = {}
      if (query.minPrice !== undefined) range.$gte = query.minPrice
      if (query.maxPrice !== undefined) range.$lte = query.maxPrice
      filter.basePrice = range
    }

    if (query.search) {
      const normalized = escapeRegExp(toNormalize(query.search).trim())
      const raw = escapeRegExp(query.search.trim())
      filter.$or = [
        { searchString: { $regex: normalized, $options: 'i' } },
        { sku: { $regex: raw, $options: 'i' } },
      ]
    }

    const skip = (query.page - 1) * query.limit

    const [docs, total] = await Promise.all([
      CatalogItemModel
        .find(filter, CATALOG_ITEM_SUMMARY_PROJECTION)
        .sort(SORT_MAP[query.sort])
        .skip(skip)
        .limit(query.limit)
        .lean(),
      CatalogItemModel.countDocuments(filter),
    ])

    const records = docs as unknown as CatalogRecord[]

    const categoryIds = new Set<string>()
    for (const record of records) {
      for (const raw of Array.isArray(record.categories) ? record.categories : []) {
        categoryIds.add(String(raw))
      }
    }

    const context = buildMappingContext(currency, await loadCategoriesById([...categoryIds]))

    const items: PublicCatalogItemSummary[] = []
    for (const record of records) {
      const mapped = toCatalogItemSummary(record, context)
      if (mapped) items.push(mapped)
    }

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      hasMore: skip + records.length < total,
    }
  })
}

export async function getCatalogItemBySlug(event: H3Event, slug: string): Promise<PublicCatalogItemDetail | null> {
  const currency = getCatalogCurrency(event)

  return withCatalogDb(event, async () => {
    const doc = await CatalogItemModel
      .findOne(
        {
          ...PUBLISHED_ITEM_FILTER,
          $or: [
            { 'slug.vi': slug },
            { 'slug.en': slug },
            { 'fullPath.vi': slug },
            { 'fullPath.en': slug },
          ],
        },
        CATALOG_ITEM_DETAIL_PROJECTION
      )
      .sort({ updatedAt: -1, _id: -1 })
      .lean()

    if (!doc) return null

    const record = doc as unknown as CatalogRecord
    const categoryIds = (Array.isArray(record.categories) ? record.categories : []).map(raw => String(raw))
    const context = buildMappingContext(currency, await loadCategoriesById(categoryIds))

    return toCatalogItemDetail(record, context)
  })
}

export async function listCatalogCategories(event: H3Event): Promise<PublicCatalogCategory[]> {
  return withCatalogDb(event, async () => {
    const docs = await CatalogItemCategoryModel
      .find(LIVE_CATEGORY_FILTER, CATALOG_CATEGORY_PROJECTION)
      .sort({ displayOrder: 1, 'title.vi': 1 })
      .lean()

    const categories: PublicCatalogCategory[] = []
    for (const doc of docs as unknown as CatalogRecord[]) {
      const mapped = toCatalogCategory(doc)
      if (mapped) categories.push(mapped)
    }
    return categories
  })
}

export async function getCatalogCategoryBySlug(event: H3Event, slug: string): Promise<PublicCatalogCategory | null> {
  return withCatalogDb(event, async () => {
    const doc = await CatalogItemCategoryModel
      .findOne({ ...LIVE_CATEGORY_FILTER, $or: [{ 'slug.vi': slug }, { 'slug.en': slug }] }, CATALOG_CATEGORY_PROJECTION)
      .lean()

    if (!doc) return null
    return toCatalogCategory(doc as unknown as CatalogRecord)
  })
}

/**
 * Product URLs for `sitemap.xml`. A site without a catalog binding still serves
 * a sitemap, so a missing database yields no rows instead of an error page.
 */
export async function listCatalogSitemapEntries(event: H3Event): Promise<{ path: string, lastmod: string | null }[]> {
  if (!getMongoTarget(event)) return []

  return withCatalogDb(event, async () => {
    const docs = await CatalogItemModel
      .find(PUBLISHED_ITEM_FILTER, CATALOG_ITEM_SITEMAP_PROJECTION)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(CATALOG_SITEMAP_LIMIT)
      .lean()

    const entries: { path: string, lastmod: string | null }[] = []
    const seen = new Set<string>()
    for (const doc of docs as unknown as CatalogRecord[]) {
      const entry = toCatalogSitemapEntry(doc)
      if (!entry || seen.has(entry.path)) continue
      seen.add(entry.path)
      entries.push(entry)
    }
    return entries
  })
}

/**
 * Category landing pages (`/categories/<slug>`) for the sitemap. Same live
 * filter as the category API, so a deleted category never becomes a crawler
 * target; a category without a usable slug is skipped.
 */
export async function listCatalogCategorySitemapEntries(event: H3Event): Promise<{ path: string, lastmod: string | null }[]> {
  if (!getMongoTarget(event)) return []

  return withCatalogDb(event, async () => {
    const docs = await CatalogItemCategoryModel
      .find(LIVE_CATEGORY_FILTER, CATALOG_CATEGORY_PROJECTION)
      .sort({ displayOrder: 1, 'title.vi': 1 })
      .lean()

    const entries: { path: string, lastmod: string | null }[] = []
    const seen = new Set<string>()
    for (const doc of docs as unknown as CatalogRecord[]) {
      const category = toCatalogCategory(doc)
      const path = category?.path ?? ''
      if (!path || seen.has(path)) continue
      seen.add(path)
      entries.push({ path, lastmod: null })
    }
    return entries
  })
}
