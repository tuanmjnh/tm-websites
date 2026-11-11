import type { Model } from 'mongoose'
import type { ContentLocale } from '../models/content'
import type { RedirectDocument } from '../models/redirect'

/**
 * Automatic 301s for a published record whose slug changed.
 *
 * The storefront resolves a record by its immutable key (`pages/about`, which is
 * why `/pages/about` keeps working after a rename) or by the requested locale's
 * slug, served at the short path `/<slug>`. So the URL a rename actually breaks
 * is the short one, and that is the only path written here: `/<old>` → `/<new>`.
 *
 * A short path can collide with a real storefront route, and this middleware
 * matches redirect rows before routing, so the reserved names below are skipped
 * rather than allowed to hijack a listing page.
 *
 * A path that already has a row is left alone: a mapping a human typed is a
 * better answer than a generated one, and `resolveRedirect` follows chains.
 */

/** Note stored on every generated row, so an operator can tell them apart. */
export const AUTO_SLUG_REDIRECT_NOTE = 'auto: slug changed'

/**
 * Top-level storefront routes. A page slugged `products` was never reachable at
 * `/products`, so renaming it must not create a row that redirects the listing.
 */
const RESERVED_STOREFRONT_PATHS = new Set([
  'api',
  'bai-viet',
  'categories',
  'danh-muc',
  'gio-hang',
  'products',
  'tag',
  'tim-kiem',
])

export interface SlugRedirectOutcome {
  /** Rows that now answer a 301, as `from -> to`. */
  created: Array<{ from: string, to: string }>
  /** Paths that already had a row, so nothing was written. */
  kept: string[]
  /** Old slugs that collide with a storefront route, so no row was written. */
  skipped: string[]
}

/** Normalized short path of one locale slug, or null when it cannot be a path. */
export function contentPathForSlug(slug: string): string | null {
  const trimmed = slug.trim()
  if (!trimmed || trimmed.includes('/') || RESERVED_STOREFRONT_PATHS.has(trimmed.toLowerCase())) return null
  return `/${trimmed}`
}

interface SlugChange {
  locale: string
  from: string
  to: string
}

/** Locale slugs that differ between two versions of the same record. */
export function changedSlugPaths(before: ContentLocale[], after: ContentLocale[]) {
  const previous = new Map(before.map(entry => [entry.locale.toLowerCase(), entry.slug]))
  const changes: SlugChange[] = []
  const skipped: string[] = []

  for (const entry of after) {
    const oldSlug = previous.get(entry.locale.toLowerCase())
    if (!oldSlug || oldSlug === entry.slug) continue

    const from = contentPathForSlug(oldSlug)
    const to = contentPathForSlug(entry.slug)
    // The new slug always came through the model's SLUG_PATTERN, so `to` is
    // present; a missing `from` means the old slug was never a route.
    if (!from) {
      skipped.push(oldSlug)
      continue
    }
    if (!to || from === to) continue
    changes.push({ locale: entry.locale, from, to })
  }

  return { changes, skipped }
}

/**
 * Creates the 301 rows for a slug change on a **published** record. A draft is
 * skipped: nobody could have visited its URL, so a row would only be noise in
 * the redirect map.
 */
export async function syncContentSlugRedirects(
  model: Model<RedirectDocument>,
  input: {
    siteId: string
    published: boolean
    before: ContentLocale[]
    after: ContentLocale[]
  },
): Promise<SlugRedirectOutcome> {
  const outcome: SlugRedirectOutcome = { created: [], kept: [], skipped: [] }
  if (!input.published) return outcome

  const { changes, skipped } = changedSlugPaths(input.before, input.after)
  outcome.skipped = skipped

  for (const change of changes) {
    let upserted = false
    try {
      const result = await model.updateOne(
        { siteId: input.siteId, from: change.from },
        {
          $setOnInsert: {
            siteId: input.siteId,
            from: change.from,
            to: change.to,
            statusCode: 301,
            isActive: true,
            note: AUTO_SLUG_REDIRECT_NOTE,
            revision: 1,
          },
        },
        { upsert: true },
      )
      upserted = result.upsertedCount > 0
    } catch (error) {
      // Another writer claimed the path between the read and this upsert; the
      // record must still save, so the row is reported as kept instead.
      const duplicate = error as { code?: number }
      if (duplicate?.code !== 11000) throw error
    }

    if (upserted) {
      outcome.created.push({ from: change.from, to: change.to })
    } else {
      outcome.kept.push(change.from)
    }
  }

  return outcome
}
