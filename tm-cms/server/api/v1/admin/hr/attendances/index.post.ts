import { upsertAttendance } from '#server/services/attendanceService'
import { auditMetaOf, idempotencyKeyOf, translateContentError } from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const AttendanceBodySchema = z.record(z.string(), z.unknown())

/**
 * One day, one row: posting the same (staff, date) again is a correction, so the
 * response is 200 with the corrected row rather than a conflict.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(AttendanceBodySchema, await readBody(event), 'ATTENDANCE_PAYLOAD_INVALID', 'Dữ liệu chấm công không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Attendance, StaffProfile, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'attendance.upsert', key: idempotencyKey, payload: body },
        async () => {
          const result = await upsertAttendance(Attendance, StaffProfile, siteId, body, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: result.created ? 201 : 200,
            value: successResponse({
              data: result.attendance,
              message: result.created ? 'Đã ghi chấm công' : 'Đã sửa bản ghi chấm công',
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
