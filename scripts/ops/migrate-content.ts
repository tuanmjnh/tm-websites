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

type Raw = Record<string, unknown>
type Localized = Record<string, string>

function asRecord(value: unknown): Raw {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function localized(value: unknown, max = 5000): Localized {
  const source = asRecord(value)
  const result: Localized = {}
  for (const [locale, entry] of Object.entries(source)) {
    const candidate = text(entry)
    if (candidate) result[locale.slice(0, 10)] = candidate.slice(0, max)
  }
  return result
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function date(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = value instanceof Date ? value : new Date(value as string | number)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Legacy keywords are free text per locale; the v2 field is a bounded list. */
function keywords(value: unknown): string[] {
  const seen = new Set<string>()
  for (const entry of list(value)) {
    const keyword = text(entry)
    if (keyword) seen.add(keyword.slice(0, KEYWORD_MAX_LENGTH))
    if (seen.size >= KEYWORDS_MAX_COUNT) break
  }
  return [...seen]
}

/** Legacy tags are `{ title, slug }` documents; v2 keeps the display name. */
function tagNames(value: unknown): string[] {
  const seen = new Set<string>()
  for (const entry of list(value)) {
    const tag = text(entry) || text(asRecord(entry).title) || text(asRecord(entry).name)
    if (tag) seen.add(tag.slice(0, 60))
    if (seen.size >= 50) break
  }
  return [...seen]
}

/**
 * The extras that have no v2 column. They are prefixed so an editor can tell
 * migration bookkeeping from authored metadata, and so CNT-02 can filter them.
 */
function legacyAttributes(record: Raw): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {}
  const format = text(record.format)
  if (format && format !== 'standard') attributes['legacy.format'] = format.slice(0, ATTRIBUTE_VALUE_MAX_LENGTH)
  const template = text(record.template)
  if (template) attributes['legacy.template'] = template.slice(0, ATTRIBUTE_VALUE_MAX_LENGTH)
  const thumbnail = text(record.thumbnail)
  if (thumbnail) attributes['legacy.thumbnail'] = thumbnail.slice(0, ATTRIBUTE_VALUE_MAX_LENGTH)
  const parent = text(record.parent)
  if (parent) attributes['legacy.parent'] = parent.slice(0, ATTRIBUTE_VALUE_MAX_LENGTH)
  const sort = number(record.sort)
  if (sort) attributes['legacy.sort'] = sort
  const display = asRecord(record.display)
  if (display.showOnHome === true) attributes['legacy.showOnHome'] = true
  const priority = number(display.priority)
  if (priority) attributes['legacy.priority'] = priority
  const views = number(record.views)
  if (views) attributes['legacy.views'] = views
  return attributes
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
    const slug = localized(record.slug, 120)
    const base = normalizeSlug(slug.vi || slug.en || `category-${legacyId}`) || `category-${legacyId}`
    let key = base
    if (usedCategoryKeys.has(key)) key = `${base}-${legacyId.slice(-6)}`
    usedCategoryKeys.add(key)
    categoryKeyByLegacy.set(legacyId, key)
  }

  const plannedCategories = legacyCategories.map((record) => {
    const legacyId = String(record._id)
    const slug = localized(record.slug, 120)
    const title = localized(record.title, 120)
    const locales = ['vi', 'en']
      .map(locale => ({ locale, name: title[locale] || '', slug: normalizeSlug(slug[locale] || title[locale]) }))
      .filter(entry => entry.name && entry.slug)
    const parentLegacyId = record.pid ? String(record.pid) : null
    return {
      legacyId,
      key: categoryKeyByLegacy.get(legacyId)!,
      parent: parentLegacyId ? categoryKeyByLegacy.get(parentLegacyId) ?? null : null,
      order: Math.max(0, Math.min(9999, number(record.sort))),
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
    const slug = localized(record.slug, 120)
    const title = localized(record.title, 200)
    const body = localized(record.content)
    const excerpt = localized(record.excerpt, 500)
    const seo = asRecord(record.seo)
    const seoTitle = localized(seo.title, 200)
    const seoDescription = localized(seo.description, 500)
    const seoImage = text(seo.image).slice(0, 500)
    const seoKeywords = asRecord(seo.keywords)
    const type = text(record.type) === 'page' ? 'page' : 'post'
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
          keywords: keywords(seoKeywords[locale]),
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

    if (list(record.gallery).length) droppedGallery.push(key)
    if (list(record.media).length) droppedMedia.push(key)

    const status = record.isDeleted === true
      ? 'deleted'
      : (['published', 'draft', 'archived'].includes(text(record.status)) ? text(record.status) : 'draft')

    return {
      legacyId,
      key,
      type,
      status,
      locales,
      categories: list(record.categories)
        .map(entry => categoryKeyByLegacy.get(String(entry)))
        .filter((entry): entry is string => Boolean(entry)),
      tags: tagNames(record.tags),
      media: [] as string[],
      attributes: legacyAttributes(record),
      publishAt: null,
      unpublishAt: null,
      publishedAt: date(record.publishedAt),
      deletedAt: status === 'deleted' ? date(record.deletedAt) ?? date(record.updatedAt) : null,
      createdAt: date(record.createdAt),
      updatedAt: date(record.updatedAt),
      legacyFormat: text(record.format),
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
    for (const entry of list(record.categories)) {
      if (!categoryKeyByLegacy.has(String(entry))) unresolvedCategories.add(String(entry))
    }
  }

  console.log(`content migration site=${siteId} db=${database} tenant=${tenant} apply=${apply}`)
  console.log(`  categories ${plannedCategories.length}, contents ${plannedContents.length}, locales ${localeCount}`)
  console.log(`  types ${JSON.stringify(byType)}`)
  console.log(`  legacy formats ${JSON.stringify(byFormat)} -> body format html`)
  console.log(`  statuses ${JSON.stringify(byStatus)}`)
  console.log(`  with tags ${tagged}, with categories ${categorized}`)
  if (unresolvedCategories.size) console.log(`  unresolved category ids ${unresolvedCategories.size}`)
  if (droppedGallery.length) console.log(`  legacy gallery lists not carried (${droppedGallery.length}): ${droppedGallery.slice(0, 5).join(', ')}${droppedGallery.length > 5 ? ', …' : ''}`)
  if (droppedMedia.length) console.log(`  legacy media embeds not carried (${droppedMedia.length}): ${droppedMedia.slice(0, 5).join(', ')}${droppedMedia.length > 5 ? ', …' : ''}`)
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
