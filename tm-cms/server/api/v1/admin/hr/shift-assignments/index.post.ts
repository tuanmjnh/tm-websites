import { assignShift } from '#server/services/shiftService'
import { auditMetaOf, idempotencyKeyOf, translateContentError } from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const ShiftAssignmentBodySchema = z.record(z.string(), z.unknown())

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(
    ShiftAssignmentBodySchema,
    await readBody(event),
    'SHIFT_ASSIGNMENT_PAYLOAD_INVALID',
    'Dữ liệu phân ca không hợp lệ',
  )
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ ShiftTemplate, ShiftAssignment, StaffProfile, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'shift.assignment.create', key: idempotencyKey, payload: body },
        async () => {
          const result = await assignShift(
            { ShiftTemplate, ShiftAssignment, StaffProfile },
            siteId,
            body,
            {},
            { audit: auditMetaOf(event, user, Audit) },
          )
          return {
            statusCode: 201,
            value: successResponse({ data: result.assignment, message: 'Đã phân ca' }),
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
