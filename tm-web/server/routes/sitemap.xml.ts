import { contentKeyToPath } from '@tm/flow-contracts'
import { buildSitemapEntries, buildSitemapXml } from '@tm/flow-utils/seo'

export default defineEventHandler(async (event) => {
  const baseUrl = getSiteBaseUrl(event)
  const contents = await fetchAllPublishedContent(event)

  const pages = contents.flatMap((content) => {
    const path = contentKeyToPath(content.key)
    return path ? [{ path, lastmod: content.updatedAt ?? null }] : []
  })

  const xml = buildSitemapXml(buildSitemapEntries(baseUrl, pages))

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600')
  return xml
})
