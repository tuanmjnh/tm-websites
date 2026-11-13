import { z } from 'zod'

/**
 * Public content read model shared by the CMS projection, the Web BFF and the
 * storefront renderer. It is the allowlisted shape of one published record in
 * one locale: no status, no revision, no actor fields, no schedule internals —
 * a visitor must never be able to tell whether a page is scheduled, edited or
 * soft-deleted.
 */

export const PUBLIC_CONTENT_TYPES = ['page', 'post', 'fragment'] as const
export type PublicContentType = (typeof PUBLIC_CONTENT_TYPES)[number]

/** Locales the storefront may request; unsupported values fall back to `vi`. */
export const PUBLIC_CONTENT_LOCALES = ['vi', 'en'] as const
export type PublicContentLocale = (typeof PUBLIC_CONTENT_LOCALES)[number]

export const DEFAULT_PUBLIC_CONTENT_LOCALE: PublicContentLocale = 'vi'

/**
 * Accepts `vi`, `vi-VN`, `en-US` and returns the two-letter storefront locale.
 * Anything else returns null so callers decide their own fallback instead of
 * guessing from an arbitrary `?locale=` value.
 */
export function normalizePublicLocale(value: unknown): PublicContentLocale | null {
  if (typeof value !== 'string') return null
  const base = value.trim().toLowerCase().split(/[-_]/)[0]
  const match = PUBLIC_CONTENT_LOCALES.find(locale => locale === base)
  return match ?? null
}

/** How the body should be rendered; the reader never guesses. */
export const PUBLIC_CONTENT_BODY_FORMATS = ['markdown', 'html', 'text'] as const
export type PublicContentBodyFormat = (typeof PUBLIC_CONTENT_BODY_FORMATS)[number]

export const PublicContentSeoSchema = z.object({
  title: z.string(),
  description: z.string(),
  image: z.string(),
})

export const PublicContentSchema = z.object({
  key: z.string().min(1).max(200),
  type: z.enum(PUBLIC_CONTENT_TYPES),
  locale: z.string(),
  slug: z.string(),
  title: z.string(),
  excerpt: z.string(),
  body: z.string(),
  format: z.enum(PUBLIC_CONTENT_BODY_FORMATS),
  seo: PublicContentSeoSchema,
  keywords: z.array(z.string()),
  categories: z.array(z.string()),
  tags: z.array(z.string()),
  publishedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export type PublicContent = z.infer<typeof PublicContentSchema>

/** Sitemap input: only what a crawl needs, so no body leaves the database. */
export const PublicContentEntrySchema = z.object({
  key: z.string().min(1).max(200),
  updatedAt: z.string().nullable(),
})

export type PublicContentEntry = z.infer<typeof PublicContentEntrySchema>

/**
 * Listing projection: one row per published record, in the requested locale,
 * without the body. A listing page needs the link, the title and the teaser; it
 * must never download every article to render a grid.
 */
export const PublicContentListItemSchema = z.object({
  key: z.string().min(1).max(200),
  type: z.enum(PUBLIC_CONTENT_TYPES),
  locale: z.string(),
  slug: z.string(),
  path: z.string(),
  title: z.string(),
  excerpt: z.string(),
  format: z.enum(PUBLIC_CONTENT_BODY_FORMATS),
  categories: z.array(z.string()),
  tags: z.array(z.string()),
  image: z.string(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export type PublicContentListItem = z.infer<typeof PublicContentListItemSchema>

/**
 * Longest accepted search term. The route rejects a longer value instead of
 * truncating it, so a visitor is never shown results for a different query than
 * the one they typed.
 */
export const PUBLIC_CONTENT_SEARCH_MAX = 80

/**
 * Landing-page category, resolved by the requested locale's slug. `key` is the
 * value stored on content records, so the page can filter without a second
 * lookup and a renamed display name never breaks a URL.
 */
export const PublicContentCategorySchema = z.object({
  key: z.string().min(1).max(200),
  slug: z.string().min(1).max(200),
  name: z.string(),
  /** The editor's intro paragraph for this locale, or an empty string. */
  description: z.string(),
  parent: z.string().nullable(),
  locale: z.string(),
})

export type PublicContentCategory = z.infer<typeof PublicContentCategorySchema>

export const PublicContentCategoryListSchema = z.object({
  data: z.array(PublicContentCategorySchema),
})

export const PUBLIC_CONTENT_LIST_SORTS = ['newest', 'oldest'] as const
export type PublicContentListSort = (typeof PUBLIC_CONTENT_LIST_SORTS)[number]

export const PublicContentListSchema = z.object({
  data: z.array(PublicContentListItemSchema),
  meta: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number(),
  }),
})

export type PublicContentList = z.infer<typeof PublicContentListSchema>
