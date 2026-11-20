import { listInventoryTransfers } from '#server/services/inventoryTransferService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const TransferListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['draft', 'in_transit', 'received', 'cancelled']).optional(),
  warehouse: z.string().trim().max(64).optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(TransferListQuerySchema, getQuery(event), 'INVENTORY_TRANSFER_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ InventoryTransfer }) =>
      listInventoryTransfers(InventoryTransfer, siteId, {
        q: query.q,
        status: query.status,
        warehouseId: query.warehouse,
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
