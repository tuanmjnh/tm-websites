import type { EventHandler, H3Event } from 'h3'
import { publicCacheDatabase, publicCacheKey } from './publicCache'

export const CATALOG_CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
export const NO_STORE = 'no-store'

/**
 * Cache key for a public storefront catalog read.
 *
 * Scoped by database name and by the `catalog` cache scope, so a quota or
 * catalog write can purge these keys without touching the site projection, and
 * two customers sharing one cache can never read each other's data.
 */
export function catalogCacheKey(event: H3Event, namespace: string): string {
  const url = getRequestURL(event)
  return publicCacheKey(publicCacheDatabase(event), 'catalog', `${namespace}:${url.pathname}${url.search}`)
}

/** Cache key for a projection of the site itself (`/api/public/site`, `site-config`). */
export function siteCacheKey(event: H3Event, key: string): string {
  return publicCacheKey(publicCacheDatabase(event), 'site', key)
}

/**
 * Applies cache headers around a cached handler.
 * A cached response never re-runs the inner handler, so the header is set on
 * the outer wrapper; failures are always marked `no-store` so a 404 or a 503
 * can never be pinned by a CDN.
 */
export function withCatalogCacheHeaders(handler: EventHandler, cacheControl = CATALOG_CACHE_CONTROL): EventHandler {
  return defineEventHandler(async (event) => {
    try {
      const result = await handler(event)
      setHeader(event, 'Cache-Control', cacheControl)
      setHeader(event, 'X-Content-Type-Options', 'nosniff')
      return result
    } catch (error) {
      setHeader(event, 'Cache-Control', NO_STORE)
      throw error
    }
  })
}
