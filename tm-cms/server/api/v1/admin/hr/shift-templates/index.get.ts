import { listShiftTemplates } from '#server/services/shiftService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = getQuery(event)

  try {
    const result = await withPreparedDb(event, ({ ShiftTemplate }) =>
      listShiftTemplates(ShiftTemplate, siteId, { includeInactive: query.includeInactive === 'true' }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: result.data,
      meta: { counts: result.summary, total: result.data.length },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
