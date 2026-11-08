import { getContent } from '#server/services/contentService'
import { getContentRevision } from '#server/services/contentRevisions'
import { revisionParamOf, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/**
 * One snapshot plus the field-level difference to the current record. The diff is
 * computed server-side so the browser never has to compare raw payloads.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const revision = revisionParamOf(event)

  try {
    const detail = await withPreparedDb(event, async ({ Content, Revision }) => {
      const current = await getContent(Content, siteId, id)
      return getContentRevision(Revision, siteId, id, revision, current)
    })

    if (!detail) {
      return errorResponse(404, 'CONTENT_REVISION_NOT_FOUND', 'Content revision not found')
    }

    setHeader(event, 'cache-control', 'no-store')

    return successResponse({ data: detail })
  } catch (error) {
    return translateContentError(error)
  }
})
