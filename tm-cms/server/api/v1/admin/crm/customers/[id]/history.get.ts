import { getCustomer } from '#server/services/customerService'
import { listRecordAudit } from '#server/services/contentAudit'
import { ContentHistoryQuerySchema, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

/**
 * Customer activity. The record is resolved first, so another site's id is a
 * 404 rather than an empty trail.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const { limit } = parseInput(ContentHistoryQuerySchema, getQuery(event), 'CUSTOMER_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const entries = await withPreparedDb(event, async ({ Customer, Audit }) => {
      await getCustomer(Customer, siteId, id)
      return listRecordAudit(Audit, siteId, { resourceType: 'customer', resourceId: id, limit })
    })

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: entries })
  } catch (error) {
    return translateContentError(error)
  }
})
