import process from 'node:process'
import { Types } from 'mongoose'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { buildSearchString } from '../../tm-cms/server/models/catalog.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'

/**
 * `pnpm migrate:catalog --site sentuan [--apply]`
 *
 * Copies the legacy storefront collections (`items`, `item_categories`) into the
 * CMS-owned `catalog_items` / `catalog_categories`. Dry run unless `--apply` is
 * passed; re-running updates rows previously migrated (matched by `legacyId`)
 * and never deletes either collection, so the legacy data stays readable until
 * an operator removes it deliberately.
 *
 * The legacy documents are read raw (`strict:false`), never through a model:
 * their shape is not a write schema and must not become one.
 */

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

type Raw = Record<string, unknown>

function asRecord(value: unknown): Raw {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function localized(value: unknown, max = 5000): Record<string, string> {
  const source = asRecord(value)
  const result: Record<string, string> = {}
  for (const [locale, entry] of Object.entries(source)) {
    const value = text(entry)
    if (value) result[locale] = value.slice(0, max)
  }
  return result
}

function imageUrl(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Raw
  return text(record.url) || text(record.secure_url) || text(record.src) || null
}

function imageList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(imageUrl).filter((entry): entry is string => Boolean(entry))
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function slugMap(value: unknown): Record<string, string> {
  const source = asRecord(value)
  const result: Record<string, string> = {}
  for (const [locale, entry] of Object.entries(source)) {
    const slug = text(entry).toLowerCase()
    if (slug) result[locale] = slug
  }
  return result
}

function localizedAttributes(value: unknown): { name: Record<string, string>, value: Record<string, string> }[] {
  if (!Array.isArray(value)) return []
  const list: { name: Record<string, string>, value: Record<string, string> }[] = []
  for (const entry of value) {
    const record = asRecord(entry)
    const name = localized(record.k ?? record.key ?? record.name ?? record.title, 200)
    const text = localized(record.v ?? record.value ?? record.label, 500)
    if (Object.keys(name).length && Object.keys(text).length) list.push({ name, value: text })
  }
  return list
}

const siteId = flag('site') || process.env.TM_CUSTOMER_ID
const uri = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'
const database = process.env.TM_MONGO_DB
const apply = process.argv.includes('--apply')

if (!siteId) throw new Error('Pass --site <customerId> or set TM_CUSTOMER_ID')
if (!database) throw new Error('Set TM_MONGO_DB to the customer database name')

const connection = await connectDatabase({ uri, database })
try {
  const { CatalogItem, CatalogCategory } = await prepareDatabase(connection)
  const legacyCategories = await connection.collection('item_categories').find({}).toArray()
  const legacyItems = await connection.collection('items').find({}).toArray()

  const categoryIdByLegacy = new Map<string, Types.ObjectId>()
  const categoryKeyByLegacy = new Map<string, string>()

  for (const record of legacyCategories) {
    const slug = slugMap(record.slug)
    const fallback = text(asRecord(record.fullPath).vi).split('/').filter(Boolean).pop()
    const key = slug.vi || fallback || `category-${String(record._id)}`
    categoryKeyByLegacy.set(String(record._id), key)
  }

  // A legacy collection can hold two documents with the same slug; the CMS
  // collection has a unique (siteId, key), so the second one gets a suffix
  // instead of being merged into the first.
  const usedCategoryKeys = new Set<string>()
  const usedItemKeys = new Set<string>()

  // A re-run must keep the key a row already has, otherwise a rename between
  // runs would look like a new record and collide with the old one.
  const existingCategoryKeys = new Map<string, string>()
  for (const row of await CatalogCategory.find({ siteId, legacyId: { $ne: null } }, 'legacyId key').lean()) {
    if (row.legacyId) existingCategoryKeys.set(String(row.legacyId), row.key)
  }
  const existingItemKeys = new Map<string, string>()
  const existingItemSlugs = new Map<string, string>()
  for (const row of await CatalogItem.find({ siteId, legacyId: { $ne: null } }, 'legacyId key slug').lean()) {
    if (row.legacyId) {
      existingItemKeys.set(String(row.legacyId), row.key)
      const slug = (row.slug as Record<string, string> | undefined)?.vi
      if (slug) existingItemSlugs.set(String(row.legacyId), slug)
    }
  }
  // Keys already stored belong to a migrated row; reserve them before planning so
  // a second legacy document with the same slug cannot take the same key.
  for (const key of existingItemKeys.values()) usedItemKeys.add(key)
  for (const key of existingCategoryKeys.values()) usedCategoryKeys.add(key)

  function uniqueKey(candidate: string, legacyId: string, used: Set<string>, existing: Map<string, string>): string {
    const keep = existing.get(legacyId)
    if (keep) {
      used.add(keep)
      return keep
    }
    const base = candidate || `legacy-${legacyId}`
    if (!used.has(base)) {
      used.add(base)
      return base
    }
    const suffixed = `${base}-${legacyId.slice(-6)}`
    used.add(suffixed)
    return suffixed
  }

  const plannedCategories = legacyCategories.map((record) => {
    const legacyId = String(record._id)
    const key = uniqueKey(categoryKeyByLegacy.get(legacyId)!, legacyId, usedCategoryKeys, existingCategoryKeys)
    const slug = slugMap(record.slug)
    if (!slug.vi && key) slug.vi = key
    return {
      legacyId,
      key,
      title: localized(record.title, 200),
      slug,
      fullPath: localized(record.fullPath, 500),
      description: localized(record.description, 500),
      thumbnail: imageUrl(record.thumbnail),
      order: number(record.displayOrder),
      parentLegacyId: record.pid ? String(record.pid) : null,
      ancestorsLegacyIds: Array.isArray(record.ancestors)
        ? record.ancestors.map(entry => asRecord(entry)._id).filter(Boolean).map(String)
        : [],
      legacySeo: {
        title: localized(asRecord(record.seo).title, 200),
        description: localized(asRecord(record.seo).description, 500),
      },
    }
  })

  const usedItemSlugs = new Set(existingItemSlugs.values())

  const plannedItems = legacyItems.map((record) => {
    const legacyId = String(record._id)
    const slug = slugMap(record.slug)
    const key = uniqueKey(slug.vi || `item-${legacyId}`, legacyId, usedItemKeys, existingItemKeys)

    // The public URL is the default-locale slug and it is unique per site; two
    // legacy rows sharing one slug keep their own URL instead of one being lost.
    const keptSlug = existingItemSlugs.get(legacyId)
    if (keptSlug) {
      slug.vi = keptSlug
    } else if (slug.vi) {
      if (usedItemSlugs.has(slug.vi)) slug.vi = `${slug.vi}-${legacyId.slice(-6)}`
      usedItemSlugs.add(slug.vi)
    }
    const title = localized(record.title, 200)
    const isActive = record.isActive !== false
    const legacyStatus = text(record.status)
    const status = record.isDeleted === true
      ? 'deleted'
      : (legacyStatus === 'published' && isActive ? 'published' : (legacyStatus === 'archived' ? 'archived' : 'draft'))

    return {
      legacyId,
      key,
      title,
      slug,
      shortDesc: localized(record.shortDesc, 500),
      description: localized(record.description),
      thumbnail: imageUrl(record.thumbnail),
      gallery: imageList(record.gallery),
      basePrice: number(record.basePrice),
      salePrice: record.salePrice === undefined || record.salePrice === null ? null : number(record.salePrice),
      sku: text(record.sku),
      uom: text(record.uom),
      type: text(record.type) === 'variable' ? 'variable' : 'simple',
      stock: number(record.stock),
      manageStock: record.manageStock !== false,
      tags: Array.isArray(record.tags)
        ? [...new Set(record.tags.map(text).filter(Boolean))]
        : [],
      attributes: localizedAttributes(record.attributes),
      variants: Array.isArray(record.variants)
        ? record.variants.map((entry) => {
            const variant = asRecord(entry)
            return {
              sku: text(variant.sku),
              name: localized(variant.name, 200),
              basePrice: number(variant.basePrice),
              salePrice: variant.salePrice === undefined || variant.salePrice === null ? null : number(variant.salePrice),
              stock: number(variant.stock),
              manageStock: variant.manageStock !== false,
              isActive: variant.isActive !== false,
              attributes: localizedAttributes(variant.attributes),
            }
          }).filter(variant => variant.sku)
        : [],
      seo: {
        title: localized(asRecord(record.seo).title, 200),
        description: localized(asRecord(record.seo).description, 500),
        image: imageUrl(asRecord(record.seo).image) ?? '',
      },
      status,
      isActive,
      isDeleted: record.isDeleted === true,
      sales: number(record.sales),
      views: number(record.views),
      publishedAt: record.publishedAt ? new Date(record.publishedAt as string) : null,
      categoryLegacyIds: Array.isArray(record.categories) ? record.categories.map(String) : [],
    }
  })

  console.log(`catalog migration site=${siteId} db=${database} apply=${apply}`)
  console.log(`  categories ${plannedCategories.length}, items ${plannedItems.length}`)

  if (!apply) {
    console.log('  nothing was written; rerun with --apply')
  } else {
    for (const planned of plannedCategories) {
      const parent = planned.parentLegacyId ? categoryIdByLegacy.get(planned.parentLegacyId) ?? null : null
      const ancestors = planned.ancestorsLegacyIds
        .map(id => categoryIdByLegacy.get(id))
        .filter((id): id is Types.ObjectId => Boolean(id))

      const doc = await CatalogCategory.findOneAndUpdate(
        { siteId, legacyId: planned.legacyId },
        {
          $set: {
            key: planned.key,
            parent,
            pid: parent,
            ancestors,
            order: planned.order,
            displayOrder: planned.order,
            title: planned.title,
            slug: planned.slug,
            fullPath: planned.fullPath,
            description: planned.description,
            thumbnail: planned.thumbnail,
            seo: planned.legacySeo,
            isDeleted: false,
            legacyId: planned.legacyId,
          },
          $setOnInsert: { siteId, revision: 1 },
        },
        { upsert: true, returnDocument: 'after' },
      ).lean<{ _id: Types.ObjectId }>()
      if (doc?._id) categoryIdByLegacy.set(planned.legacyId, doc._id)
    }

    let written = 0
    for (const planned of plannedItems) {
      const categories = planned.categoryLegacyIds
        .map(id => categoryIdByLegacy.get(id))
        .filter((id): id is Types.ObjectId => Boolean(id))

      await CatalogItem.findOneAndUpdate(
        { siteId, legacyId: planned.legacyId },
        {
          $set: {
            key: planned.key,
            title: planned.title,
            slug: planned.slug,
            shortDesc: planned.shortDesc,
            description: planned.description,
            thumbnail: planned.thumbnail,
            gallery: planned.gallery,
            basePrice: planned.basePrice,
            salePrice: planned.salePrice,
            sku: planned.sku,
            uom: planned.uom,
            type: planned.type,
            stock: planned.stock,
            manageStock: planned.manageStock,
            categories,
            tags: planned.tags,
            attributes: planned.attributes,
            variants: planned.variants,
            seo: planned.seo,
            status: planned.status,
            isActive: planned.isActive,
            isDeleted: planned.isDeleted,
            publishedAt: planned.publishedAt,
            sales: planned.sales,
            views: planned.views,
            legacyId: planned.legacyId,
            searchString: buildSearchString({
              title: planned.title,
              slug: planned.slug,
              sku: planned.sku,
              shortDesc: planned.shortDesc,
              tags: planned.tags,
            }),
          },
          $setOnInsert: { siteId, revision: 1 },
        },
        { upsert: true },
      )
      written++
    }

    console.log(`  wrote ${categoryIdByLegacy.size} categories and ${written} items`)
    console.log('  legacy collections were not modified; storefront now reads the new collections')
  }
} finally {
  await closeDatabaseConnections()
}
