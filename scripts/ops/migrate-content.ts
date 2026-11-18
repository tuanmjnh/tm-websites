import process from 'node:process'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import {
  ATTRIBUTE_VALUE_MAX_LENGTH,
  CONTENT_SCHEMA_VERSION,
  KEYWORD_MAX_LENGTH,
  KEYWORDS_MAX_COUNT,
  normalizeContentInput,
  normalizeSlug,
} from '../../tm-cms/server/models/content.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'
import {
  asLegacyRecord,
  legacyContentAttributes,
  legacyContentStatus,
  legacyDate,
  legacyKeywords,
  legacyList,
  legacyLocalized,
  legacyNumber,
  legacyTags,
  legacyText,
} from '../../tm-cms/server/utils/legacyImport.js'

/**
 * `pnpm migrate:content --site sentuan [--tenant default] [--apply]`
 *
 * Copies the legacy editorial collections (`contents`, `content_categories`)
 * into the CMS-owned `content` / `categories`. Dry run unless `--apply` is
 * passed; re-running updates the rows it already migrated and never deletes or
 * modifies the legacy collections.
 *
 * What the v2 schema cannot hold stays in per-record `legacy.*` attributes
 * (body template, thumbnail URL, sort weight, home flag) instead of being
 * silently dropped. Legacy `gallery` and media-embed lists have no column and
 * are reported by the dry run, not written as invalid media ids.
 *
 * The legacy documents are read raw (`strict:false`), never through a model:
 * their shape is not a write schema and must not become one.
 */

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const siteId = flag('site') || process.env.TM_CUSTOMER_ID
const tenant = flag('tenant') || 'default'
const uri = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'
const database = process.env.TM_MONGO_DB
const apply = process.argv.includes('--apply')

if (!siteId) throw new Error('Pass --site <customerId> or set TM_CUSTOMER_ID')
if (!database) throw new Error('Set TM_MONGO_DB to the customer database name')

