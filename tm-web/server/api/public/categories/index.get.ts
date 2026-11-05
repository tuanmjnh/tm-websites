import { catalogCacheKey, withCatalogCacheHeaders } from '#server/utils/catalogCache'
import { listCatalogCategories } from '#server/utils/catalogService'

const cachedCategories = cachedEventHandler(async (event) => {
  const data = await listCatalogCategories(event)
  return { success: true, data }
}, {
  maxAge: 300,
  staleMaxAge: 900,
  swr: true,
  getKey: event => catalogCacheKey(event, 'categories'),
})

export default withCatalogCacheHeaders(defineEventHandler(event => cachedCategories(event)))
