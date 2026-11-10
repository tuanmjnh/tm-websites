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

export interface ResolvedRedirect {
  to: string
  statusCode: 301 | 302
}

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

/**
 * Follows at most five hops, so a row whose target later received its own
 * redirect still lands on a page instead of bouncing the browser.
 */
export async function findRedirect(event: H3Event, path: string): Promise<ResolvedRedirect | null> {
  const normalized = normalizeRequestPath(path)
  if (!normalized || normalized === '/') return null

  const config = useRuntimeConfig(event)
  const database = String(config.catalogDbName || 'none')
  const key = `${database}:${normalized}`
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const row = await withSiteDb(event, () => PublicRedirectModel.findOne({ from: normalized, isActive: true })
    .select(PUBLIC_REDIRECT_PROJECTION)
    .lean<PublicRedirectDoc | null>())

  if (!row || typeof row.to !== 'string' || !row.to) {
    remember(key, null)
    return null
  }

  const value: ResolvedRedirect = {
    to: row.to,
    statusCode: row.statusCode === 302 ? 302 : 301,
  }
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
