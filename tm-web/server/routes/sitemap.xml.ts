import { contentKeyToPath } from '@tm/flow-contracts'
import { buildSitemapEntries, buildSitemapXml } from '@tm/flow-utils/seo'
import { listCatalogCategorySitemapEntries, listCatalogSitemapEntries } from '#server/utils/catalogService'

export default defineEventHandler(async (event) => {
  const baseUrl = getSiteBaseUrl(event)
  const [contents, categories, tags, products, catalogCategories] = await Promise.all([
    fetchAllPublishedContent(event),
    fetchPublicContentCategories(event),
    fetchPublicContentTags(event),
    // A catalog that is not connected or not reachable must not take the whole
    // sitemap (and with it the content pages) down.
    listCatalogSitemapEntries(event).catch(() => []),
    listCatalogCategorySitemapEntries(event).catch(() => []),
  ])

  const pages = contents.flatMap((content) => {
    const path = contentKeyToPath(content.key)
    return path ? [{ path, lastmod: content.updatedAt ?? null }] : []
  })

  // Landing pages are crawlable URLs too; an empty tag page is harmless to list,
  // a tag can gain published content at any time.
  const taxonomy = [
    ...categories.map(category => ({ path: `/danh-muc/${category.slug}` })),
    ...tags.map(tag => ({ path: `/tag/${encodeURIComponent(tag)}` })),
  ]

  const xml = buildSitemapXml(buildSitemapEntries(baseUrl, [...pages, ...products, ...catalogCategories, ...taxonomy]))

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600')
  return xml
})
