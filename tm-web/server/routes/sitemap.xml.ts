import { contentKeyToPath } from '@tm/flow-contracts'
import { buildSitemapEntries, buildSitemapXml } from '@tm/flow-utils/seo'

export default defineEventHandler(async (event) => {
  const baseUrl = getSiteBaseUrl(event)
  const [contents, categories, tags] = await Promise.all([
    fetchAllPublishedContent(event),
    fetchPublicContentCategories(event),
    fetchPublicContentTags(event),
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

  const xml = buildSitemapXml(buildSitemapEntries(baseUrl, [...pages, ...taxonomy]))

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600')
  return xml
})
