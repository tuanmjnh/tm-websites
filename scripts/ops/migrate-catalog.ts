import process from 'node:process'
import { Types } from 'mongoose'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { buildSearchString } from '../../tm-cms/server/models/catalog.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'
import {
  asLegacyRecord,
  legacyCatalogStatus,
  legacyAttributeList,
  legacyCollectionState,
  legacyDate,
  legacyEmptyDatabaseWarning,
  legacyImageList,
  legacyImageUrl,
  legacyLocalized,
  legacyNumber,
  legacySlugMap,
  legacyTags,
  legacyTenantBuckets,
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


/** Legacy keys the importer maps (or that mongoose owns). Everything else is reported. */
const CARRIED_ITEM_FIELDS = new Set([
  '_id', '__v', 'tenantId', 'title', 'slug', 'shortDesc', 'description', 'thumbnail', 'gallery',
  'basePrice', 'salePrice', 'sku', 'barcode', 'uom', 'type', 'stock', 'manageStock', 'tags',
  'attributes', 'variants', 'seo', 'status', 'isActive', 'isDeleted', 'deletedAt', 'publishedAt',
  'sales', 'views', 'categories', 'searchString', 'createdAt', 'updatedAt',
])

const CARRIED_CATEGORY_FIELDS = new Set([
  '_id', '__v', 'tenantId', 'title', 'slug', 'fullPath', 'description', 'thumbnail', 'displayOrder',
  'pid', 'ancestors', 'seo', 'createdAt', 'updatedAt', 'isDeleted', 'deletedAt',
])

type Raw = Record<string, unknown>

type LegacyAttribute = { name: Record<string, string>, value: Record<string, string> }

/**
 * A legacy variant names its option by code (`kich-thuoc`) while the item's own
 * `options` list holds the title and the value labels. Carrying only the code
 * would make the storefront label a size group "kich-thuoc".
 */
function withOptionLabels(
  attributes: LegacyAttribute[],
  options: unknown,
): { attributes: LegacyAttribute[], labelled: number } {
  const optionsByCode = new Map<string, { title: string, values: Map<string, string> }>()
  for (const entry of Array.isArray(options) ? options : []) {
    const option = entry !== null && typeof entry === 'object' ? entry as Raw : {}
    const code = String(option.code ?? '').trim().toLowerCase()
    if (!code) continue
    const values = new Map<string, string>()
    for (const valueEntry of Array.isArray(option.values) ? option.values : []) {
      const value = valueEntry !== null && typeof valueEntry === 'object' ? valueEntry as Raw : {}
      const key = String(value.value ?? '').trim().toLowerCase()
      const label = String(value.label ?? '').trim()
      if (key && label) values.set(key, label)
    }
    optionsByCode.set(code, { title: String(option.title ?? '').trim(), values })
  }

  let labelled = 0
  const mapped = attributes.map((attribute) => {
    const option = optionsByCode.get(String(attribute.name.vi ?? '').trim().toLowerCase())
    if (!option) return attribute
    const valueLabel = option.values.get(String(attribute.value.vi ?? '').trim().toLowerCase())
    labelled++
    return {
      name: option.title ? { vi: option.title } : attribute.name,
      value: valueLabel ? { vi: valueLabel } : attribute.value,
    }
  })
  return { attributes: mapped, labelled }
}

/** Counts the legacy fields that carry a value but have no column in the plan. */
function uncarriedFields(records: Raw[], carried: Set<string>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const record of records) {
    for (const [field, value] of Object.entries(record)) {
      if (carried.has(field) || field.startsWith('$')) continue
      const empty = value === null || value === undefined || value === ''
        || (Array.isArray(value) && value.length === 0)
      if (empty) continue
      counts[field] = (counts[field] ?? 0) + 1
    }
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]))
}

