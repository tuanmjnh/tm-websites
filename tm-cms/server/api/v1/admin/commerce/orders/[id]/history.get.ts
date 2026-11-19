import { getOrder } from '#server/services/orderService'
import { listRecordAudit } from '#server/services/contentAudit'
import { ContentHistoryQuerySchema, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const { limit } = parseInput(ContentHistoryQuerySchema, getQuery(event), 'ORDER_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const entries = await withPreparedDb(event, async ({ Order, Audit }) => {
      await getOrder(Order, siteId, id)
      return listRecordAudit(Audit, siteId, { resourceType: 'order', resourceId: id, limit: limit ?? 20 })
    })

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: entries })
  } catch (error) {
    return translateContentError(error)
  }
})
