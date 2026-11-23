import { AdminDashboardSummarySchema } from '@tm/flow-contracts/dashboard-admin'
import { readDashboardSummary } from '#server/services/dashboardService'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/**
 * `GET /api/v1/admin/dashboard/summary` answers the dashboard's business counts
 * from this site's own collections. It reuses the content read capability, the
 * same guard the order, quotation and customer lists use.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const summary = await withPreparedDb(event, models => readDashboardSummary(models, siteId))

  setHeader(event, 'cache-control', 'no-store')

  return { success: true, data: AdminDashboardSummarySchema.parse(summary) }
})
