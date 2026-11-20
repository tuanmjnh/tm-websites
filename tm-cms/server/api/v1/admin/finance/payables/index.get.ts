import { listPayables } from '#server/services/payableService'
import { PAYABLE_STATUSES } from '#server/models/payable'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const PayableQuerySchema = z.object({
  status: z.enum(PAYABLE_STATUSES).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

/** Cursor page of payables posted from received purchase orders. */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(PayableQuerySchema, getQuery(event), 'PAYABLE_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ Payable }) =>
      listPayables(Payable, siteId, {
        status: query.status,
        cursor: query.cursor,
        limit: query.limit,
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: result.data,
      meta: { nextCursor: result.nextCursor ?? undefined, hasMore: result.hasMore },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
