import { HrServiceError, getStaffBySubject } from '#server/services/staffService'
import { listAttendances } from '#server/services/attendanceService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const SelfAttendanceQuerySchema = z.object({
  month: z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)

  const siteId = resolveSiteId(event)
  const query = parseInput(SelfAttendanceQuerySchema, getQuery(event), 'ATTENDANCE_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, async ({ StaffProfile, Attendance }) => {
      const staff = await getStaffBySubject(StaffProfile, siteId, user.id)
      if (!staff) throw new HrServiceError(404, 'STAFF_NOT_FOUND', 'Không tìm thấy hồ sơ nhân sự')
      const attendance = await listAttendances(Attendance, siteId, { staffId: staff.id, month: query.month ?? null })
      return { staff, attendance }
    })

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result })
  } catch (error) {
    return translateContentError(error)
  }
})
