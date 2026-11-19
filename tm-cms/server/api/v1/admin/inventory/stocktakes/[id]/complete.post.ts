import { completeStocktake } from '#server/services/stocktakeService'
import { auditMetaOf, idempotencyKeyOf, translateContentError } from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const CompleteBodySchema = z.record(z.string(), z.unknown())

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(CompleteBodySchema, await readBody(event), 'STOCKTAKE_PAYLOAD_INVALID', 'Dữ liệu kiểm kê không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Stocktake, Inventory, InventoryTransaction, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `stocktake.complete:${id}`, key: idempotencyKey, payload: body },
        async () => {
          const completed = await completeStocktake(Stocktake, Inventory, InventoryTransaction, siteId, id, body, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: 200,
            value: successResponse({ data: completed, message: 'Đã hoàn tất kiểm kê' }),
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
