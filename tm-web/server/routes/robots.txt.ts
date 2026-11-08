import { buildRobotsTxt } from '@tm/flow-utils/seo'

/**
 * robots.txt for the storefront.
 *
 * A deployment that is not meant to be indexed (`TM_SITE_INDEXABLE=false`, e.g.
 * a preview) disallows everything, which also matches the page-level
 * `noindex, follow` meta. Otherwise only the API and the search page are
 * excluded: search result URLs depend on a visitor's query and are marked
 * `noindex` too, while content/tag/category pages stay crawlable.
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const body = buildRobotsTxt(getSiteBaseUrl(event), config.public.indexable !== false)

  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600')
  return body
})
