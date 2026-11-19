import type { Connection } from 'mongoose'
import {
  ATTRIBUTE_VALUE_MAX_LENGTH,
  KEYWORD_MAX_LENGTH,
  KEYWORDS_MAX_COUNT,
} from '../models/content.js'

/**
 * The field rules both legacy importers (`migrate:content`, `migrate:catalog`)
 * share, kept in one place so the two cannot drift.
 *
 * Why this module exists: the catalog importer mapped tags with `text()`, which
 * keeps only strings, while the legacy tags are `{ title, slug }` documents — so
 * every tag was silently dropped (230 of `sen-tuan`'s 241 items) and nothing
 * noticed, because a mapper with no test only fails by writing less data. The
 * rules are pure and covered by `pnpm test:legacy-import`; the importers must
 * import them rather than declaring their own copy, which the same gate checks.
 *
 * These are migration-only readers: the legacy shapes are not a write schema and
 * must never become one.
 */

export type LegacyRaw = Record<string, unknown>

/**
 * Which legacy tenants a database holds, counted across the collections the
 * importers read. An import filters on `--tenant`, so a database whose records
 * sit under another tenant — or under none at all — plans nothing while looking
 * perfectly healthy. `(none)` marks a record with no `tenantId` field.
 */
export async function legacyTenantBuckets(connection: Connection, collections: string[]): Promise<Record<string, number>> {
  const buckets: Record<string, number> = {}
  for (const name of collections) {
    const exists = await connection.db!.listCollections({ name }, { nameOnly: true }).toArray()
    if (!exists.length) continue
    const rows = await connection.collection(name)
      .aggregate([{ $group: { _id: '$tenantId', n: { $sum: 1 } } }])
      .toArray()
    for (const row of rows) {
      const key = row._id === null || row._id === undefined ? '(none)' : String(row._id)
      buckets[key] = (buckets[key] ?? 0) + Number(row.n)
    }
  }
  return buckets
}

/**
 * Where the legacy collections the importers read actually are: absent, present but
 * empty, or holding records. Those first two look identical to a count, and only one
 * of them means "check `TM_MONGO_DB`": `bag-post` has `items` and `item_categories`
 * that hold no documents because the customer never sold anything, and the report
 * used to tell an operator to point the import at another database.
 */
export async function legacyCollectionState(
  connection: Connection,
  collections: string[],
): Promise<{ missing: string[], empty: string[], present: string[] }> {
  const state: { missing: string[], empty: string[], present: string[] } = { missing: [], empty: [], present: [] }
  for (const name of collections) {
    const exists = await connection.db!.listCollections({ name }, { nameOnly: true }).toArray()
    if (!exists.length) {
      state.missing.push(name)
      continue
    }
    const count = await connection.collection(name).estimatedDocumentCount()
    if (count === 0) state.empty.push(name)
    else state.present.push(name)
  }
  return state
}

/**
 * The line a report prints when it found nothing to import, phrased for the actual
 * cause instead of always blaming the database name.
 */
export function legacyEmptyDatabaseWarning(
  state: { missing: string[], empty: string[], present: string[] },
  database: string,
  names: string,
): string {
  if (state.missing.length) {
    return `found no legacy ${names} collections in ${database}; the legacy data lives in the customer-named database (e.g. TM_MONGO_DB=sen-tuan), not in the app_*_cms one`
  }
  return `the legacy ${names} collections exist in ${database} but hold no documents; this copy has nothing to import`
}

/** Legacy documents are read raw (`strict: false`); anything else is empty. */
export function asLegacyRecord(value: unknown): LegacyRaw {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as LegacyRaw) : {}
}

export function legacyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Legacy locale maps are `{ vi: '...', en: '...' }`; blank entries are dropped. */
export function legacyLocalized(value: unknown, max = 5000): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [locale, entry] of Object.entries(asLegacyRecord(value))) {
    const candidate = legacyText(entry)
    if (candidate) result[locale.slice(0, 10)] = candidate.slice(0, max)
  }
  return result
}

/** Legacy slugs are free text; v2 compares them lower-cased. */
export function legacySlugMap(value: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [locale, entry] of Object.entries(asLegacyRecord(value))) {
    const slug = legacyText(entry).toLowerCase()
    if (slug) result[locale.slice(0, 10)] = slug
  }
  return result
}

