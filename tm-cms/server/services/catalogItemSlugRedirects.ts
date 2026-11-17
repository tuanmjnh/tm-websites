import type { Model } from 'mongoose'
import type { CatalogItemDocument } from '../models/catalog'
import type { RedirectDocument } from '../models/redirect'
import { resolveRedirect } from './redirectService'
import { writeSlugRedirects, type SlugRedirectOutcome } from './slugRedirects'

/**
 * Automatic 301s for a published catalog item whose slug changed.
 *
 * The storefront serves an item at `/products/<slug>`, where the slug may be the
 * Vietnamese or English one. A rename breaks one path per changed locale; each
 * old path is mapped to the new path in the same locale.
 *
 * Only a publicly visible item owns its paths: a draft, archived, deleted or
 * inactive record was not reachable, and its rows are removed instead. Two live
 * paths are never redirected: one that is still a slug of the item after the save
 * (a VI/EN swap), and one another live item already owns. A manual row stays.
 */

export const AUTO_CATALOG_ITEM_SLUG_REDIRECT_NOTE = 'auto: catalog item slug changed'

/** Normalized product path for one slug, or null when it cannot be a path. */
export function catalogItemPathForSlug(slug: string): string | null {
  const trimmed = slug.trim()
  if (!trimmed || trimmed.includes('/')) return null
  return `/products/${trimmed}`
}

function slugPaths(slugs: Record<string, string>): Set<string> {
  const paths = new Set<string>()
  for (const slug of Object.values(slugs)) {
    const path = catalogItemPathForSlug(slug)
    if (path) paths.add(path)
  }
  return paths
}

/** The public filter the storefront uses; a live item is what can own a URL. */
export function isPublicCatalogItem(record: {
  status?: string
  isActive?: boolean
  isDeleted?: boolean
}): boolean {
  return record.status === 'published' && record.isActive !== false && record.isDeleted !== true
}

export async function syncCatalogItemSlugRedirects(
  redirects: Model<RedirectDocument>,
  items: Model<CatalogItemDocument>,
  input: {
    siteId: string
    itemId: string
    live: boolean
    before: Record<string, string>
    after: Record<string, string>
  },
): Promise<SlugRedirectOutcome> {
  const beforePaths = slugPaths(input.before)
  const afterPaths = slugPaths(input.after)

  // A hidden record has no page left. Its automatic rows would only send a
  // visitor to a 404, so the ones that lead to or from its paths go as well;
  // a manual row is an explicit instruction and stays.
  if (!input.live) {
    const gonePaths = new Set([...beforePaths, ...afterPaths])
    if (gonePaths.size) {
      await redirects.deleteMany({
        siteId: input.siteId,
        note: AUTO_CATALOG_ITEM_SLUG_REDIRECT_NOTE,
        $or: [{ from: { $in: [...gonePaths] } }, { to: { $in: [...gonePaths] } }],
      })
    }
    return { created: [], kept: [], skipped: [] }
  }

  if (afterPaths.size) {
    await redirects.deleteMany({
      siteId: input.siteId,
      from: { $in: [...afterPaths] },
      note: AUTO_CATALOG_ITEM_SLUG_REDIRECT_NOTE,
    })
  }

  const candidates = new Map<string, { slug: string, targets: Set<string> }>()
  const skipped: string[] = []

  for (const [locale, newSlug] of Object.entries(input.after)) {
    const oldSlug = input.before[locale]?.trim() ?? ''
    const trimmedNew = newSlug?.trim() ?? ''
    if (!oldSlug || !trimmedNew || oldSlug === trimmedNew) continue

    const from = catalogItemPathForSlug(oldSlug)
    const to = catalogItemPathForSlug(trimmedNew)
    if (!from) {
      skipped.push(oldSlug)
      continue
    }
    // A swapped locale still serves this path after the save, so redirecting it
    // would hide the page and turn the two rows into a loop.
    if (!to || from === to || afterPaths.has(from)) continue

    const candidate = candidates.get(from)
    if (candidate) candidate.targets.add(to)
    else candidates.set(from, { slug: oldSlug, targets: new Set([to]) })
  }

  if (!candidates.size) return { created: [], kept: [], skipped }

  const oldSlugs = [...new Set([...candidates.values()].map(candidate => candidate.slug))]
  const locales = [...new Set([...Object.keys(input.before), ...Object.keys(input.after)])]
  const occupied = await items.find({
    siteId: input.siteId,
    _id: { $ne: input.itemId },
    isDeleted: { $ne: true },
    isActive: { $ne: false },
    status: 'published',
    $or: locales.map(locale => ({ [`slug.${locale}`]: { $in: oldSlugs } })),
  }).select('slug').lean<Array<{ slug?: Record<string, string> }>>()
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
    AUTO_CATALOG_ITEM_SLUG_REDIRECT_NOTE,
  )
  outcome.skipped = skipped
  return outcome
}
