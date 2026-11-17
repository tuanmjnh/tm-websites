import type { H3Event } from 'h3'
import { PUBLIC_REDIRECT_PROJECTION, PublicRedirectModel } from '#server/models/redirectPublic'
import type { PublicRedirectDoc } from '#server/models/redirectPublic'
import { withSiteDb } from './mongo'

/**
 * Redirect lookup for the storefront.
 *
 * One indexed equality read per cold path, cached for 30 seconds in process so a
 * page view does not hit Mongo again and again. The cache is keyed by database
 * name: a local multi-customer dev server or a preview project never serves one
 * site's map to another. `null` is cached too — most paths have no redirect, and
 * that is the common case worth memoizing.
 */

const TTL_MS = 30_000
const MAX_ENTRIES = 500
/** Hop limit for one lookup; a longer chain is a map nobody can follow. */
const MAX_CHAIN = 5

export type ResolvedRedirect =
  | { to: string, statusCode: 301 | 302 }
  /** A row the CMS marked gone: the path 410s instead of rendering a page. */
  | { to: '', statusCode: 410 }

interface CacheEntry {
  value: ResolvedRedirect | null
  expiresAt: number
}

const globalForRedirects = globalThis as unknown as { __tmWebRedirects?: Map<string, CacheEntry> }
const cache = globalForRedirects.__tmWebRedirects ?? new Map<string, CacheEntry>()
globalForRedirects.__tmWebRedirects = cache

/** Same normalization the CMS applies when it stores a row. */
export function normalizeRequestPath(path: string): string | null {
  if (!path.startsWith('/')) return null
  if (/[?#\s\\]/.test(path) || path.includes('//')) return null
  return path.replace(/\/+$/, '') || '/'
}

function remember(key: string, value: ResolvedRedirect | null): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS })
}

/** One indexed equality read of the redirect map for a single path. */
async function readRow(event: H3Event, from: string): Promise<PublicRedirectDoc | null> {
  return withSiteDb(event, () => PublicRedirectModel.findOne({ from, isActive: true })
    .select(PUBLIC_REDIRECT_PROJECTION)
    .lean<PublicRedirectDoc | null>())
}

/**
 * Follows at most five hops, so a row whose target later received its own
 * redirect still lands on a page with one browser hop instead of two. The first
 * row decides the status code; a chain that comes back to the requested path
 * stops instead, because the page that owns that path is a better answer than
 * `ERR_TOO_MANY_REDIRECTS`.
 */
async function resolveChain(event: H3Event, start: string): Promise<ResolvedRedirect | null> {
  const first = await readRow(event, start)
  if (!first) return null

  if (first.statusCode === 410) return { to: '', statusCode: 410 }
  if (typeof first.to !== 'string' || !first.to) return null

  let target = first.to
  for (let hop = 0; hop < MAX_CHAIN; hop += 1) {
    if (target === start) return null
    const next = await readRow(event, target)
    // A gone target ends the chain: there is no page to continue to.
    if (!next || next.statusCode === 410) break
    if (typeof next.to !== 'string' || !next.to || next.to === target) break
    target = next.to
  }

  if (target === start) return null
  return { to: target, statusCode: first.statusCode === 302 ? 302 : 301 }
}

export async function findRedirect(event: H3Event, path: string): Promise<ResolvedRedirect | null> {
  const normalized = normalizeRequestPath(path)
  if (!normalized || normalized === '/') return null

  const config = useRuntimeConfig(event)
  const database = String(config.catalogDbName || 'none')
  const key = `${database}:${normalized}`
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const value = await resolveChain(event, normalized)
  remember(key, value)
  return value
}

/** Drops every cached path for one database (`null` clears all). */
export function clearRedirectCache(database?: string): void {
  if (!database) {
    cache.clear()
    return
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${database}:`)) cache.delete(key)
  }
}
