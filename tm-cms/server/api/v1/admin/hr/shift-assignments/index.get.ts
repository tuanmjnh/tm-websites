import { listShiftAssignments } from '#server/services/shiftService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/**
 * The roster for a range, defaulting to today. At most 62 days per read: a
 * roster is planned week by week, and a year-long read is almost always a typo.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = getQuery(event)

  try {
    const result = await withPreparedDb(event, ({ ShiftAssignment, StaffProfile }) =>
      listShiftAssignments({ ShiftAssignment, StaffProfile }, siteId, {
        from: typeof query.from === 'string' && query.from ? query.from : undefined,
        to: typeof query.to === 'string' && query.to ? query.to : undefined,
        templateId: typeof query.templateId === 'string' && query.templateId ? query.templateId : undefined,
        staffId: typeof query.staffId === 'string' && query.staffId ? query.staffId : undefined,
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: result.data,
      meta: {
        totals: {
          assignments: result.summary.assignments,
          staff: result.summary.staff,
          days: result.summary.days,
          workedMinutes: result.summary.workedMinutes,
          daysInRange: Math.round(
            (new Date(`${result.range.to}T00:00:00Z`).getTime() - new Date(`${result.range.from}T00:00:00Z`).getTime()) / 86_400_000,
          ) + 1,
        },
      },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