export function legacyList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function legacyNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function legacyDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = value instanceof Date ? value : new Date(value as string | number)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Legacy tags are `{ title, slug }` documents, but some collections store plain
 * strings and a few use `name`. All three keep the display name, deduped and
 * bounded by the v2 tag field; mapping them through a string-only reader drops
 * the entire field without an error.
 */
export function legacyTags(value: unknown): string[] {
  const seen = new Set<string>()
  for (const entry of legacyList(value)) {
    const tag = legacyText(entry) || legacyText(asLegacyRecord(entry).title) || legacyText(asLegacyRecord(entry).name)
    if (tag) seen.add(tag.slice(0, 60))
    if (seen.size >= 50) break
  }
  return [...seen]
}

/** Legacy keywords are free text per locale; the v2 field is a bounded list. */
export function legacyKeywords(value: unknown): string[] {
  const seen = new Set<string>()
  for (const entry of legacyList(value)) {
    const keyword = legacyText(entry)
    if (keyword) seen.add(keyword.slice(0, KEYWORD_MAX_LENGTH))
    if (seen.size >= KEYWORDS_MAX_COUNT) break
  }
  return [...seen]
}

/**
 * A legacy image is either a URL string or a storage document (`url`,
 * `secure_url`, `src`). Reading only the string form is how the 7 `{ url }`
 * thumbnails in `bag-post` would have disappeared from `legacy.thumbnail`.
 */
export function legacyImageUrl(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as LegacyRaw
  return legacyText(record.url) || legacyText(record.secure_url) || legacyText(record.src) || null
}

export function legacyImageList(value: unknown): string[] {
  return legacyList(value).map(legacyImageUrl).filter((entry): entry is string => Boolean(entry))
}

/** Legacy attributes are `[{ k | key | name | title, v | value | label }]`. */
export function legacyAttributeList(value: unknown): { name: Record<string, string>, value: Record<string, string> }[] {
  const list: { name: Record<string, string>, value: Record<string, string> }[] = []
  for (const entry of legacyList(value)) {
    const record = asLegacyRecord(entry)
    const name = legacyLocalized(record.k ?? record.key ?? record.name ?? record.title, 200)
    const values = legacyLocalized(record.v ?? record.value ?? record.label, 500)
    if (Object.keys(name).length && Object.keys(values).length) list.push({ name, value: values })
  }
  return list
}

/** The extras that have no v2 column, prefixed so they read as migration bookkeeping. */
export function legacyContentAttributes(record: LegacyRaw): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {}
  const format = legacyText(record.format)
  if (format && format !== 'standard') attributes['legacy.format'] = format.slice(0, ATTRIBUTE_VALUE_MAX_LENGTH)
  const template = legacyText(record.template)
  if (template) attributes['legacy.template'] = template.slice(0, ATTRIBUTE_VALUE_MAX_LENGTH)
  const thumbnail = legacyImageUrl(record.thumbnail)
  if (thumbnail) attributes['legacy.thumbnail'] = thumbnail.slice(0, ATTRIBUTE_VALUE_MAX_LENGTH)
  const parent = legacyText(record.parent)
  if (parent) attributes['legacy.parent'] = parent.slice(0, ATTRIBUTE_VALUE_MAX_LENGTH)
  const sort = legacyNumber(record.sort)
  if (sort) attributes['legacy.sort'] = sort
  const display = asLegacyRecord(record.display)
  if (display.showOnHome === true) attributes['legacy.showOnHome'] = true
  const priority = legacyNumber(display.priority)
  if (priority) attributes['legacy.priority'] = priority
  const views = legacyNumber(record.views)
  if (views) attributes['legacy.views'] = views
  return attributes
}

const CONTENT_STATUSES = ['published', 'draft', 'archived'] as const

/** A soft-deleted record wins; an unknown status is a draft, never published. */
export function legacyContentStatus(record: LegacyRaw): 'published' | 'draft' | 'archived' | 'deleted' {
  if (record.isDeleted === true) return 'deleted'
  const status = legacyText(record.status) as (typeof CONTENT_STATUSES)[number]
  return CONTENT_STATUSES.includes(status) ? status : 'draft'
}

/** Catalog records also carry `isActive`, so a published but hidden item is not live. */
export function legacyCatalogStatus(record: LegacyRaw): 'published' | 'draft' | 'archived' | 'deleted' {
  if (record.isDeleted === true) return 'deleted'
  const status = legacyText(record.status)
  if (status === 'published' && record.isActive !== false) return 'published'
  return status === 'archived' ? 'archived' : 'draft'
}
