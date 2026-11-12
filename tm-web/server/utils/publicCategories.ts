import type { H3Event } from 'h3'
import type { PublicContentCategory } from '@tm/flow-contracts/content-public'
import {
  PUBLIC_CATEGORY_PROJECTION,
  PublicCategoryModel,
  buildCategorySlugFilter,
  toPublicContentCategory,
  type PublicCategoryDoc,
} from '#server/models/contentCategoryPublic'
import { PublicContentModel, buildPublishedListFilter } from '#server/models/contentPublic'
import { contentLocaleCandidates } from './publicContent'
import { withSiteDb } from './mongo'

/**
 * Public category resolution for landing pages.
 *
 * A content record stores the category `key`, so the page resolves the URL slug
 * to that key once and then asks the content listing for `category=<key>`. The
 * category row is site-scoped by the database binding, and a slug that only
 * exists in another locale falls back to the storefront default.
 */
export async function fetchPublicContentCategory(
  event: H3Event,
  options: { slug: string, locale?: string },
): Promise<PublicContentCategory | null> {
  const slug = options.slug.trim()
  if (!slug) return null

  const candidates = contentLocaleCandidates(options.locale)

  return withSiteDb(event, async () => {
    const doc = await PublicCategoryModel.findOne(
      buildCategorySlugFilter({ slug, localeIn: candidates }),
      PUBLIC_CATEGORY_PROJECTION,
    )
      .sort({ order: 1, key: 1 })
      .lean()

    if (!doc) return null

    for (const locale of candidates) {
      const category = toPublicContentCategory(doc as unknown as PublicCategoryDoc, locale)
      if (category) return category
    }
    return null
  })
}

/** Every category the storefront may link to, in the requested locale. */
export async function fetchPublicContentCategories(
  event: H3Event,
  locale?: string,
): Promise<PublicContentCategory[]> {
  const candidates = contentLocaleCandidates(locale)

  return withSiteDb(event, async () => {
    const docs = await PublicCategoryModel.find({}, PUBLIC_CATEGORY_PROJECTION)
      .sort({ order: 1, key: 1 })
      .lean()

    const categories: PublicContentCategory[] = []
    for (const doc of docs as unknown as PublicCategoryDoc[]) {
      for (const candidate of candidates) {
        const category = toPublicContentCategory(doc, candidate)
        if (category) {
          categories.push(category)
          break
        }
      }
    }
    return categories
  })
}

/**
 * Tags in use by published records, plus the categories, for the sitemap and any
 * tag index. Tags are free-form strings, so they are read from the content rows
 * instead of a registry.
 */
export async function fetchPublicContentTags(event: H3Event): Promise<string[]> {
  return withSiteDb(event, async () => {
    const tags = await PublicContentModel.distinct('tags', buildPublishedListFilter({}))
    return (tags as unknown[])
      .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
      .sort((a, b) => a.localeCompare(b))
  })
}

/** Mongo dates come back as `Date`; a sitemap row needs the W3C string or nothing. */
function sitemapLastmod(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

/**
 * Sitemap rows for the tag landings.
 *
 * A tag page changes when its newest published post does, so one aggregation
 * dates every tag at once instead of one query per tag. A fresh tag with no
 * published content is left undated rather than dropped: the page exists.
 */
export async function listContentTagSitemapEntries(
  event: H3Event,
): Promise<{ tag: string, lastmod: string | null }[]> {
  return withSiteDb(event, async () => {
    const rows = await PublicContentModel.aggregate([
      { $match: buildPublishedListFilter({}) },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', updatedAt: { $max: '$updatedAt' } } },
      { $sort: { _id: 1 } },
    ])

    return (rows as { _id: unknown, updatedAt?: unknown }[])
      .filter((row): row is { _id: string, updatedAt?: unknown } => typeof row._id === 'string' && row._id.trim().length > 0)
      .map(row => ({ tag: row._id, lastmod: sitemapLastmod(row.updatedAt) }))
  })
}
