import { timingSafeEqual } from 'node:crypto'
import { publicCacheDatabase, purgePublicCache, PUBLIC_CACHE_SCOPES, scopesForReason, type PublicCacheScope } from '#server/utils/publicCache'

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

interface PurgeBody {
  secret?: unknown
  /** CMS reason, e.g. `catalog.item.update`; decides which scopes are dropped. */
  reason?: unknown
  /** Operator override: a single scope, or `all` to drop every handler entry. */
  scope?: unknown
}

/**
 * Drops the cached Nitro handler responses a CMS save invalidated.
 *
 * Scoped on purpose: a catalog edit removes the catalog keys of one tenant, a
 * menu or settings save removes its site projection, and a category rename
 * removes both because menus and URLs carry the category name. A reason this
 * module does not recognise removes both scopes rather than guessing wrong, and
 * an unrelated customer's keys are never touched. `{ scope: 'all' }` remains the
 * operator escape hatch. Requires REVALIDATE_SECRET; the route is inert without
 * it.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const expected = String(config.revalidateSecret || '')

  if (!expected) {
    throw createError({
      statusCode: 503,
      statusMessage: 'error.revalidateDisabled',
      data: { code: 'REVALIDATE_DISABLED' },
    })
  }

  const headerSecret = String(getHeader(event, 'x-revalidate-secret') || '')
  const body = await readBody<PurgeBody>(event).catch(() => ({} as PurgeBody))
  const bodySecret = typeof body?.secret === 'string' ? body.secret : ''
  const provided = headerSecret || bodySecret

  if (!provided || !secretsMatch(provided, expected)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'error.invalidRevalidateSecret',
      data: { code: 'INVALID_REVALIDATE_SECRET' },
    })
  }

  const requestedScope = typeof body?.scope === 'string' ? body.scope.trim() : ''
  if (requestedScope && requestedScope !== 'all' && !PUBLIC_CACHE_SCOPES.includes(requestedScope as PublicCacheScope)) {
    throw createError({
      statusCode: 422,
      statusMessage: 'error.invalidCacheScope',
      data: { code: 'INVALID_CACHE_SCOPE', scopes: PUBLIC_CACHE_SCOPES },
    })
  }

  const scopes: PublicCacheScope[] | 'all' = requestedScope === 'all'
    ? 'all'
    : requestedScope
      ? [requestedScope as PublicCacheScope]
      : scopesForReason(body?.reason)

  const database = publicCacheDatabase(event)
  const result = await purgePublicCache(useStorage('cache'), database, scopes)

  // The redirect map keeps its own short cache, outside Nitro's handler cache.
  // It is per database, so one tenant's purge cannot empty another's map.
  clearRedirectCache(scopes === 'all' ? undefined : database)

  setHeader(event, 'Cache-Control', 'no-store')
  return {
    success: true,
    database,
    scopes: result.scopes,
    removedCount: result.removedCount,
    removedKeys: result.removedKeys,
    remainingHandlerKeys: result.remainingHandlerKeys,
  }
})
