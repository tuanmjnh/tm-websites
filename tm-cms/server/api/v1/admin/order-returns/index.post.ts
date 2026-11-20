import { createOrderReturn } from '#server/services/orderReturnService'
import {
  auditMetaOf,
  translateContentError,
} from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const OrderReturnItemBodySchema = z.object({
  itemId: z.string().trim().max(64).nullable().optional(),
  variantId: z.string().trim().max(64).nullable().optional(),
  itemName: z.string().trim().min(1).max(300),
  sku: z.string().trim().max(120).optional(),
  quantity: z.coerce.number().int().min(1).max(999999),
  unitPrice: z.coerce.number().nonnegative().optional(),
  reason: z.string().trim().max(500).optional(),
})

const OrderReturnCreateBodySchema = z.object({
  code: z.string().trim().max(32),
  orderId: z.string().trim().min(1).max(64),
  status: z.enum(['draft', 'approved', 'refunded', 'cancelled']).optional(),
  items: z.array(OrderReturnItemBodySchema).min(1).max(200),
  refundAmount: z.coerce.number().nonnegative().optional(),
  refundMethod: z.enum(['cash', 'card', 'bank', 'credit']).optional(),
  note: z.string().trim().max(2000).optional(),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = await readBody(event)
  const input = parseInput(OrderReturnCreateBodySchema, body, 'ORDER_RETURN_PAYLOAD_INVALID', 'Dữ liệu trả hàng không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ OrderReturn, Order, Audit }) =>
      createOrderReturn(OrderReturn, Order, siteId, input, {
        audit: auditMetaOf(event, user, Audit),
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result, message: 'Đã tạo phiếu trả hàng' })
  } catch (error) {
    return translateContentError(error)
  }
})
