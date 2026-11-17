import type { Model } from 'mongoose'
import type { CategoryDocument, CategoryLocale } from '../models/category'
import type { RedirectDocument } from '../models/redirect'
import { resolveRedirect } from './redirectService'
import { writeSlugRedirects, type SlugRedirectOutcome } from './slugRedirects'

/**
 * Automatic 301s for a content category whose landing slug changed.
 *
 * The storefront serves a category at `/danh-muc/<slug>`, where the slug may be
 * the Vietnamese or English one. A rename breaks one path per changed locale;
 * each old path is mapped to the new path in the same locale.
 *
 * Two paths are never redirected:
 * - a path that is still one of the category's slugs after the save (a VI/EN
 *   swap keeps both landings live);
 * - a path another category already uses, so a redirect cannot shadow it.
 *
 * An auto row for a path that has become live again is removed, so reusing an
 * old slug makes the new category reachable. A manual row is left untouched.
 */

export const AUTO_CONTENT_CATEGORY_SLUG_REDIRECT_NOTE = 'auto: content category slug changed'

/** Normalized content category path for one slug, or null when it cannot be a path. */
export function contentCategoryPathForSlug(slug: string): string | null {
  const trimmed = slug.trim()
  if (!trimmed || trimmed.includes('/')) return null
  return `/danh-muc/${trimmed}`
}

function slugPaths(locales: CategoryLocale[]): Set<string> {
  const paths = new Set<string>()
  for (const entry of locales) {
    const path = contentCategoryPathForSlug(entry.slug)
    if (path) paths.add(path)
  }
  return paths
}

export async function syncContentCategorySlugRedirects(
  redirects: Model<RedirectDocument>,
  categories: Model<CategoryDocument>,
  input: {
    siteId: string
    categoryId: string
    before: CategoryLocale[]
    after: CategoryLocale[]
  },
): Promise<SlugRedirectOutcome> {
  const livePaths = slugPaths(input.after)
  if (livePaths.size) {
    await redirects.deleteMany({
      siteId: input.siteId,
      from: { $in: [...livePaths] },
      note: AUTO_CONTENT_CATEGORY_SLUG_REDIRECT_NOTE,
    })
  }

  const previous = new Map(input.before.map(entry => [entry.locale.toLowerCase(), entry.slug]))
  const candidates = new Map<string, { slug: string, targets: Set<string> }>()
  const skipped: string[] = []

  for (const entry of input.after) {
    const oldSlug = previous.get(entry.locale.toLowerCase())
    if (!oldSlug || oldSlug === entry.slug) continue

    const from = contentCategoryPathForSlug(oldSlug)
    const to = contentCategoryPathForSlug(entry.slug)
    if (!from) {
      skipped.push(oldSlug)
      continue
    }
    // A swapped locale still serves this path after the save, so a redirect
    // would both hide the page and turn the two rows into a loop.
    if (!to || from === to || livePaths.has(from)) continue

    const candidate = candidates.get(from)
    if (candidate) candidate.targets.add(to)
    else candidates.set(from, { slug: oldSlug, targets: new Set([to]) })
  }

  if (!candidates.size) return { created: [], kept: [], skipped }

  const oldSlugs = [...new Set([...candidates.values()].map(candidate => candidate.slug))]
  const occupied = await categories.find({
    siteId: input.siteId,
    _id: { $ne: input.categoryId },
    'locales.slug': { $in: oldSlugs },
  }).select('locales.slug').lean<Array<{ locales?: Array<{ slug?: string }> }>>()
  const occupiedSlugs = new Set(
    occupied.flatMap(row => (row.locales ?? []).map(entry => entry.slug).filter(Boolean)),
  )

  const changes: Array<{ from: string, to: string }> = []
  for (const [from, candidate] of candidates) {
    // The same old path cannot point at two different new pages.
    const [to] = candidate.targets
    if (candidate.targets.size !== 1 || !to) {
      skipped.push(candidate.slug)
      continue
    }
    if (occupiedSlugs.has(candidate.slug)) {
      skipped.push(candidate.slug)
      continue
    }
    // A manual row may already point the new path back here; do not close a loop.
    const resolved = await resolveRedirect(redirects, input.siteId, to)
    if (resolved && resolved.statusCode !== 410 && resolved.to === from) {
      skipped.push(candidate.slug)
      continue
    }
    changes.push({ from, to })
  }

  const outcome = await writeSlugRedirects(
    redirects,
    input.siteId,
    changes,
    AUTO_CONTENT_CATEGORY_SLUG_REDIRECT_NOTE,
  )
  outcome.skipped = skipped
  return outcome
}
