import { restoreOrderReturn } from '#server/services/orderReturnService'
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

const OrderReturnRestoreQuerySchema = z.object({ revision: z.coerce.number().int().min(1) })

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const { revision } = parseInput(OrderReturnRestoreQuerySchema, getQuery(event), 'ORDER_RETURN_REVISION_REQUIRED', 'Thiếu phiên bản hiện tại')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ OrderReturn, Order, Audit, IdempotencyKey, Inventory, InventoryTransaction }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `order_return.restore:${id}`, key: idempotencyKey, payload: { revision } },
        async () => {
          const restored = await restoreOrderReturn(OrderReturn, Order, siteId, id, revision, {
            audit: auditMetaOf(event, user, Audit),
            stock: { inventory: Inventory, transactions: InventoryTransaction },
          })
          return {
            statusCode: 200,
            value: successResponse({ data: restored, message: 'Đã khôi phục phiếu trả hàng' }),
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
