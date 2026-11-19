import { createPurchaseOrder } from '#server/services/purchaseOrderService'
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

const PurchaseOrderBodySchema = z.record(z.string(), z.unknown())

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(PurchaseOrderBodySchema, await readBody(event), 'PURCHASE_ORDER_PAYLOAD_INVALID', 'Dữ liệu đơn mua không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ PurchaseOrder, Supplier, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'purchase_order.create', key: idempotencyKey, payload: body },
        async () => {
          const created = await createPurchaseOrder(PurchaseOrder, Supplier, siteId, body, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: 201,
            value: successResponse({ data: created, message: 'Đã tạo đơn mua' }),
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
