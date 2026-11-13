import mongoose, { type Model } from 'mongoose'
import type { PublicContentCategory } from '@tm/flow-contracts/content-public'

/**
 * Read-only view of the CMS-owned `categories` collection.
 *
 * The storefront only needs the public half of a category: the immutable `key`
 * (the value stored on content records), the locale's display name and slug, and
 * the parent key for breadcrumbs. Ordering, revisions and audit fields stay in
 * the database, and the storefront never writes this collection.
 */

export type PublicCategoryDoc = Record<string, unknown>

const categorySchema = new mongoose.Schema<PublicCategoryDoc>(
  {
    key: String,
    parent: String,
    order: Number,
    locales: { type: mongoose.Schema.Types.Mixed },
    updatedAt: mongoose.Schema.Types.Mixed,
  },
  { strict: false, versionKey: false, timestamps: false, collection: 'categories' },
)

export const PublicCategoryModel: Model<PublicCategoryDoc> =
  mongoose.models.PublicContentCategory
  ?? mongoose.model<PublicCategoryDoc>('PublicContentCategory', categorySchema)

export const PUBLIC_CATEGORY_PROJECTION = 'key parent order locales'

interface CategoryLocaleEntry {
  locale: string
  name: string
  slug: string
  description: string
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readLocales(value: unknown): CategoryLocaleEntry[] {
  if (!Array.isArray(value)) return []

  const entries: CategoryLocaleEntry[] = []
  for (const raw of value) {
    const entry = readRecord(raw)
    if (typeof entry.locale !== 'string' || typeof entry.name !== 'string') continue
    entries.push({
      locale: entry.locale,
      name: entry.name,
      slug: typeof entry.slug === 'string' ? entry.slug : '',
      description: typeof entry.description === 'string' ? entry.description : '',
    })
  }
  return entries
}

/**
 * Match by the requested locale's slug, with the storefront default as fallback,
 * so a category only written in Vietnamese still resolves for an English visitor.
 */
export function buildCategorySlugFilter(options: {
  slug: string
  localeIn: string[]
}): Record<string, unknown> {
  return {
    $or: options.localeIn.map(locale => ({
      locales: { $elemMatch: { locale, slug: options.slug } },
    })),
  }
}

/** One landing-page category in the requested locale, or null when it lacks that locale. */
export function toPublicContentCategory(
  doc: PublicCategoryDoc,
  locale: string,
): PublicContentCategory | null {
  const key = typeof doc.key === 'string' ? doc.key : ''
  if (!key) return null

  const wanted = locale.toLowerCase()
  const entry = readLocales(doc.locales).find(item => item.locale.toLowerCase() === wanted && item.slug)
  if (!entry) return null

  return {
    key,
    slug: entry.slug,
    name: entry.name,
    description: entry.description,
    parent: typeof doc.parent === 'string' && doc.parent ? doc.parent : null,
    locale: entry.locale,
  }
}
