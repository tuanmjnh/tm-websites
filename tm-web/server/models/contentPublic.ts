import mongoose, { type Model } from 'mongoose'
import type {
  PublicContent,
  PublicContentBodyFormat,
  PublicContentEntry,
  PublicContentListItem,
  PublicContentType,
} from '@tm/flow-contracts/content-public'
import { DEFAULT_PUBLIC_CONTENT_LOCALE } from '@tm/flow-contracts/content-public'

/**
 * Read-only view of the CMS-owned `content` collection.
 *
 * The storefront never writes content and never imports CMS services (ADR 0001,
 * `docs/v2/02-architecture.md`): it applies its own public read policy — status,
 * publish window, locale, allowlisted projection — over the shared customer
 * database. The schema stays `strict: false` because the CMS owns the shape and
 * may add fields this build does not know yet.
 */

export type PublicContentDoc = Record<string, unknown>

const loose = { type: mongoose.Schema.Types.Mixed }

const contentSchema = new mongoose.Schema<PublicContentDoc>(
  {
    key: String,
    type: String,
    status: String,
    locales: loose,
    categories: loose,
    tags: loose,
    publishAt: loose,
    unpublishAt: loose,
    publishedAt: loose,
    deletedAt: loose,
    updatedAt: loose,
  },
  { strict: false, versionKey: false, timestamps: false, collection: 'content' },
)

export const PublicContentModel: Model<PublicContentDoc> =
  mongoose.models.PublicContent ?? mongoose.model<PublicContentDoc>('PublicContent', contentSchema)

/**
 * Only public fields are selected. Status, revision, schedule and actor fields
 * stay in the database, so a projection mistake cannot leak them to a visitor.
 */
export const PUBLIC_CONTENT_PROJECTION = [
  'key',
  'type',
  'status',
  'locales',
  'categories',
  'tags',
  'publishAt',
  'unpublishAt',
  'publishedAt',
  'deletedAt',
  'updatedAt',
].join(' ')

/** Sitemap fields plus the ones the visibility guard re-checks in memory. */
const PUBLIC_CONTENT_SITEMAP_PROJECTION =
  'key locales status publishAt unpublishAt deletedAt updatedAt'

function readDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function readStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

interface LocaleEntry {
  locale: string
  slug: string
  title: string
  excerpt: string
  body: string
  format: PublicContentBodyFormat
  keywords: string[]
  seo: { title: string; description: string; image: string }
}

function readBodyFormat(value: unknown): PublicContentBodyFormat {
  return value === 'html' || value === 'text' ? value : 'markdown'
}

function readLocales(value: unknown): LocaleEntry[] {
  if (!Array.isArray(value)) return []

  const entries: LocaleEntry[] = []
  for (const raw of value) {
    const entry = readRecord(raw)
    if (typeof entry.locale !== 'string' || typeof entry.title !== 'string') continue
    const seo = readRecord(entry.seo)
    entries.push({
      locale: entry.locale,
      slug: typeof entry.slug === 'string' ? entry.slug : '',
      title: entry.title,
      excerpt: typeof entry.excerpt === 'string' ? entry.excerpt : '',
      body: typeof entry.body === 'string' ? entry.body : '',
      format: readBodyFormat(entry.format),
      keywords: readStrings(entry.keywords),
      seo: {
        title: typeof seo.title === 'string' ? seo.title : '',
        description: typeof seo.description === 'string' ? seo.description : '',
        image: typeof seo.image === 'string' ? seo.image : '',
      },
    })
  }
  return entries
}

/**
 * A record is public only while it is published inside its schedule window.
 * The query already filters on this; the check is repeated in memory so a
 * cached or clock-skewed result still cannot expose an unpublished page.
 */
export function isPublishedNow(doc: PublicContentDoc, now: Date = new Date()): boolean {
  if (doc.status !== 'published') return false
  if (readDate(doc.deletedAt)) return false

  const publishAt = readDate(doc.publishAt)
  if (publishAt && publishAt.getTime() > now.getTime()) return false

  const unpublishAt = readDate(doc.unpublishAt)
  if (unpublishAt && unpublishAt.getTime() <= now.getTime()) return false

  return true
}

