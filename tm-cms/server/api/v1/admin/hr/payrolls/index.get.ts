import { listPayrolls } from '#server/services/payrollService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import type { PayrollStatus } from '#server/models/payroll'

/** Payroll carries amounts, so it is gated like compensation (see salary-configs). */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const query = getQuery(event)

  try {
    const result = await withPreparedDb(event, ({ Payroll }) =>
      listPayrolls(Payroll, siteId, {
        period: typeof query.period === 'string' ? query.period : null,
        staffId: typeof query.staffId === 'string' ? query.staffId : null,
        status: typeof query.status === 'string' ? query.status as PayrollStatus : null,
        limit: typeof query.limit === 'string' ? Number(query.limit) : undefined,
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result.data, meta: { counts: result.counts, totals: result.totals } })
  } catch (error) {
    return translateContentError(error)
  }
})
