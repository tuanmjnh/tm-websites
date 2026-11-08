import { getCategory } from '#server/services/categoryService'
import { listRecordAudit } from '#server/services/contentAudit'
import { ContentHistoryQuerySchema, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

/**
 * Read-only activity trail for one category; newest first, capped.
 *
 * Categories keep no revision snapshots, so this list is their whole history.
 * The record is resolved first so another site's id is a 404, not an empty list.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const { limit } = parseInput(ContentHistoryQuerySchema, getQuery(event), 'CATEGORY_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const entries = await withPreparedDb(event, async ({ Category, Audit }) => {
      await getCategory(Category, siteId, id)
      return listRecordAudit(Audit, siteId, { resourceType: 'category', resourceId: id, limit })
    })

    setHeader(event, 'cache-control', 'no-store')

    return successResponse({ data: entries })
  } catch (error) {
    return translateContentError(error)
  }
})
