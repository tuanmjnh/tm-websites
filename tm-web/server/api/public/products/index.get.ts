import { PublicCatalogListSchema } from '@tm/flow-contracts'
import { catalogCacheKey, withCatalogCacheHeaders } from '#server/utils/catalogCache'
import { parsePublicCatalogQuery } from '#server/utils/catalogQuery'
import { listCatalogItems } from '#server/utils/catalogService'

const cachedProducts = cachedEventHandler(async (event) => {
  const query = parsePublicCatalogQuery(getQuery(event))
  const result = await listCatalogItems(event, query)

  return PublicCatalogListSchema.parse({
    success: true,
    data: result.items,
    total: result.total,
    page: result.page,
    limit: result.limit,
    hasMore: result.hasMore,
  })
}, {
  maxAge: 60,
  staleMaxAge: 300,
  swr: true,
  getKey: event => catalogCacheKey(event, 'products'),
})

export default withCatalogCacheHeaders(defineEventHandler(event => cachedProducts(event)))