const connection = await connectDatabase({ uri, database })
try {
  const tenantFilter = { tenantId: tenant }
  const legacyCategories = await connection.collection('content_categories').find(tenantFilter).toArray()
  const legacyContents = await connection.collection('contents').find(tenantFilter).toArray()

  // Legacy category ids become the v2 immutable keys, so a content record keeps
  // pointing at the same category after the import.
  const categoryKeyByLegacy = new Map<string, string>()
  const usedCategoryKeys = new Set<string>()
  for (const record of legacyCategories) {
    const legacyId = String(record._id)
    const slug = legacyLocalized(record.slug, 120)
    const base = normalizeSlug(slug.vi || slug.en || `category-${legacyId}`) || `category-${legacyId}`
    let key = base
    if (usedCategoryKeys.has(key)) key = `${base}-${legacyId.slice(-6)}`
    usedCategoryKeys.add(key)
    categoryKeyByLegacy.set(legacyId, key)
  }

  // A category's `(locale, slug)` is unique per site (the `category_indexes`
  // index enforces it), and two legacy categories can share a slug: keeping both
  // made `--apply` die halfway through with E11000 after some rows were already
  // written. A duplicate — one inside the legacy data, or a slug an editor already
  // owns — is suffixed with the legacy id tail instead, exactly like a content slug.
  const usedCategorySlugs = new Map<string, string>()
  for (const row of await connection.collection('categories').find({ siteId }, { projection: { key: 1, 'locales.locale': 1, 'locales.slug': 1 } }).toArray()) {
    for (const entry of (row.locales as { locale: string, slug: string }[] | undefined) ?? []) {
      usedCategorySlugs.set(`${entry.locale.toLowerCase()}:${entry.slug}`, row.key as string)
    }
  }

  const categoryConflicts: string[] = []

  const plannedCategories = legacyCategories.map((record) => {
    const legacyId = String(record._id)
    const slug = legacyLocalized(record.slug, 120)
    const title = legacyLocalized(record.title, 120)
    const key = categoryKeyByLegacy.get(legacyId)!
    const locales = ['vi', 'en']
      .map(locale => ({ locale, name: title[locale] || '', slug: normalizeSlug(slug[locale] || title[locale]) }))
      .filter(entry => entry.name && entry.slug)

    for (const entry of locales) {
      const slugKey = `${entry.locale}:${entry.slug}`
      const owner = usedCategorySlugs.get(slugKey)
      if (owner !== undefined && owner !== key) {
        const original = entry.slug
        entry.slug = `${original}-${legacyId.slice(-6)}`
        categoryConflicts.push(`${key}: ${slugKey} was taken by ${owner}, stored as ${entry.slug}`)
      }
      usedCategorySlugs.set(`${entry.locale}:${entry.slug}`, key)
    }

    const parentLegacyId = record.pid ? String(record.pid) : null
    return {
      legacyId,
      key,
      parent: parentLegacyId ? categoryKeyByLegacy.get(parentLegacyId) ?? null : null,
      order: Math.max(0, Math.min(9999, legacyNumber(record.sort))),
      locales: locales.map(entry => ({ ...entry, name: entry.name.slice(0, 120) })),
    }
  })

  // Keys and per-locale slugs must be unique per site; a legacy duplicate (or a
  // slug an editor already owns in this database) is suffixed, never merged.
  // Planning reads the target collection raw so a dry run touches nothing: the
  // models below are only prepared, and migrations only applied, with --apply.
  const existingKeys = new Set<string>()
  const takenSlugs = new Map<string, string>()
  for (const row of await connection.collection('content').find({ siteId }, { projection: { key: 1, 'locales.locale': 1, 'locales.slug': 1 } }).toArray()) {
    existingKeys.add(row.key as string)
    for (const entry of (row.locales as { locale: string, slug: string }[] | undefined) ?? []) {
      takenSlugs.set(`${entry.locale.toLowerCase()}:${entry.slug}`, row.key as string)
    }
  }

  const usedContentKeys = new Set<string>()
  const usedContentSlugs = new Set<string>()
  const conflicts: string[] = []
  const droppedGallery: string[] = []
  const droppedMedia: string[] = []

  const plannedContents = legacyContents.map((record) => {
    const legacyId = String(record._id)
    const slug = legacyLocalized(record.slug, 120)
    const title = legacyLocalized(record.title, 200)
    const body = legacyLocalized(record.content)
    const excerpt = legacyLocalized(record.excerpt, 500)
    const seo = asLegacyRecord(record.seo)
    const seoTitle = legacyLocalized(seo.title, 200)
    const seoDescription = legacyLocalized(seo.description, 500)
    const seoImage = legacyText(seo.image).slice(0, 500)
    const seoKeywords = asLegacyRecord(seo.keywords)
    const type = legacyText(record.type) === 'page' ? 'page' : 'post'
    const prefix = type === 'page' ? 'pages' : 'posts'

    const locales = ['vi', 'en']
      .map((locale) => {
        const normalized = normalizeSlug(slug[locale] || title[locale])
        return {
          locale,
          slug: normalized,
          title: (title[locale] || '').slice(0, 200),
          excerpt: excerpt[locale] || '',
          body: body[locale] || '',
          format: 'html' as const,
          keywords: legacyKeywords(seoKeywords[locale]),
          seo: {
            title: seoTitle[locale] || '',
            description: seoDescription[locale] || '',
            image: seoImage,
          },
        }
      })
      .filter(entry => entry.title && entry.slug)

    let key = `${prefix}/${locales[0]?.slug || legacyId}`
    if (usedContentKeys.has(key)) key = `${prefix}/${legacyId}`
    usedContentKeys.add(key)

    for (const entry of locales) {
      const slugKey = `${entry.locale}:${entry.slug}`
      const owner = takenSlugs.get(slugKey)
      if (owner && owner !== key) {
        const original = entry.slug
        entry.slug = `${original}-${legacyId.slice(-6)}`
        conflicts.push(`${key}: ${slugKey} was taken by ${owner}, stored as ${entry.slug}`)
      }
      if (usedContentSlugs.has(`${entry.locale}:${entry.slug}`)) {
        entry.slug = `${entry.slug}-${legacyId.slice(-6)}`
        conflicts.push(`${key}: duplicate ${entry.locale} slug inside the legacy data, stored as ${entry.slug}`)
      }
      usedContentSlugs.add(`${entry.locale}:${entry.slug}`)
    }

    if (legacyList(record.gallery).length) droppedGallery.push(key)
    if (legacyList(record.media).length) droppedMedia.push(key)

    const status = legacyContentStatus(record)

    return {
      legacyId,
      key,
      type,
      status,
      locales,
      categories: legacyList(record.categories)
        .map(entry => categoryKeyByLegacy.get(String(entry)))
        .filter((entry): entry is string => Boolean(entry)),
      tags: legacyTags(record.tags),
      media: [] as string[],
      attributes: legacyContentAttributes(record),
      publishAt: null,
      unpublishAt: null,
      publishedAt: legacyDate(record.publishedAt),
      deletedAt: status === 'deleted' ? legacyDate(record.deletedAt) ?? legacyDate(record.updatedAt) : null,
      createdAt: legacyDate(record.createdAt),
      updatedAt: legacyDate(record.updatedAt),
      legacyFormat: legacyText(record.format),
    }
  })

  const invalid: string[] = []
  for (const planned of plannedContents) {
    if (!planned.locales.length) {
      invalid.push(`${planned.key}: no locale has both a title and a slug`)
      continue
    }
    try {
      normalizeContentInput({
        siteId,
        type: planned.type,
        key: planned.key,
        locales: planned.locales,
        categories: planned.categories,
        tags: planned.tags,
        media: planned.media,
        attributes: planned.attributes,
        publishAt: planned.publishAt,
        unpublishAt: planned.unpublishAt,
      })
    } catch (error) {
      invalid.push(`${planned.key}: ${(error as Error).message}`)
    }
  }

  const byType: Record<string, number> = {}
  const byFormat: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  let localeCount = 0
  let tagged = 0
  let categorized = 0
  for (const planned of plannedContents) {
    byType[planned.type] = (byType[planned.type] ?? 0) + 1
    byFormat[planned.legacyFormat || 'none'] = (byFormat[planned.legacyFormat || 'none'] ?? 0) + 1
    byStatus[planned.status] = (byStatus[planned.status] ?? 0) + 1
    localeCount += planned.locales.length
    if (planned.tags.length) tagged++
    if (planned.categories.length) categorized++
  }
  const unresolvedCategories = new Set<string>()
  for (const record of legacyContents) {
    for (const entry of legacyList(record.categories)) {
      if (!categoryKeyByLegacy.has(String(entry))) unresolvedCategories.add(String(entry))
    }
  }

  // What actually came through, field by field. The totals cannot show a dropped
  // field: every legacy tag was missing and the report still looked healthy.
  const coverage = {
    thumbnail: plannedContents.filter(content => content.attributes['legacy.thumbnail']).length,
    template: plannedContents.filter(content => content.attributes['legacy.template']).length,
    keywords: plannedContents.filter(content => content.locales.some(entry => entry.keywords.length)).length,
    body: plannedContents.filter(content => content.locales.some(entry => entry.body)).length,
    excerpt: plannedContents.filter(content => content.locales.some(entry => entry.excerpt)).length,
    seoImage: plannedContents.filter(content => content.locales.some(entry => entry.seo.image)).length,
    bothLocales: plannedContents.filter(content => content.locales.length > 1).length,
  }

  console.log(`content migration site=${siteId} db=${database} tenant=${tenant} apply=${apply}`)
  console.log(`  categories ${plannedCategories.length}, contents ${plannedContents.length}, locales ${localeCount}`)
  console.log(`  field coverage ${JSON.stringify(coverage)}`)
  console.log(`  types ${JSON.stringify(byType)}`)
  console.log(`  legacy formats ${JSON.stringify(byFormat)} -> body format html`)
  console.log(`  statuses ${JSON.stringify(byStatus)}`)
  console.log(`  with tags ${tagged}, with categories ${categorized}`)
  if (unresolvedCategories.size) console.log(`  unresolved category ids ${unresolvedCategories.size}`)
  if (droppedGallery.length) console.log(`  legacy gallery lists not carried (${droppedGallery.length}): ${droppedGallery.slice(0, 5).join(', ')}${droppedGallery.length > 5 ? ', …' : ''}`)
  if (droppedMedia.length) console.log(`  legacy media embeds not carried (${droppedMedia.length}): ${droppedMedia.slice(0, 5).join(', ')}${droppedMedia.length > 5 ? ', …' : ''}`)
  if (categoryConflicts.length) {
    console.log(`  category slug conflicts resolved ${categoryConflicts.length}`)
    for (const conflict of categoryConflicts.slice(0, 10)) console.log(`    ${conflict}`)
  }
  if (conflicts.length) {
    console.log(`  slug conflicts resolved ${conflicts.length}`)
    for (const conflict of conflicts.slice(0, 10)) console.log(`    ${conflict}`)
  }
  if (invalid.length) {
    console.log(`  invalid records ${invalid.length}`)
    for (const entry of invalid.slice(0, 10)) console.log(`    ${entry}`)
  }

  if (!apply) {
    console.log('  nothing was written; rerun with --apply')
  } else {
    const { Content, Category } = await prepareDatabase(connection)
    const writtenCategories = new Map<string, number>()
    for (const planned of plannedCategories) {
      await Category.findOneAndUpdate(
        { siteId, key: planned.key },
        {
          $set: {
            parent: planned.parent,
            order: planned.order,
            locales: planned.locales,
          },
          $setOnInsert: { siteId, key: planned.key, revision: 1, schemaVersion: CONTENT_SCHEMA_VERSION },
        },
        { upsert: true },
      )
      writtenCategories.set(planned.key, planned.locales.length)
    }

    let written = 0
    for (const planned of plannedContents) {
      if (!planned.locales.length) continue
      const set: Record<string, unknown> = {
        type: planned.type,
        status: planned.status,
        locales: planned.locales,
        categories: planned.categories,
        tags: planned.tags,
        media: planned.media,
        attributes: planned.attributes,
        publishAt: planned.publishAt,
        unpublishAt: planned.unpublishAt,
        publishedAt: planned.publishedAt,
        deletedAt: planned.deletedAt,
      }
      if (planned.updatedAt) set.updatedAt = planned.updatedAt

      await Content.findOneAndUpdate(
        { siteId, key: planned.key },
        {
          $set: set,
          $setOnInsert: {
            siteId,
            key: planned.key,
            revision: 1,
            schemaVersion: CONTENT_SCHEMA_VERSION,
            createdAt: planned.createdAt ?? new Date(),
            ...(planned.updatedAt ? {} : { updatedAt: new Date() }),
          },
        },
        { upsert: true },
      )
      written++
    }

    console.log(`  wrote ${writtenCategories.size} categories and ${written} contents`)
    console.log('  legacy collections were not modified; no audit entries or revision snapshots were written')
  }
} finally {
  await closeDatabaseConnections()
}
