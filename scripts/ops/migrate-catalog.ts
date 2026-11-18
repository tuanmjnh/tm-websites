import process from 'node:process'
import { Types } from 'mongoose'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { buildSearchString } from '../../tm-cms/server/models/catalog.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'
import {
  asLegacyRecord,
  legacyCatalogStatus,
  legacyAttributeList,
  legacyImageList,
  legacyImageUrl,
  legacyLocalized,
  legacyNumber,
  legacySlugMap,
  legacyTags,
  legacyText,
} from '../../tm-cms/server/utils/legacyImport.js'

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


const siteId = flag('site') || process.env.TM_CUSTOMER_ID
const uri = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'
const database = process.env.TM_MONGO_DB
const apply = process.argv.includes('--apply')

if (!siteId) throw new Error('Pass --site <customerId> or set TM_CUSTOMER_ID')
if (!database) throw new Error('Set TM_MONGO_DB to the customer database name')

const connection = await connectDatabase({ uri, database })
try {
  // Planning reads the target collections raw, and the models are prepared only
  // with `--apply`: `prepareDatabase` creates indexes and writes migration rows,
  // which a dry run must not do to a customer database.
  const legacyCategories = await connection.collection('item_categories').find({}).toArray()
  const legacyItems = await connection.collection('items').find({}).toArray()

  const categoryIdByLegacy = new Map<string, Types.ObjectId>()
  const categoryKeyByLegacy = new Map<string, string>()

  for (const record of legacyCategories) {
    const slug = legacySlugMap(record.slug)
    const fallback = legacyText(asLegacyRecord(record.fullPath).vi).split('/').filter(Boolean).pop()
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
  // Every stored category owns its (default-locale) slug, not only a migrated one.
  const categorySlugOwners = new Map<string, string>()
  for (const row of await connection.collection('catalog_categories').find({ siteId }, { projection: { legacyId: 1, key: 1, slug: 1 } }).toArray()) {
    if (row.legacyId) existingCategoryKeys.set(String(row.legacyId), row.key as string)
    const slug = (row.slug as Record<string, string> | undefined)?.vi
    if (slug) categorySlugOwners.set(slug, row.key as string)
  }
  const existingItemKeys = new Map<string, string>()
  const existingItemSlugs = new Map<string, string>()
  for (const row of await connection.collection('catalog_items').find({ siteId, legacyId: { $ne: null } }, { projection: { legacyId: 1, key: 1, slug: 1 } }).toArray()) {
    existingItemKeys.set(String(row.legacyId), row.key as string)
    const slug = (row.slug as Record<string, string> | undefined)?.vi
    if (slug) existingItemSlugs.set(String(row.legacyId), slug)
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

  // `(siteId, slug.vi)` is unique for a category, and two legacy categories (or an
  // editor's own category) can hold the same slug: keeping both made `--apply` die
  // halfway with E11000, after rows had already been written.
  const categorySlugConflicts: string[] = []

  const plannedCategories = legacyCategories.map((record) => {
    const legacyId = String(record._id)
    const key = uniqueKey(categoryKeyByLegacy.get(legacyId)!, legacyId, usedCategoryKeys, existingCategoryKeys)
    const slug = legacySlugMap(record.slug)
    if (!slug.vi && key) slug.vi = key
    const owner = categorySlugOwners.get(slug.vi)
    if (owner !== undefined && owner !== key) {
      const original = slug.vi
      slug.vi = `${original}-${legacyId.slice(-6)}`
      categorySlugConflicts.push(`${key}: ${original} was taken by ${owner}, stored as ${slug.vi}`)
    }
    categorySlugOwners.set(slug.vi, key)
    return {
      legacyId,
      key,
      title: legacyLocalized(record.title, 200),
      slug,
      fullPath: legacyLocalized(record.fullPath, 500),
      description: legacyLocalized(record.description, 500),
      thumbnail: legacyImageUrl(record.thumbnail),
      order: legacyNumber(record.displayOrder),
      parentLegacyId: record.pid ? String(record.pid) : null,
      ancestorsLegacyIds: Array.isArray(record.ancestors)
        ? record.ancestors.map(entry => asLegacyRecord(entry)._id).filter(Boolean).map(String)
        : [],
      legacySeo: {
        title: legacyLocalized(asLegacyRecord(record.seo).title, 200),
        description: legacyLocalized(asLegacyRecord(record.seo).description, 500),
      },
    }
  })

  const usedItemSlugs = new Set(existingItemSlugs.values())

  const plannedItems = legacyItems.map((record) => {
    const legacyId = String(record._id)
    const slug = legacySlugMap(record.slug)
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
    const title = legacyLocalized(record.title, 200)
    const isActive = record.isActive !== false
    const status = legacyCatalogStatus(record)

    return {
      legacyId,
      key,
      title,
      slug,
      shortDesc: legacyLocalized(record.shortDesc, 500),
      description: legacyLocalized(record.description),
      thumbnail: legacyImageUrl(record.thumbnail),
      gallery: legacyImageList(record.gallery),
      basePrice: legacyNumber(record.basePrice),
      salePrice: record.salePrice === undefined || record.salePrice === null ? null : legacyNumber(record.salePrice),
      sku: legacyText(record.sku),
      barcode: legacyText(record.barcode),
      uom: legacyText(record.uom),
      type: legacyText(record.type) === 'variable' ? 'variable' : 'simple',
      stock: legacyNumber(record.stock),
      manageStock: record.manageStock !== false,
      tags: legacyTags(record.tags),
      attributes: legacyAttributeList(record.attributes),
      variants: Array.isArray(record.variants)
        ? record.variants.map((entry) => {
            const variant = asLegacyRecord(entry)
            return {
              sku: legacyText(variant.sku),
              name: legacyLocalized(variant.name, 200),
              basePrice: legacyNumber(variant.basePrice),
              salePrice: variant.salePrice === undefined || variant.salePrice === null ? null : legacyNumber(variant.salePrice),
              stock: legacyNumber(variant.stock),
              manageStock: variant.manageStock !== false,
              isActive: variant.isActive !== false,
              attributes: legacyAttributeList(variant.attributes),
            }
          }).filter(variant => variant.sku)
        : [],
      seo: {
        title: legacyLocalized(asLegacyRecord(record.seo).title, 200),
        description: legacyLocalized(asLegacyRecord(record.seo).description, 500),
        image: legacyImageUrl(asLegacyRecord(record.seo).image) ?? '',
      },
      status,
      isActive,
      isDeleted: record.isDeleted === true,
      sales: legacyNumber(record.sales),
      views: legacyNumber(record.views),
      publishedAt: record.publishedAt ? new Date(record.publishedAt as string) : null,
      categoryLegacyIds: Array.isArray(record.categories) ? record.categories.map(String) : [],
    }
  })

  console.log(`catalog migration site=${siteId} db=${database} apply=${apply}`)
  console.log(`  categories ${plannedCategories.length}, items ${plannedItems.length}`)
  if (categorySlugConflicts.length) {
    console.log(`  category slug conflicts resolved ${categorySlugConflicts.length}`)
    for (const conflict of categorySlugConflicts.slice(0, 10)) console.log(`    ${conflict}`)
  }

  if (!apply) {
    console.log('  nothing was written; rerun with --apply')
  } else {
    const { CatalogItem, CatalogCategory } = await prepareDatabase(connection)
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
