import { updateShiftTemplate } from '#server/services/shiftService'
import { auditMetaOf, idempotencyKeyOf, translateContentError } from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const ShiftTemplateBodySchema = z.record(z.string(), z.unknown())

/** Editing a template changes future assignments only; scheduled ones keep their snapshot. */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(ShiftTemplateBodySchema, await readBody(event), 'SHIFT_TEMPLATE_PAYLOAD_INVALID', 'Dữ liệu ca làm việc không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ ShiftTemplate, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `shift.template.update:${id}`, key: idempotencyKey, payload: body },
        async () => {
          const updated = await updateShiftTemplate(ShiftTemplate, siteId, id, body, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: 200,
            value: successResponse({ data: updated, message: 'Đã cập nhật ca làm việc' }),
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