/**
 * Mongo filter matching exactly the records `toPublicContent` would return:
 * published, inside the window, in the requested locale, optionally resolved by
 * key or by that locale's slug.
 */
export function buildPublishedContentFilter(options: {
  locale?: string
  keyOrSlug?: string
  now?: Date
}): Record<string, unknown> {
  const now = options.now ?? new Date()
  const conditions: Record<string, unknown>[] = []

  if (options.locale) {
    conditions.push({ 'locales.locale': options.locale })
  }

  if (options.keyOrSlug) {
    conditions.push({
      $or: [{ key: options.keyOrSlug }, { 'locales.slug': options.keyOrSlug }],
    })
  }

  return {
    status: 'published',
    deletedAt: null,
    $and: [
      ...conditions,
      { $or: [{ publishAt: null }, { publishAt: { $lte: now } }] },
      { $or: [{ unpublishAt: null }, { unpublishAt: { $gt: now } }] },
    ],
  }
}

/**
 * Listing projection: no body. The public listing page renders a grid of links,
 * so shipping every article body would be both slow and unnecessary.
 */
export const PUBLIC_CONTENT_LIST_PROJECTION = [
  'key',
  'type',
  'status',
  'locales',
  'categories',
  'tags',
  'publishAt',
  'unpublishAt',
  'publishedAt',
  'deletedAt',
  'createdAt',
  'updatedAt',
].join(' ')

/**
 * Escapes a visitor-supplied search term so it is matched literally. Without
 * this a query like `.*` would scan every record instead of searching for that
 * text, which is both a correctness and a cost problem.
 */
