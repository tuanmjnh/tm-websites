import { voidPayment } from '#server/services/paymentService'
import {
  auditMetaOf,
  idempotencyKeyOf,
  translateContentError,
} from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const PaymentVoidSchema = z.record(z.string(), z.unknown())

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(PaymentVoidSchema, await readBody(event), 'PAYMENT_VOID_INVALID', 'Dữ liệu huỷ thanh toán không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Payment, Order, PurchaseOrder, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `payment.void:${id}`, key: idempotencyKey, payload: body },
        async () => {
          const voided = await voidPayment(Payment, { order: Order, purchaseOrder: PurchaseOrder }, siteId, id, body, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: 200,
            value: successResponse({ data: voided, message: 'Đã huỷ thanh toán' }),
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
