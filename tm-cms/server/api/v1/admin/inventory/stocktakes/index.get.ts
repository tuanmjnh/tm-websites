import { listStocktakes } from '#server/services/stocktakeService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = getQuery(event)

  try {
    const result = await withPreparedDb(event, ({ Stocktake }) =>
      listStocktakes(Stocktake, siteId, {
        status: typeof query.status === 'string' && query.status ? query.status as 'draft' | 'completed' | 'cancelled' : null,
        warehouseId: typeof query.warehouseId === 'string' && query.warehouseId ? query.warehouseId : null,
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: result.data,
      meta: { counts: result.summary, total: result.data.length },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
