import { financeSummary, resolveRange } from '#server/services/financeReportService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = getQuery(event)

  try {
    const range = resolveRange(query.from, query.to)
    const summary = await withPreparedDb(event, ({ Payment, Order, PurchaseOrder }) =>
      financeSummary({ Payment, Order, PurchaseOrder }, siteId, range))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: summary })
  } catch (error) {
    return translateContentError(error)
  }
})
