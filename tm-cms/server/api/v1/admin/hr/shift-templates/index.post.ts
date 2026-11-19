import { createShiftTemplate } from '#server/services/shiftService'
import { auditMetaOf, idempotencyKeyOf, translateContentError } from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const ShiftTemplateBodySchema = z.record(z.string(), z.unknown())

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(ShiftTemplateBodySchema, await readBody(event), 'SHIFT_TEMPLATE_PAYLOAD_INVALID', 'Dữ liệu ca làm việc không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ ShiftTemplate, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'shift.template.create', key: idempotencyKey, payload: body },
        async () => {
          const result = await createShiftTemplate(ShiftTemplate, siteId, body, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: result.created ? 201 : 200,
            value: successResponse({
              data: result.template,
              message: result.created ? 'Đã tạo ca làm việc' : 'Đã khôi phục ca làm việc',
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
