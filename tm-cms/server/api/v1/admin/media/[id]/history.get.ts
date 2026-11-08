import { getMedia } from '#server/services/mediaService'
import { listRecordAudit } from '#server/services/contentAudit'
import { ContentHistoryQuerySchema, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

/**
 * Read-only activity trail for one media record; newest first, capped.
 *
 * A file's history has no revision snapshots either — upload, metadata edits and
 * the delete entry are what an operator sees. Resolving the record first keeps
 * another site's id a 404 instead of an empty list.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'media.read')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const { limit } = parseInput(ContentHistoryQuerySchema, getQuery(event), 'MEDIA_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const origin = getRequestURL(event).origin
    const entries = await withPreparedDb(event, async ({ Media, Audit }) => {
      await getMedia(Media, siteId, origin, id)
      return listRecordAudit(Audit, siteId, { resourceType: 'media', resourceId: id, limit })
    })

    setHeader(event, 'cache-control', 'no-store')

    return successResponse({ data: entries })
  } catch (error) {
    return translateContentError(error)
  }
})
