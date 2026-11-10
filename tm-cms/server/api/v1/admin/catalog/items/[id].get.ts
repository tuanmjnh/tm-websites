import { getCatalogItem } from '#server/services/catalogService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')

  try {
    const item = await withPreparedDb(event, ({ CatalogItem }) => getCatalogItem(CatalogItem, siteId, id))
    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ event, data: item })
  } catch (error) {
    return translateContentError(error)
  }
})
