import type { EventHandler, H3Event } from 'h3'

export const CATALOG_CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
export const NO_STORE = 'no-store'

/**
 * Cache key for a public storefront read.
 * Scoped by database name so two customers sharing one cache (preview
 * deployments, local multi-customer dev) can never read each other's data.
 */
export function catalogCacheKey(event: H3Event, namespace: string): string {
  const config = useRuntimeConfig(event)
  const database = String(config.catalogDbName || 'none')
  const url = getRequestURL(event)
  return `catalog:${database}:${namespace}:${url.pathname}${url.search}`
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
