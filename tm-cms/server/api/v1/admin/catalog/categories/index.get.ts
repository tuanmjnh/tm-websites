import { listCatalogCategories } from '#server/services/catalogService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)

  try {
    const categories = await withPreparedDb(event, ({ CatalogCategory, CatalogItem }) =>
      listCatalogCategories(CatalogCategory, CatalogItem, siteId))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ event, data: categories })
  } catch (error) {
    return translateContentError(error)
  }
})
