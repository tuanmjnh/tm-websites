import type { Model } from 'mongoose'
import type { RedirectDocument } from '../models/redirect'
import { writeSlugRedirects, type SlugRedirectOutcome } from './slugRedirects'

/**
 * Automatic 301s for a live catalog category whose slug changed.
 *
 * The storefront serves a category at `/categories/<slug>`, where the slug may
 * be the Vietnamese or English one. A rename therefore breaks one path per
 * changed locale; each old path is mapped to the new path in the same locale.
 */

export const AUTO_CATEGORY_SLUG_REDIRECT_NOTE = 'auto: category slug changed'

/** Normalized category path for one slug, or null when it cannot be a path. */
export function categoryPathForSlug(slug: string): string | null {
  const trimmed = slug.trim()
  if (!trimmed || trimmed.includes('/')) return null
  return `/categories/${trimmed}`
}

export async function syncCatalogCategorySlugRedirects(
  model: Model<RedirectDocument>,
  input: {
    siteId: string
    /** A deleted category has no public page to move from. */
    live: boolean
    before: Record<string, string>
    after: Record<string, string>
  },
): Promise<SlugRedirectOutcome> {
  if (!input.live) return { created: [], kept: [], skipped: [] }

  const changes = new Map<string, string>()
  const skipped: string[] = []
  const locales = new Set([...Object.keys(input.before), ...Object.keys(input.after)])

  for (const locale of locales) {
    const oldSlug = input.before[locale]?.trim() ?? ''
    const newSlug = input.after[locale]?.trim() ?? ''
    if (!oldSlug || !newSlug || oldSlug === newSlug) continue

    const from = categoryPathForSlug(oldSlug)
    const to = categoryPathForSlug(newSlug)
    if (!from) {
      skipped.push(oldSlug)
      continue
    }
    // The new slug came through the model's slug normalization, so `to` is
    // present; keeping the first target makes duplicate old slugs deterministic.
    if (to && !changes.has(from)) changes.set(from, to)
  }

  const outcome = await writeSlugRedirects(
    model,
    input.siteId,
    [...changes].map(([from, to]) => ({ from, to })),
    AUTO_CATEGORY_SLUG_REDIRECT_NOTE,
  )
  outcome.skipped = skipped
  return outcome
}
