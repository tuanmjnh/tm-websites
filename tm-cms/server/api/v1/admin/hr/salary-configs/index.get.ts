import { listSalaryConfigs } from '#server/services/payrollService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/**
 * Compensation is gated by `content.write` rather than `content.read`: a
 * read-only contributor can manage staff and attendance without being able to
 * see anyone's salary. When Hub's capability vocabulary grows an explicit
 * `hr.compensation.read` replaces this.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const query = getQuery(event)
  const staffId = typeof query.staffId === 'string' ? query.staffId : ''
  if (!staffId) {
    return errorResponse(422, 'SALARY_STAFF_REQUIRED', 'Cần chọn nhân sự')
  }

  try {
    const configs = await withPreparedDb(event, ({ SalaryConfig }) =>
      listSalaryConfigs(SalaryConfig, siteId, staffId))
    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: configs })
  } catch (error) {
    return translateContentError(error)
  }
})
