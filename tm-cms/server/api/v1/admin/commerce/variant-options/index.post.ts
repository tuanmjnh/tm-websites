import { createVariantOption } from '#server/services/variantOptionService'
import { auditMetaOf, idempotencyKeyOf, translateContentError } from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const BodySchema = z.record(z.string(), z.unknown())

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(BodySchema, await readBody(event), 'VARIANT_OPTION_PAYLOAD_INVALID', 'Dữ liệu thuộc tính không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ VariantOption, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'variant-option.create', key: idempotencyKey, payload: body },
        async () => {
          const created = await createVariantOption(VariantOption, siteId, body, {
            audit: auditMetaOf(event, user, Audit),
            actorId: user.id,
          })
          return {
            statusCode: 201,
            value: successResponse({ data: created, message: 'Đã tạo thuộc tính' }),
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