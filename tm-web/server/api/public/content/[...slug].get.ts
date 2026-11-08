import { contentKeyFromPath } from '@tm/flow-contracts'

/**
 * Public read for one content record. The path is resolved as a content key
 * (`pages/gioi-thieu`) or as the requested locale's slug (`gioi-thieu`), so a
 * short URL and the canonical key URL both render the same record.
 */
export default defineEventHandler(async (event) => {
  const key = contentKeyFromPath(getRouterParam(event, 'slug'))
  if (!key) {
    throw createError({ statusCode: 404, statusMessage: 'error.contentNotFound' })
  }

  const content = await fetchPublicContent(event, { path: key, locale: getContentLocale(event) })
  if (!content) {
    throw createError({ statusCode: 404, statusMessage: 'error.contentNotFound' })
  }

  setHeader(event, 'Cache-Control', 'public, max-age=30, s-maxage=300, stale-while-revalidate=600')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Content-Language', content.locale)

  return {
    success: true,
    data: content,
  }
})
