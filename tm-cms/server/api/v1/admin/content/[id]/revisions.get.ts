import { getContent } from '#server/services/contentService'
import { listContentRevisions } from '#server/services/contentRevisions'
import { ContentRevisionQuerySchema, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

/** Stored snapshots for one record, newest revision first. */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const { limit } = parseInput(ContentRevisionQuerySchema, getQuery(event), 'CONTENT_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const revisions = await withPreparedDb(event, async ({ Content, Revision }) => {
      // Resolve the record first so another site's id is a 404, not an empty list.
      await getContent(Content, siteId, id)
      return listContentRevisions(Revision, siteId, id, limit ?? 30)
    })

    setHeader(event, 'cache-control', 'no-store')

    return successResponse({ data: revisions })
  } catch (error) {
    return translateContentError(error)
  }
})