const siteId = flag('site') || process.env.TM_CUSTOMER_ID
// Same rule as the content importer: one legacy tenant per run. Catalog records
// written before tenancy carry no `tenantId`, so those are read too and counted
// in the report instead of being skipped silently.
const tenant = flag('tenant') || 'default'
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
  const tenantMatcher = { $or: [{ tenantId: tenant }, { tenantId: { $exists: false } }] }
  const legacyCategories = await connection.collection('item_categories').find(tenantMatcher).toArray()
  const legacyItems = await connection.collection('items').find(tenantMatcher).toArray()
  const legacyTenants = await legacyTenantBuckets(connection, ['items', 'item_categories'])
  const legacyState = await legacyCollectionState(connection, ['items', 'item_categories'])

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
      // A soft-deleted legacy category used to be revived as a live one, because
      // the write forced `isDeleted: false`.
      isDeleted: record.isDeleted === true,
      deletedAt: record.isDeleted === true
        ? legacyDate(record.deletedAt) ?? legacyDate(record.updatedAt) ?? legacyDate(record.createdAt)
        : null,
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
    const itemAttributes = withOptionLabels(legacyAttributeList(record.attributes), record.options)
    let variantOptionLabels = 0
    const plannedVariants = (Array.isArray(record.variants) ? record.variants : []).map((entry) => {
      const variant = asLegacyRecord(entry)
      const variantAttributes = withOptionLabels(legacyAttributeList(variant.attributes), record.options)
      variantOptionLabels += variantAttributes.labelled
      return {
        sku: legacyText(variant.sku),
        name: legacyLocalized(variant.name, 200),
        basePrice: legacyNumber(variant.basePrice),
        salePrice: variant.salePrice === undefined || variant.salePrice === null ? null : legacyNumber(variant.salePrice),
        stock: legacyNumber(variant.stock),
        manageStock: variant.manageStock !== false,
        isActive: variant.isActive !== false,
        attributes: variantAttributes.attributes,
      }
    }).filter(variant => variant.sku)

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
      attributes: itemAttributes.attributes,
      // Option titles read from the item's own options, for item and variant alike.
      optionLabels: itemAttributes.labelled + variantOptionLabels,
      variants: plannedVariants,
      seo: {
        title: legacyLocalized(asLegacyRecord(record.seo).title, 200),
        description: legacyLocalized(asLegacyRecord(record.seo).description, 500),
        image: legacyImageUrl(asLegacyRecord(record.seo).image) ?? '',
      },
      status,
      isActive,
      isDeleted: record.isDeleted === true,
      // A soft-deleted legacy row carries when it was deleted; the model has the
      // column, so losing it would only make the CMS show a deletion without a date.
      deletedAt: record.isDeleted === true
        ? legacyDate(record.deletedAt) ?? legacyDate(record.updatedAt) ?? legacyDate(record.createdAt)
        : null,
      sales: legacyNumber(record.sales),
      views: legacyNumber(record.views),
      publishedAt: record.publishedAt ? new Date(record.publishedAt as string) : null,
      categoryLegacyIds: Array.isArray(record.categories) ? record.categories.map(String) : [],
    }
  })

  // A legacy item can point at a category id its own copy does not hold (the local
  // `sen-tuan` copy has two such rows). The link is dropped because there is nothing
  // to point at — but silently: the row still counts as migrated, so parity stays
  // green while the product quietly loses its category. Report every one by name.
  const unresolvedCategoryRefs: { itemKey: string, categoryId: string }[] = []
  for (const item of plannedItems) {
    for (const categoryId of item.categoryLegacyIds) {
      if (!categoryKeyByLegacy.has(categoryId)) unresolvedCategoryRefs.push({ itemKey: item.key, categoryId })
    }
  }

  // What actually came through, field by field. A mapper that drops a field looks
  // exactly like clean data in the totals: `tags` was 0 of 241 items for a day
  // because nothing printed that number.
  const coverage = {
    tags: plannedItems.filter(item => item.tags.length).length,
    thumbnail: plannedItems.filter(item => item.thumbnail).length,
    gallery: plannedItems.filter(item => item.gallery.length).length,
    variants: plannedItems.filter(item => item.variants.length).length,
    // Per-variant options (`Kích thước = 160X200`) are the only place a variable
    // product says how its variants differ; a count of 0 here means the mapper lost them.
    variantAttributes: plannedItems.reduce((total, item) => total + item.variants.filter(variant => variant.attributes.length).length, 0),
    attributes: plannedItems.filter(item => item.attributes.length).length,
    // How many attribute labels came from the item's own option titles instead of
    // the raw legacy code.
    optionLabels: plannedItems.reduce((total, item) => total + item.optionLabels, 0),
    sku: plannedItems.filter(item => item.sku).length,
    barcode: plannedItems.filter(item => item.barcode).length,
    salePrice: plannedItems.filter(item => item.salePrice !== null).length,
    categories: plannedItems.filter(item => item.categoryLegacyIds.length).length,
    categoryThumbnail: plannedCategories.filter(category => category.thumbnail).length,
  }

  console.log(`catalog migration site=${siteId} db=${database} tenant=${tenant} apply=${apply}`)
  console.log(`  categories ${plannedCategories.length}, items ${plannedItems.length}`)
  console.log(`  field coverage ${JSON.stringify(coverage)}`)
  console.log(`  legacy tenants ${JSON.stringify(legacyTenants)}`)
  // Which legacy fields the plan does not carry, counted. The v2 schema decides
  // this (inventory fields wait on P5), but the reader is entitled to know that
  // `supplierPrices` or `minStock` exists in the source and did not land.
  console.log(`  legacy item fields not carried ${JSON.stringify(uncarriedFields(legacyItems, CARRIED_ITEM_FIELDS))}`)
  console.log(`  legacy category fields not carried ${JSON.stringify(uncarriedFields(legacyCategories, CARRIED_CATEGORY_FIELDS))}`)
  if (!Object.keys(legacyTenants).length) {
    console.log(`  ⚠️  ${legacyEmptyDatabaseWarning(legacyState, database as string, 'items/item_categories')}`)
  } else if (!legacyItems.length && !legacyCategories.length) {
    console.log(`  ⚠️  no record matches --tenant ${tenant}; this database holds ${JSON.stringify(legacyTenants)}`)
  }
  if (categorySlugConflicts.length) {
    console.log(`  category slug conflicts resolved ${categorySlugConflicts.length}`)
    for (const conflict of categorySlugConflicts.slice(0, 10)) console.log(`    ${conflict}`)
  }
  if (unresolvedCategoryRefs.length) {
    console.log(`  unresolved item category references ${unresolvedCategoryRefs.length}`)
    for (const entry of unresolvedCategoryRefs.slice(0, 10)) {
      console.log(`    ${entry.itemKey}: category ${entry.categoryId} does not exist in item_categories`)
    }
  }

  if (!apply) {
    console.log('  nothing was written; rerun with --apply')
  } else {
    const { CatalogItem, CatalogCategory } = await prepareDatabase(connection)
    // Parents must be written before their children so `categoryIdByLegacy`
    // already holds the parent's v2 id when a child resolves its `parent`.
    // Legacy rows arrive in storage order, which is not topological.
    const categoriesByLegacyId = new Map(plannedCategories.map(planned => [planned.legacyId, planned]))
    const legacyCategoryDepth = (planned: (typeof plannedCategories)[number], seen = new Set<string>()): number => {
      if (!planned.parentLegacyId || !categoriesByLegacyId.has(planned.parentLegacyId)) return 0
      if (seen.has(planned.legacyId)) return 0
      seen.add(planned.legacyId)
      return 1 + legacyCategoryDepth(categoriesByLegacyId.get(planned.parentLegacyId)!, seen)
    }
    const orderedCategories = [...plannedCategories].sort((a, b) => legacyCategoryDepth(a) - legacyCategoryDepth(b))
    for (const planned of orderedCategories) {
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
            isDeleted: planned.isDeleted,
            deletedAt: planned.deletedAt,
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
            deletedAt: planned.deletedAt,
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

    // A write loop can stop half-way and still print a healthy line. Re-read what the
    // plan expects and fail the command when the database does not hold it.
    const expectedLegacyIds = plannedItems.map(planned => planned.legacyId)
    const expectedCategoryIds = plannedCategories.map(planned => planned.legacyId)
    const foundItems = expectedLegacyIds.length
      ? await connection.collection('catalog_items').countDocuments({ siteId, legacyId: { $in: expectedLegacyIds } })
      : 0
    const foundCategories = expectedCategoryIds.length
      ? await connection.collection('catalog_categories').countDocuments({ siteId, legacyId: { $in: expectedCategoryIds } })
      : 0

    console.log(`  wrote ${categoryIdByLegacy.size} categories and ${written} items`)
    console.log(`  verified ${foundCategories}/${expectedCategoryIds.length} categories, ${foundItems}/${expectedLegacyIds.length} items`)
    if (foundItems !== expectedLegacyIds.length || foundCategories !== expectedCategoryIds.length) {
      console.log('  ⚠️  the database does not hold every planned record; rerun the command and read the first error above')
      process.exitCode = 1
    }
    console.log('  legacy collections were not modified; storefront now reads the new collections')
  }
} finally {
  await closeDatabaseConnections()
}
