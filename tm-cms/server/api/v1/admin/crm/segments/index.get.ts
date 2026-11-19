import { listCustomerSegments } from '#server/services/customerSegmentService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const includeDeleted = String(getQuery(event).includeDeleted || '') === 'true'

  try {
    const segments = await withPreparedDb(event, ({ CustomerSegment }) =>
      listCustomerSegments(CustomerSegment, siteId, includeDeleted))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: segments })
  } catch (error) {
    return translateContentError(error)
  }
})
