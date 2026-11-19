import { listCustomers } from '#server/services/customerService'
import { CustomerListQuerySchema, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

/** Cursor page of customer profiles plus the counters the list header shows. */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(CustomerListQuerySchema, getQuery(event), 'CUSTOMER_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ Customer }) =>
      listCustomers(Customer, siteId, {
        q: query.q,
        segmentId: query.segment,
        includeDeleted: query.includeDeleted === 'true',
        cursor: query.cursor,
        limit: query.limit,
      }))

    setHeader(event, 'cache-control', 'no-store')

    return successResponse({
      data: result.data,
      meta: { nextCursor: result.nextCursor ?? undefined, hasMore: result.hasMore, counts: result.counts },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
