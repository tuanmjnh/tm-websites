import { listTags } from '#server/services/tagService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/** Tags in use on this site, most used first, with their record counts. */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)

  try {
    const tags = await withPreparedDb(event, ({ Content }) => listTags(Content, siteId))

    setHeader(event, 'cache-control', 'no-store')

    return { success: true as const, data: tags }
  } catch (error) {
    return translateContentError(error)
  }
})
