import { unreconcilePayment } from '#server/services/paymentService'
import {
  auditMetaOf,
  idempotencyKeyOf,
  translateContentError,
} from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Payment, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `payment.unreconcile:${id}`, key: idempotencyKey, payload: { id } },
        async () => {
          const payment = await unreconcilePayment(Payment, siteId, id, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: 200,
            value: successResponse({ data: payment, message: 'Đã bỏ đối soát thanh toán' }),
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
