import { listOrderReturns } from '#server/services/orderReturnService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const OrderReturnListQuerySchema = z.object({
  status: z.enum(['draft', 'approved', 'refunded', 'cancelled']).optional(),
  orderId: z.string().trim().max(64).optional(),
  q: z.string().trim().max(120).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(OrderReturnListQuerySchema, getQuery(event), 'ORDER_RETURN_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ OrderReturn }) =>
      listOrderReturns(OrderReturn, siteId, {
        status: query.status,
        orderId: query.orderId,
        q: query.q,
        cursor: query.cursor,
        limit: query.limit,
        includeDeleted: query.includeDeleted === 'true',
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result.data, meta: { nextCursor: result.nextCursor ?? undefined, hasMore: result.hasMore, counts: result.counts } })
  } catch (error) {
    return translateContentError(error)
  }
})
