import { updateOrderReturn } from '#server/services/orderReturnService'
import {
  auditMetaOf,
  translateContentError,
} from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const OrderReturnUpdateBodySchema = z.object({
  status: z.enum(['draft', 'approved', 'refunded', 'cancelled']).optional(),
  note: z.string().trim().max(2000).optional(),
  refundAmount: z.coerce.number().nonnegative().optional(),
  refundMethod: z.enum(['cash', 'card', 'bank', 'credit']).optional(),
  revision: z.coerce.number().int().min(1),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = await readBody(event)
  const input = parseInput(OrderReturnUpdateBodySchema, body, 'ORDER_RETURN_UPDATE_INVALID', 'Dữ liệu cập nhật không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ OrderReturn, Order, Audit }) =>
      updateOrderReturn(OrderReturn, Order, siteId, id, input, {
        audit: auditMetaOf(event, user, Audit),
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result, message: 'Đã cập nhật phiếu trả hàng' })
  } catch (error) {
    return translateContentError(error)
  }
})
