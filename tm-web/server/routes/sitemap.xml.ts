import { buildSitemapEntries, buildSitemapXml } from '@tm/flow-utils/seo'
import { listCatalogCategorySitemapEntries, listCatalogSitemapEntries } from '#server/utils/catalogService'
import { listContentSitemapEntries } from '#server/utils/publicContent'

/**
 * The newest record on a listing is the last time the page really changed.
 * Entries without a timestamp are ignored rather than guessed at.
 */
function newestLastmod(entries: { lastmod?: string | null }[]): string | null {
  return entries.reduce<string | null>((latest, entry) => {
    const value = entry.lastmod ?? null
    return value && (!latest || value > latest) ? value : latest
  }, null)
}

export default defineEventHandler(async (event) => {
  const baseUrl = getSiteBaseUrl(event)
  const [pages, categories, tags, products, catalogCategories] = await Promise.all([
    listContentSitemapEntries(event),
    fetchPublicContentCategories(event),
    fetchPublicContentTags(event),
    // A catalog that is not connected or not reachable must not take the whole
    // sitemap (and with it the content pages) down.
    listCatalogSitemapEntries(event).catch(() => []),
    listCatalogCategorySitemapEntries(event).catch(() => []),
  ])

  // Landing pages are crawlable URLs too; an empty tag page is harmless to list,
  // a tag can gain published content at any time.
  const taxonomy = [
    // The index is only worth a crawl entry when it lists something.
    ...(categories.length ? [{ path: '/danh-muc' }] : []),
    ...categories.map(category => ({ path: `/danh-muc/${category.slug}` })),
    ...tags.map(tag => ({ path: `/tag/${encodeURIComponent(tag)}` })),
  ]

  // A listing page is a crawlable URL in its own right, and it is only worth a
  // crawl entry while it has something to list; its `lastmod` is the newest
  // record shown on it. Search and the cart stay out: one is `noindex`, the
  // other holds no public content.
  const listings = [
    ...(pages.length ? [{ path: '/bai-viet', lastmod: newestLastmod(pages) }] : []),
    ...(products.length ? [{ path: '/products', lastmod: newestLastmod(products) }] : []),
    ...(catalogCategories.length ? [{ path: '/categories', lastmod: newestLastmod(catalogCategories) }] : []),
  ]

  const xml = buildSitemapXml(buildSitemapEntries(baseUrl, [...pages, ...products, ...catalogCategories, ...taxonomy, ...listings]))

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600')
  return xml
})
