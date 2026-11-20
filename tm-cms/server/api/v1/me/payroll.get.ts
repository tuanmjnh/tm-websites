import { HrServiceError, getStaffBySubject } from '#server/services/staffService'
import { listPayrolls } from '#server/services/payrollService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const SelfPayrollQuerySchema = z.object({
  period: z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)

  const siteId = resolveSiteId(event)
  const query = parseInput(SelfPayrollQuerySchema, getQuery(event), 'PAYROLL_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, async ({ StaffProfile, Payroll }) => {
      const staff = await getStaffBySubject(StaffProfile, siteId, user.id)
      if (!staff) throw new HrServiceError(404, 'STAFF_NOT_FOUND', 'Không tìm thấy hồ sơ nhân sự')
      const payroll = await listPayrolls(Payroll, siteId, { staffId: staff.id, period: query.period ?? null })
      return { staff, payroll }
    })

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result })
  } catch (error) {
    return translateContentError(error)
  }
})
