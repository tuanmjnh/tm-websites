import { getContent } from '#server/services/contentService'
import { listContentAudit } from '#server/services/contentAudit'
import { ContentHistoryQuerySchema, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

/** Read-only activity trail for one record; newest first, capped. */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const { limit } = parseInput(ContentHistoryQuerySchema, getQuery(event), 'CONTENT_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const entries = await withPreparedDb(event, async ({ Content, Audit }) => {
      // Resolve the record first so another site's id is a 404, not an empty list.
      await getContent(Content, siteId, id)
      return listContentAudit(Audit, siteId, id, limit ?? 20)
    })

    setHeader(event, 'cache-control', 'no-store')

    return successResponse({ data: entries })
  } catch (error) {
    return translateContentError(error)
  }
})
