import { softDeleteCustomerSegment } from '#server/services/customerSegmentService'
import {
  CustomerDeleteQuerySchema,
  auditMetaOf,
  idempotencyKeyOf,
  translateContentError,
} from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

/**
 * Soft-deletes a segment. `CUSTOMER_SEGMENT_IN_USE` is returned while customers
 * still belong to it, so the editor moves them instead of leaving orphans.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const { revision } = parseInput(CustomerDeleteQuerySchema, getQuery(event), 'CUSTOMER_SEGMENT_REVISION_REQUIRED', 'Thiếu phiên bản hiện tại')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ CustomerSegment, Customer, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `customer_segment.delete:${id}`, key: idempotencyKey, payload: { revision } },
        async () => {
          const removed = await softDeleteCustomerSegment(CustomerSegment, siteId, id, revision, {
            audit: auditMetaOf(event, user, Audit),
            customers: Customer,
          })
          return {
            statusCode: 200,
            value: successResponse({ data: removed, message: 'Đã ẩn nhóm khách hàng' }),
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
