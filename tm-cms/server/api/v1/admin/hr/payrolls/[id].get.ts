import { getPayroll } from '#server/services/payrollService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')

  try {
    const payroll = await withPreparedDb(event, ({ Payroll }) => getPayroll(Payroll, siteId, id))
    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: payroll })
  } catch (error) {
    return translateContentError(error)
  }
})
