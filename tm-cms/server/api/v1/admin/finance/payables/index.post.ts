import { postPayableForPurchaseOrder } from '#server/services/payableService'
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

const PayableBodySchema = z.object({
  purchaseOrderId: z.string().trim().min(1).max(64),
})

/**
 * Posts the payable for a received purchase order. Receiving a PO already posts
 * one automatically; this route covers a receipt that predates that wiring and
 * is idempotent per purchase order.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(PayableBodySchema, await readBody(event), 'PAYABLE_PAYLOAD_INVALID', 'Dữ liệu công nợ không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Payable, PurchaseOrder, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'payable.post', key: idempotencyKey, payload: body },
        async () => {
          const posted = await postPayableForPurchaseOrder(Payable, PurchaseOrder, siteId, body.purchaseOrderId, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: 201,
            value: successResponse({ data: posted, message: 'Đã ghi nhận công nợ' }),
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
