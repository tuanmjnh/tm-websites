import { HrServiceError, getStaffBySubject } from '#server/services/staffService'
import { listShiftAssignments } from '#server/services/shiftService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/**
 * A staff member's own roster.
 *
 * There is no `staffId` parameter on purpose: the profile comes from the verified
 * Hub subject, so this route cannot be pointed at a colleague. The range is
 * validated by the service (a month is fine; more than 62 days is refused).
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)

  const siteId = resolveSiteId(event)
  const query = getQuery(event)

  try {
    const result = await withPreparedDb(event, async ({ StaffProfile, ShiftAssignment }) => {
      const staff = await getStaffBySubject(StaffProfile, siteId, user.id)
      if (!staff) throw new HrServiceError(404, 'STAFF_NOT_FOUND', 'Không tìm thấy hồ sơ nhân sự')
      const roster = await listShiftAssignments({ ShiftAssignment, StaffProfile }, siteId, {
        staffId: staff.id,
        from: typeof query.from === 'string' && query.from ? query.from : undefined,
        to: typeof query.to === 'string' && query.to ? query.to : undefined,
      })
      return { staff, roster }
    })

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: { staff: result.staff, assignments: result.roster.data },
      meta: { totals: result.roster.summary },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
