import { listOrdersForSubject } from '#server/services/customerPortalService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const PortalOrderQuerySchema = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

/**
 * The signed-in person's own orders. The Hub subject resolves to exactly one
 * customer in this site, so an account cannot page through someone else's
 * history by changing a parameter.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)

  const siteId = resolveSiteId(event)
  const query = parseInput(PortalOrderQuerySchema, getQuery(event), 'PORTAL_ORDER_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ Order, Customer }) =>
      listOrdersForSubject(Order, Customer, siteId, user.id, {
        cursor: query.cursor,
        limit: query.limit,
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: result.data,
      meta: {
        customerId: result.customerId,
        nextCursor: result.nextCursor ?? undefined,
        hasMore: result.hasMore,
      },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
