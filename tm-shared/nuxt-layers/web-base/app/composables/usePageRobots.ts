import type { MaybeRefOrGetter } from 'vue'

export interface PageRobotsOptions {
  /**
   * Query keys this URL really uses to name a page (the catalog uses `page`).
   * Any other key makes the request a view of the same page.
   */
  keepQuery?: readonly string[]
  /** The page has nothing to list, so it would be a thin page. */
  empty?: MaybeRefOrGetter<boolean>
  /** This URL is an alias for the canonical URL of the same content. */
  alias?: MaybeRefOrGetter<boolean>
  /** The page is never a destination at all: a cart, a search result page. */
  never?: boolean
}

/**
 * The robots rule every public page shares, in one place.
 *
 * A site that is not indexable answers `noindex, nofollow` whatever the page says.
 * A query view, an alias and an empty page are `noindex, follow`: a crawler should
 * not keep the URL, but the links on it still lead somewhere worth crawling.
 * Everything else is `index, follow`.
 */
export function usePageRobots(options: PageRobotsOptions = {}) {
  const config = useRuntimeConfig()
  const route = useRoute()
  const keepQuery = new Set(options.keepQuery ?? [])

  return computed(() => {
    if (config.public.indexable === false) return 'noindex, nofollow'
    if (options.never) return 'noindex, follow'
    if (Object.keys(route.query).some(key => !keepQuery.has(key))) return 'noindex, follow'
    if (options.alias && toValue(options.alias)) return 'noindex, follow'
    if (options.empty && toValue(options.empty)) return 'noindex, follow'
    return 'index, follow'
  })
}
