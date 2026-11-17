import type { Model } from 'mongoose'
import type { CatalogCategoryDocument } from '../models/catalog'
import type { RedirectDocument } from '../models/redirect'
import { resolveRedirect } from './redirectService'
import { writeSlugRedirects, type SlugRedirectOutcome } from './slugRedirects'

/**
 * Automatic 301s for a live catalog category whose slug changed.
 *
 * The storefront serves a category at `/categories/<slug>`, where the slug may
 * be the Vietnamese or English one. A rename breaks one path per changed locale;
 * each old path is mapped to the new path in the same locale.
 *
 * Two paths are never redirected:
 * - a path that is still one of the category's slugs after the save (a VI/EN
 *   swap keeps both pages live);
 * - a path another live category already uses, so a redirect cannot shadow it.
 *
 * An auto row for a path that has become live again is removed, so reusing an
 * old slug makes the new category reachable. A manual row is left untouched.
 */

export const AUTO_CATEGORY_SLUG_REDIRECT_NOTE = 'auto: category slug changed'

/** Normalized category path for one slug, or null when it cannot be a path. */
export function categoryPathForSlug(slug: string): string | null {
  const trimmed = slug.trim()
  if (!trimmed || trimmed.includes('/')) return null
  return `/categories/${trimmed}`
}

function slugPaths(slugs: Record<string, string>): Set<string> {
  const paths = new Set<string>()
  for (const slug of Object.values(slugs)) {
    const path = categoryPathForSlug(slug)
    if (path) paths.add(path)
  }
  return paths
}

export async function syncCatalogCategorySlugRedirects(
  redirects: Model<RedirectDocument>,
  categories: Model<CatalogCategoryDocument>,
  input: {
    siteId: string
    categoryId: string
    /** A deleted category has no public page to move from. */
    live: boolean
    before: Record<string, string>
    after: Record<string, string>
  },
): Promise<SlugRedirectOutcome> {
  // A deleted category has no landing left. Its automatic rows would only send
  // a visitor to a 404, so the ones that lead to or from its pages go as well;
  // a manual row is an explicit instruction and stays.
  if (!input.live) {
    const gonePaths = new Set([...slugPaths(input.before), ...slugPaths(input.after)])
    if (gonePaths.size) {
      await redirects.deleteMany({
        siteId: input.siteId,
        note: AUTO_CATEGORY_SLUG_REDIRECT_NOTE,
        $or: [{ from: { $in: [...gonePaths] } }, { to: { $in: [...gonePaths] } }],
      })
    }
    return { created: [], kept: [], skipped: [] }
  }

  const livePaths = slugPaths(input.after)
  if (livePaths.size) {
    await redirects.deleteMany({
      siteId: input.siteId,
      from: { $in: [...livePaths] },
      note: AUTO_CATEGORY_SLUG_REDIRECT_NOTE,
    })
  }

  const candidates = new Map<string, { slug: string, targets: Set<string> }>()
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
    // A swapped locale still serves this path after the save, so a redirect
    // would both hide the page and turn the two rows into a loop.
    if (!to || from === to || livePaths.has(from)) continue

    const candidate = candidates.get(from)
    if (candidate) candidate.targets.add(to)
    else candidates.set(from, { slug: oldSlug, targets: new Set([to]) })
  }

  const oldSlugs = [...new Set([...candidates.values()].map(candidate => candidate.slug))]
  const occupied = oldSlugs.length
    ? await categories.find({
        siteId: input.siteId,
        isDeleted: { $ne: true },
        _id: { $ne: input.categoryId },
        $or: [{ 'slug.vi': { $in: oldSlugs } }, { 'slug.en': { $in: oldSlugs } }],
      }).select('slug').lean<Array<{ slug?: Record<string, string> }>>()
    : []
  const occupiedSlugs = new Set(occupied.flatMap(row => Object.values(row.slug ?? {})))

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
    AUTO_CATEGORY_SLUG_REDIRECT_NOTE,
  )
  outcome.skipped = skipped
  return outcome
}
