import { exportPayrollsCsv } from '#server/services/payrollService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import type { PayrollStatus } from '#server/models/payroll'

/**
 * Payroll is the most sensitive HR export: it leaves the system with people's
 * pay, so it takes `content.write` on top of read like the attendance and finance
 * exports, and `no-store` keeps a period out of any shared cache.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read', 'content.write')

  const siteId = resolveSiteId(event)
  const query = getQuery(event)

  try {
    const exported = await withPreparedDb(event, ({ Payroll }) =>
      exportPayrollsCsv(Payroll, siteId, {
        period: typeof query.period === 'string' ? query.period : null,
        staffId: typeof query.staffId === 'string' ? query.staffId : null,
        status: typeof query.status === 'string' ? query.status as PayrollStatus : null,
      }))

    const period = typeof query.period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.period) ? query.period : 'tat-ca'
    setHeader(event, 'content-type', 'text/csv; charset=utf-8')
    setHeader(event, 'content-disposition', `attachment; filename="bang-luong-${period}.csv"`)
    setHeader(event, 'cache-control', 'no-store')
    setHeader(event, 'x-export-rows', String(exported.rows))
    if (exported.truncated) setHeader(event, 'x-export-truncated', 'true')

    // The BOM keeps Vietnamese diacritics readable when the file is opened in Excel.
    return `\uFEFF${exported.csv}`
  } catch (error) {
    return translateContentError(error)
  }
})