export function escapePublicSearchTerm(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface PublicContentListFilterOptions {
  locale?: string
  /** Requested locale plus its fallback, resolved in one query. */
  localeIn?: string[]
  type?: string
  tag?: string
  category?: string
  /** Bounded, literal search over the localized title/slug/excerpt/keywords and the key. */
  q?: string
  /** `_id` of the last row of the previous page (insertion order). */
  cursor?: string
  sort?: 'newest' | 'oldest'
  now?: Date
}

/**
 * Public listing filter: the same publish policy as one record, plus an optional
 * type/tag/category facet and a stable `_id` cursor. Sorting by `_id` keeps the
 * cursor exact (no ties on `publishedAt` across records published in one batch).
 */
export function buildPublishedListFilter(options: PublicContentListFilterOptions): Record<string, unknown> {
  const now = options.now ?? new Date()
  const conditions: Record<string, unknown>[] = []

  if (options.locale) {
    conditions.push({ 'locales.locale': options.locale })
  }
  if (options.localeIn?.length) {
    conditions.push({ 'locales.locale': { $in: options.localeIn } })
  }
  if (options.type) {
    conditions.push({ type: options.type })
  }
  if (options.tag) {
    conditions.push({ tags: options.tag })
  }
  if (options.category) {
    conditions.push({ categories: options.category })
  }

  const term = options.q?.trim()
  if (term) {
    const pattern = new RegExp(escapePublicSearchTerm(term), 'i')
    // Keywords belong to a locale entry, so they are matched inside the same
    // locale subdocument: a keyword written only for `en` must not surface a
    // listing the visitor reads in `vi`.
    const locales = options.localeIn?.length
      ? options.localeIn
      : options.locale ? [options.locale] : []
    conditions.push({
      $or: [
        { 'locales.title': pattern },
        { 'locales.slug': pattern },
        { 'locales.excerpt': pattern },
        locales.length
          ? { locales: { $elemMatch: { locale: { $in: locales }, keywords: pattern } } }
          : { 'locales.keywords': pattern },
        { key: pattern },
      ],
    })
  }

  const newestFirst = options.sort !== 'oldest'
  if (options.cursor) {
    conditions.push({ _id: newestFirst ? { $lt: options.cursor } : { $gt: options.cursor } })
  }

  return {
    status: 'published',
    deletedAt: null,
    $and: [
      ...conditions,
      { $or: [{ publishAt: null }, { publishAt: { $lte: now } }] },
      { $or: [{ unpublishAt: null }, { unpublishAt: { $gt: now } }] },
    ],
  }
}

/**
 * The short `/<slug>` URL a visitor and the canonical tag both use. The
 * immutable key path (`/pages/<key>`) keeps resolving, but it is not the URL a
 * card, a sitemap row or a canonical tag should publish.
 */
export function publicContentSlugPath(slug: string): string | null {
  const value = slug.trim()
  return value ? `/${encodeURIComponent(value)}` : null
}

/** One listing row in the requested locale, or null when it is not public. */
export function toPublicContentListItem(
  doc: PublicContentDoc,
  locale: string,
  now: Date = new Date(),
): PublicContentListItem | null {
  if (!isPublishedNow(doc, now)) return null

  const wanted = locale.toLowerCase()
  const entry = readLocales(doc.locales).find(item => item.locale.toLowerCase() === wanted)
  if (!entry || !entry.slug) return null

  const type = doc.type
  if (type !== 'page' && type !== 'post' && type !== 'fragment') return null

  const key = typeof doc.key === 'string' ? doc.key : ''
  const path = publicContentSlugPath(entry.slug)
  if (!key || !path) return null

  const publishedAt = readDate(doc.publishedAt)
  const updatedAt = readDate(doc.updatedAt)

  return {
    key,
    type: type as PublicContentType,
    locale: entry.locale,
    slug: entry.slug,
    path,
    title: entry.title,
    excerpt: entry.excerpt,
    format: entry.format,
    categories: readStrings(doc.categories),
    tags: readStrings(doc.tags),
    image: entry.seo.image,
    publishedAt: publishedAt ? publishedAt.toISOString() : null,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  }
}

/** Safe public projection of one record in one locale, or null when not public. */
export function toPublicContent(
  doc: PublicContentDoc,
  locale: string,
  now: Date = new Date(),
): PublicContent | null {
  if (!isPublishedNow(doc, now)) return null

  const wanted = locale.toLowerCase()
  const entry = readLocales(doc.locales).find(item => item.locale.toLowerCase() === wanted)
  if (!entry || !entry.slug) return null

  const type = doc.type
  if (type !== 'page' && type !== 'post' && type !== 'fragment') return null

  const key = typeof doc.key === 'string' ? doc.key : ''
  if (!key) return null

  const publishedAt = readDate(doc.publishedAt)
  const updatedAt = readDate(doc.updatedAt)

  return {
    key,
    type: type as PublicContentType,
    locale: entry.locale,
    slug: entry.slug,
    title: entry.title,
    excerpt: entry.excerpt,
    body: entry.body,
    format: entry.format,
    seo: entry.seo,
    keywords: entry.keywords,
    categories: readStrings(doc.categories),
    tags: readStrings(doc.tags),
    publishedAt: publishedAt ? publishedAt.toISOString() : null,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  }
}

/**
 * Sitemap projection: published keys only. Storefront URLs are locale-free, so
 * a translated record is listed once, not once per locale.
 */
export function toPublicContentEntry(doc: PublicContentDoc, now: Date = new Date()): PublicContentEntry | null {
  if (!isPublishedNow(doc, now)) return null

  if (!readLocales(doc.locales).some(item => item.slug)) return null

  const key = typeof doc.key === 'string' ? doc.key : ''
  if (!key) return null

  const updatedAt = readDate(doc.updatedAt)
  return { key, updatedAt: updatedAt ? updatedAt.toISOString() : null }
}

/**
 * Sitemap row for one record: the short slug URL, so the sitemap and the
 * canonical tag agree. The sitemap is locale-free, so the default-locale slug
 * wins and another locale is only a fallback.
 */
export function toPublicContentSitemapEntry(
  doc: PublicContentDoc,
  now: Date = new Date(),
): { path: string, lastmod: string | null } | null {
  if (!isPublishedNow(doc, now)) return null

  const slugged = readLocales(doc.locales).filter(item => item.slug.trim().length > 0)
  if (!slugged.length) return null

  const preferred = slugged.find(item => item.locale.toLowerCase() === DEFAULT_PUBLIC_CONTENT_LOCALE) ?? slugged[0]!
  const path = publicContentSlugPath(preferred.slug)
  if (!path) return null

  const updatedAt = readDate(doc.updatedAt)
  return { path, lastmod: updatedAt ? updatedAt.toISOString() : null }
}

export const PUBLIC_CONTENT_SITEMAP_FIELDS = PUBLIC_CONTENT_SITEMAP_PROJECTION
