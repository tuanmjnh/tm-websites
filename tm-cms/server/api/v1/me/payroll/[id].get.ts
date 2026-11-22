import { getOwnPayroll } from '#server/services/payrollService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/**
 * One payroll row for the signed-in staff member — what the payslip page prints.
 *
 * There is no `staffId` parameter: the profile is resolved from the verified Hub
 * subject, so the id in the path can only ever address the caller's own row. A
 * colleague's id answers `PAYROLL_NOT_FOUND` (not `forbidden`), which keeps the
 * existence of other people's payroll out of the response.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)

  const siteId = resolveSiteId(event)
  const id = getRouterParam(event, 'id') ?? ''

  try {
    const result = await withPreparedDb(event, ({ Payroll, StaffProfile }) =>
      getOwnPayroll(Payroll, StaffProfile, siteId, user.id, id))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result })
  } catch (error) {
    return translateContentError(error)
  }
})
