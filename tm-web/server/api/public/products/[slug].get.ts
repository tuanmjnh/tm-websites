import { catalogSegmentFromParam, PublicCatalogApiResponseSchema } from '@tm/flow-contracts'
import { catalogCacheKey, withCatalogCacheHeaders } from '#server/utils/catalogCache'
import { getCatalogItemBySlug } from '#server/utils/catalogService'

const cachedProduct = cachedEventHandler(async (event) => {
  const slug = catalogSegmentFromParam(getRouterParam(event, 'slug'))
  if (!slug) {
    throw createError({ statusCode: 404, statusMessage: 'error.productNotFound' })
  }

  const item = await getCatalogItemBySlug(event, slug)
  if (!item) {
    throw createError({ statusCode: 404, statusMessage: 'error.productNotFound' })
  }

  return PublicCatalogApiResponseSchema.parse({ success: true, data: item })
}, {
  maxAge: 60,
  staleMaxAge: 300,
  swr: true,
  getKey: event => catalogCacheKey(event, 'product'),
})

export default withCatalogCacheHeaders(defineEventHandler(event => cachedProduct(event)))
