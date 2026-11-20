import { financeAging } from '#server/services/financeReportService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = getQuery(event)
  const asOf = typeof query.asOf === 'string' && query.asOf ? query.asOf : new Date().toISOString().slice(0, 10)

  try {
    const aging = await withPreparedDb(event, ({ Payment, Order, PurchaseOrder }) =>
      financeAging({ Payment, Order, PurchaseOrder }, siteId, asOf))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: aging })
  } catch (error) {
    return translateContentError(error)
  }
})
