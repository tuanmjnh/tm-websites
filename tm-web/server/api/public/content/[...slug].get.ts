import { contentKeyFromPath } from '@tm/flow-contracts'

export default defineEventHandler(async (event) => {
  const key = contentKeyFromPath(getRouterParam(event, 'slug'))
  if (!key) {
    throw createError({ statusCode: 404, statusMessage: 'error.contentNotFound' })
  }

  const content = await fetchPublicContentByKey(event, key)
  if (!content) {
    throw createError({ statusCode: 404, statusMessage: 'error.contentNotFound' })
  }

  setHeader(event, 'Cache-Control', 'public, max-age=30, s-maxage=300, stale-while-revalidate=600')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')

  return {
    success: true,
    data: content,
  }
})
