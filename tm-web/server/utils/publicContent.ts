import type { H3Event } from 'h3'
import {
  DEFAULT_PUBLIC_CONTENT_LOCALE,
  normalizePublicLocale,
  type PublicContent,
  type PublicContentEntry,
  type PublicContentListItem,
} from '@tm/flow-contracts/content-public'
import { normalizeSiteBaseUrl } from '@tm/flow-utils/seo'
import {
  PUBLIC_CONTENT_LIST_PROJECTION,
  PUBLIC_CONTENT_PROJECTION,
  PUBLIC_CONTENT_SITEMAP_FIELDS,
  PublicContentModel,
  buildPublishedContentFilter,
  buildPublishedListFilter,
  toPublicContent,
  toPublicContentEntry,
  toPublicContentListItem,
  toPublicContentSitemapEntry,
  type PublicContentDoc,
} from '#server/models/contentPublic'
import { withSiteDb } from './mongo'

/**
 * Public content read path for the storefront.
 *
 * The CMS writes content into the customer database; the storefront reads it
 * directly with its own public policy (published + inside the schedule window +
 * requested locale + allowlisted fields). There is no call to Hub and no call to
 * the CMS admin API, so a visitor never needs a session and an unpublished
 * record is never reachable.
 */

export function getContentLocale(event: H3Event): string {
  const requested = getQuery(event).locale
  return normalizePublicLocale(Array.isArray(requested) ? requested[0] : requested)
    ?? DEFAULT_PUBLIC_CONTENT_LOCALE
}

/**
 * Absolute public origin for canonical URLs, sitemap and robots.
 * Uses TM_SITE_URL when configured, otherwise the forwarded request origin.
 */
export function getSiteBaseUrl(event: H3Event): string {
  const config = useRuntimeConfig(event)
  const configured = normalizeSiteBaseUrl(String(config.public.siteUrl || ''))
  if (configured) return configured

  const proto = (getHeader(event, 'x-forwarded-proto') || 'https').split(',')[0]?.trim() || 'https'
  const host = (getHeader(event, 'x-forwarded-host') || getHeader(event, 'host') || 'localhost')
    .split(',')[0]
    ?.trim() || 'localhost'

  return `${proto}://${host}`
}

/**
 * Requested locale first, then the storefront default. A record that was only
 * written in Vietnamese still renders for an English visitor instead of 404ing;
 * untranslated copy is a content gap, not a missing page.
 */
export function contentLocaleCandidates(locale?: string): string[] {
  const requested = normalizePublicLocale(locale) ?? DEFAULT_PUBLIC_CONTENT_LOCALE
  return requested === DEFAULT_PUBLIC_CONTENT_LOCALE
    ? [DEFAULT_PUBLIC_CONTENT_LOCALE]
    : [requested, DEFAULT_PUBLIC_CONTENT_LOCALE]
}

/** Resolves one public record by content key or by the locale's slug. */
export async function fetchPublicContent(
  event: H3Event,
  options: { path: string; locale?: string },
): Promise<PublicContent | null> {
  const path = options.path.trim()
  if (!path) return null

  return withSiteDb(event, async () => {
    for (const locale of contentLocaleCandidates(options.locale)) {
      const doc = await PublicContentModel.findOne(
        buildPublishedContentFilter({ locale, keyOrSlug: path }),
        PUBLIC_CONTENT_PROJECTION,
      )
        .sort({ updatedAt: -1, _id: -1 })
        .lean()

      if (!doc) continue
      const content = toPublicContent(doc as unknown as PublicContentDoc, locale)
      if (content) return content
    }
    return null
  })
}

/**
 * Sitemap rows: one short URL per published record, so a crawler is never sent
 * to the immutable key path that canonicalises elsewhere.
 */
export async function listContentSitemapEntries(
  event: H3Event,
): Promise<{ path: string, lastmod: string | null }[]> {
  return withSiteDb(event, async () => {
    const docs = await PublicContentModel.find(
      buildPublishedContentFilter({}),
      PUBLIC_CONTENT_SITEMAP_FIELDS,
    )
      .sort({ updatedAt: -1, _id: -1 })
      .lean()

    const rows: { path: string, lastmod: string | null }[] = []
    for (const doc of docs as unknown as PublicContentDoc[]) {
      const entry = toPublicContentSitemapEntry(doc)
      if (entry) rows.push(entry)
    }
    return rows
  })
}

export interface PublicContentListOptions {
  locale?: string
  type?: string
  tag?: string
  category?: string
  /** Bounded literal search, validated by the route before it reaches here. */
  q?: string
  cursor?: string
  sort?: 'newest' | 'oldest'
  limit?: number
}

export interface PublicContentListResult {
  data: PublicContentListItem[]
  meta: { nextCursor: string | null, hasMore: boolean, limit: number }
}

/**
 * Public listing over the same policy as one record: published, inside its
 * window, an allowlisted projection without the body. The requested locale and
 * its fallback are resolved in one query, so an English visitor still sees
 * Vietnamese-only posts instead of an empty page.
 */
export async function fetchPublicContentList(
  event: H3Event,
  options: PublicContentListOptions = {},
): Promise<PublicContentListResult> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 12), 1), 50)
  const candidates = [...new Set(contentLocaleCandidates(options.locale))]
  const sortDirection = options.sort === 'oldest' ? 1 : -1

  return withSiteDb(event, async () => {
    const docs = await PublicContentModel.find(
      buildPublishedListFilter({
        type: options.type,
        tag: options.tag,
        category: options.category,
        q: options.q,
        cursor: options.cursor,
        sort: options.sort,
        localeIn: candidates,
      }),
      PUBLIC_CONTENT_LIST_PROJECTION,
    )
      .sort({ _id: sortDirection })
      .limit(limit + 1)
      .lean()

    const hasMore = docs.length > limit
    const page = (hasMore ? docs.slice(0, limit) : docs) as unknown as PublicContentDoc[]

    const data: PublicContentListItem[] = []
    for (const doc of page) {
      for (const locale of candidates) {
        const item = toPublicContentListItem(doc, locale)
        if (item) {
          data.push(item)
          break
        }
      }
    }

    const last = page[page.length - 1]
    const lastId = last && last._id ? String(last._id) : null

    return {
      data,
      meta: { nextCursor: hasMore ? lastId : null, hasMore, limit },
    }
  })
}

/**
 * Every published record once, for the sitemap. Storefront URLs are
 * locale-free, so the locale is not a filter here.
 */
export async function fetchAllPublishedContent(event: H3Event): Promise<PublicContentEntry[]> {
  return withSiteDb(event, async () => {
    const docs = await PublicContentModel.find(
      buildPublishedContentFilter({}),
      PUBLIC_CONTENT_SITEMAP_FIELDS,
    )
      .sort({ updatedAt: -1, _id: -1 })
      .lean()

    const entries: PublicContentEntry[] = []
    for (const doc of docs as unknown as PublicContentDoc[]) {
      const entry = toPublicContentEntry(doc)
      if (entry) entries.push(entry)
    }
    return entries
  })
}
