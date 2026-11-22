import { exportAttendancesCsv } from '#server/services/attendanceService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import type { AttendanceStatus } from '#server/models/attendance'

/**
 * The attendance sheet leaves the system, so it takes `content.write` on top of
 * read like the other exports. It answers the query, not the page the operator
 * had loaded: the file is for payroll, and a truncated list would look complete.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read', 'content.write')

  const siteId = resolveSiteId(event)
  const query = getQuery(event)

  try {
    const exported = await withPreparedDb(event, ({ Attendance, StaffProfile }) =>
      exportAttendancesCsv(Attendance, StaffProfile, siteId, {
        month: typeof query.month === 'string' ? query.month : null,
        staffId: typeof query.staffId === 'string' ? query.staffId : null,
        status: typeof query.status === 'string' ? query.status as AttendanceStatus : null,
      }))

    const month = typeof query.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) ? query.month : 'tat-ca'
    setHeader(event, 'content-type', 'text/csv; charset=utf-8')
    setHeader(event, 'content-disposition', `attachment; filename="cham-cong-${month}.csv"`)
    setHeader(event, 'cache-control', 'no-store')
    setHeader(event, 'x-export-rows', String(exported.rows))
    if (exported.truncated) setHeader(event, 'x-export-truncated', 'true')

    // The BOM keeps Vietnamese diacritics readable when the file is opened in Excel.
    return `\uFEFF${exported.csv}`
  } catch (error) {
    return translateContentError(error)
  }
})
