import { listCatalogItems } from '#server/services/catalogService'
import { CatalogItemListQuerySchema, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(CatalogItemListQuerySchema, getQuery(event), 'CATALOG_QUERY_INVALID', 'Bộ lọc không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ CatalogItem, CatalogCategory }) =>
      listCatalogItems(CatalogItem, CatalogCategory, siteId, query))

    setHeader(event, 'cache-control', 'no-store')

    return successResponse({
      event,
      data: result.data,
      meta: {
        nextCursor: result.nextCursor ?? undefined,
        hasMore: result.hasMore,
        counts: result.counts,
      },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
