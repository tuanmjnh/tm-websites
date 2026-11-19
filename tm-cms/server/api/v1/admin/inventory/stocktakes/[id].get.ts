import { getStocktake } from '#server/services/stocktakeService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')

  try {
    const stocktake = await withPreparedDb(event, ({ Stocktake }) => getStocktake(Stocktake, siteId, id))
    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: stocktake })
  } catch (error) {
    return translateContentError(error)
  }
})
