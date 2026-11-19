import { calculatePayroll } from '#server/services/payrollService'
import { auditMetaOf, idempotencyKeyOf, translateContentError } from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const CalculateBodySchema = z.record(z.string(), z.unknown())

/**
 * Recalculate a period from attendance and the salary config in force. Safe to
 * call again: a draft row is recomputed, an unchanged row is reported as
 * `unchanged`, an approved or paid row is reported as `locked` and never touched.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(CalculateBodySchema, await readBody(event), 'PAYROLL_PAYLOAD_INVALID', 'Dữ liệu bảng lương không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Payroll, Attendance, SalaryConfig, StaffProfile, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'payroll.calculate', key: idempotencyKey, payload: body },
        async () => {
          const result = await calculatePayroll(
            Payroll,
            { attendanceModel: Attendance, salaryModel: SalaryConfig, staffModel: StaffProfile, siteId },
            siteId,
            body,
            { audit: auditMetaOf(event, user, Audit) },
          )
          return {
            statusCode: 200,
            value: successResponse({
              data: result,
              message: `Đã tính lương kỳ ${result.period}: ${result.summary.created} mới, ${result.summary.updated} cập nhật`,
            }),
          }
        },
      ))

    setResponseStatus(event, executed.statusCode)
    setHeader(event, 'cache-control', 'no-store')
    if (executed.replayed) setHeader(event, 'idempotent-replay', 'true')

    return executed.value
  } catch (error) {
    return translateContentError(error)
  }
})
