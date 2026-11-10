import { listCatalogTags } from '#server/services/catalogService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)

  try {
    const tags = await withPreparedDb(event, ({ CatalogItem }) => listCatalogTags(CatalogItem, siteId))
    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ event, data: tags })
  } catch (error) {
    return translateContentError(error)
  }
})
