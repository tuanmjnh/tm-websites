import type { H3Event } from 'h3'

/**
 * Cache keys for the storefront's public reads.
 *
 * Every key starts with the customer database and then a scope, so a purge can
 * drop exactly the entries a CMS save invalidated and leave the rest of the
 * cache (including another customer sharing the same cache) untouched. The
 * database half matters because preview deployments and local multi-customer
 * development run several sites against one Nitro cache.
 *
 * Scope `site` holds the projections a settings, menu or redirect save changes
 * (`/api/public/site`, `/api/public/site-config`); `catalog` holds the product
 * and category reads. A category rename feeds the site projection too, because
 * menus and URLs embed category names.
 */

export const PUBLIC_CACHE_SCOPES = ['site', 'catalog'] as const
export type PublicCacheScope = (typeof PUBLIC_CACHE_SCOPES)[number]

/** Nitro prefixes every cached handler entry with this. */
export const NITRO_HANDLER_MARKER = 'nitro:handlers:'

/**
 * Nitro stores a handler entry under `nitro:handlers:...` and sanitises the key
 * with `String(key).replace(/\W/g, "")`, so every character outside
 * `[A-Za-z0-9_]` disappears — colons, dashes, slashes and query punctuation
 * alike. Separators are therefore `__`, which survives that pass, and each part
 * is slugged here so a purge matches the key Nitro actually wrote.
 */
export function cacheKeySlug(value: string): string {
  return String(value || 'none').replace(/[^A-Za-z0-9_]/g, '_')
}

export function publicCacheKey(database: string, scope: PublicCacheScope, key: string): string {
  return `public__${cacheKeySlug(database)}__${scope}__${cacheKeySlug(key)}`
}

/** The prefix a purge removes: tenant first, then the scope it was asked for. */
export function publicCachePrefix(database: string, scope: PublicCacheScope): string {
  return `public__${cacheKeySlug(database)}__${scope}__`
}

/**
 * Reads the CMS reason (`catalog.item.update`, `menu.create`, ...) as a scope.
 * An unknown or missing namespace returns both scopes: a purge may do extra
 * work, but it must never leave a stale projection behind because a caller used
 * a reason this module has not seen.
 */
export function scopesForReason(reason: unknown): PublicCacheScope[] {
  const raw = typeof reason === 'string' ? reason.trim() : ''
  // A category rename reaches the site projection: menus and URLs carry its name.
  if (raw.startsWith('catalog.category.')) return ['site', 'catalog']
  if (raw.startsWith('catalog.')) return ['catalog']
  if (raw.startsWith('menu.') || raw.startsWith('settings.') || raw.startsWith('redirect.')) return ['site']
  return [...PUBLIC_CACHE_SCOPES]
}

/**
 * The slice of unstorage this module needs. Declared structurally so the purge
 * can be tested with a plain map instead of a running Nitro server.
 */
export interface PublicCacheStorage {
  getKeys(): Promise<string[]>
  removeItem(key: string): Promise<void>
}

export interface PurgePublicCacheResult {
  scopes: PublicCacheScope[] | 'all'
  removedCount: number
  removedKeys: string[]
  /** Handler entries left in the cache, so a caller can prove the rest survived. */
  remainingHandlerKeys: number
}

/**
 * Removes the cached handler entries for one database and one set of scopes.
 * `'all'` is the operator escape hatch and still only touches handler entries.
 */
export async function purgePublicCache(
  storage: PublicCacheStorage,
  database: string,
  scopes: PublicCacheScope[] | 'all',
): Promise<PurgePublicCacheResult> {
  const keys = await storage.getKeys()
  const handlerKeys = keys.filter(key => key.includes(NITRO_HANDLER_MARKER))
  const prefixes = scopes === 'all'
    ? []
    : scopes.map(scope => publicCachePrefix(database, scope))

  const doomed = handlerKeys.filter(key => scopes === 'all' || prefixes.some(prefix => key.includes(prefix)))
  for (const key of doomed) {
    await storage.removeItem(key)
  }

  return {
    scopes,
    removedCount: doomed.length,
    removedKeys: doomed,
    remainingHandlerKeys: handlerKeys.length - doomed.length,
  }
}

/** Database half of the key, from the deployment's runtime config. */
export function publicCacheDatabase(event: H3Event): string {
  const config = useRuntimeConfig(event)
  return String(config.catalogDbName || 'none')
}
