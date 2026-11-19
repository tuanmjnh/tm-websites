import { createCustomerSegment } from '#server/services/customerSegmentService'
import {
  CustomerSegmentBodySchema,
  auditMetaOf,
  idempotencyKeyOf,
  translateContentError,
} from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(CustomerSegmentBodySchema, await readBody(event), 'CUSTOMER_SEGMENT_PAYLOAD_INVALID', 'Dữ liệu nhóm khách hàng không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ CustomerSegment, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'customer_segment.create', key: idempotencyKey, payload: body },
        async () => {
          const created = await createCustomerSegment(CustomerSegment, siteId, body, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: 201,
            value: successResponse({ data: created, message: 'Đã tạo nhóm khách hàng' }),
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
