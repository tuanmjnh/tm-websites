import type { Model } from 'mongoose'
import type { ContentDocument, ContentLocale } from '../models/content'
import type { RedirectDocument } from '../models/redirect'
import { resolveRedirect } from './redirectService'
import { writeSlugRedirects, type SlugRedirectOutcome } from './slugRedirects'

export type { SlugRedirectOutcome } from './slugRedirects'

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
  'about',
  'api',
  'bai-viet',
  'categories',
  'contact',
  'danh-muc',
  'gio-hang',
  'products',
  'tag',
  'tim-kiem',
])

/** Normalized short path of one locale slug, or null when it cannot be a path. */
export function contentPathForSlug(slug: string): string | null {
  const trimmed = slug.trim()
  if (!trimmed || trimmed.includes('/') || RESERVED_STOREFRONT_PATHS.has(trimmed.toLowerCase())) return null
  return `/${trimmed}`
}

interface SlugChange {
  from: string
  to: string
}

/** Locale slugs that differ between two versions of the same record. */
export function changedSlugPaths(before: ContentLocale[], after: ContentLocale[]) {
  const previous = new Map(before.map(entry => [entry.locale.toLowerCase(), entry.slug]))
  const livePaths = new Set(
    after.map(entry => contentPathForSlug(entry.slug)).filter((path): path is string => Boolean(path)),
  )
  const candidates = new Map<string, { slug: string, targets: Set<string> }>()
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
    // A swapped locale still serves this path after the save, so redirecting it
    // would hide the page and turn the two rows into a loop.
    if (!to || from === to || livePaths.has(from)) continue

    const candidate = candidates.get(from)
    if (candidate) candidate.targets.add(to)
    else candidates.set(from, { slug: oldSlug, targets: new Set([to]) })
  }

  const changes: SlugChange[] = []
  for (const [from, candidate] of candidates) {
    const [to] = candidate.targets
    // One old path cannot point at two different new pages.
    if (candidate.targets.size !== 1 || !to) {
      skipped.push(candidate.slug)
      continue
    }
    changes.push({ from, to })
  }

  return { changes, skipped }
}

/**
 * Reconciles the 301 rows for a slug change on a **published** record. A draft
 * is skipped: nobody could have visited its URL, so a row would only be noise.
 *
 * A live record owns its short paths. An auto row under one of them is removed,
 * so reusing a slug makes the new page reachable. A redirect is not written for
 * an old path that another published or scheduled record still uses, and an
 * existing manual row is never replaced.
 */
export async function syncContentSlugRedirects(
  redirects: Model<RedirectDocument>,
  contents: Model<ContentDocument>,
  input: {
    siteId: string
    contentId: string
    published: boolean
    before: ContentLocale[]
    after: ContentLocale[]
  },
): Promise<SlugRedirectOutcome> {
  if (!input.published) return { created: [], kept: [], skipped: [] }

  const livePaths = new Set(
    input.after.map(entry => contentPathForSlug(entry.slug)).filter((path): path is string => Boolean(path)),
  )
  if (livePaths.size) {
    await redirects.deleteMany({
      siteId: input.siteId,
      from: { $in: [...livePaths] },
      note: AUTO_SLUG_REDIRECT_NOTE,
    })
  }

  const { changes, skipped } = changedSlugPaths(input.before, input.after)
  if (!changes.length) return { created: [], kept: [], skipped }

  const oldSlugs = [...new Set(changes.map(change => change.from.slice(1)))]
  const occupied = await contents.find({
    siteId: input.siteId,
    _id: { $ne: input.contentId },
    deletedAt: null,
    status: { $in: ['published', 'scheduled'] },
    'locales.slug': { $in: oldSlugs },
  }).select('locales.slug').lean<Array<{ locales?: Array<{ slug?: string }> }>>()
  const occupiedSlugs = new Set(
    occupied.flatMap(row => (row.locales ?? []).map(entry => entry.slug).filter(Boolean)),
  )

  const writable = []
  for (const change of changes) {
    const oldSlug = change.from.slice(1)
    if (occupiedSlugs.has(oldSlug)) {
      skipped.push(oldSlug)
      continue
    }
    // A manual row may already point the new path back here; do not close a loop.
    const resolved = await resolveRedirect(redirects, input.siteId, change.to)
    if (resolved && resolved.statusCode !== 410 && resolved.to === change.from) {
      skipped.push(oldSlug)
      continue
    }
    writable.push(change)
  }

  const outcome = await writeSlugRedirects(
    redirects,
    input.siteId,
    writable,
    AUTO_SLUG_REDIRECT_NOTE,
  )
  outcome.skipped = skipped
  return outcome
}
