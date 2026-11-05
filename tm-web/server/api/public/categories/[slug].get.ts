import { catalogSegmentFromParam } from '@tm/flow-contracts'
import { catalogCacheKey, withCatalogCacheHeaders } from '#server/utils/catalogCache'
import { getCatalogCategoryBySlug } from '#server/utils/catalogService'

const cachedCategory = cachedEventHandler(async (event) => {
  const slug = catalogSegmentFromParam(getRouterParam(event, 'slug'))
  if (!slug) {
    throw createError({ statusCode: 404, statusMessage: 'error.categoryNotFound' })
  }

  const category = await getCatalogCategoryBySlug(event, slug)
  if (!category) {
    throw createError({ statusCode: 404, statusMessage: 'error.categoryNotFound' })
  }

  return { success: true, data: category }
}, {
  maxAge: 300,
  staleMaxAge: 900,
  swr: true,
  getKey: event => catalogCacheKey(event, 'category'),
})

export default withCatalogCacheHeaders(defineEventHandler(event => cachedCategory(event)))
