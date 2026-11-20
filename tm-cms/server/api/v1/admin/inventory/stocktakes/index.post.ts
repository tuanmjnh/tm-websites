import { createStocktake } from '#server/services/stocktakeService'
import { auditMetaOf, idempotencyKeyOf, translateContentError } from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const StocktakeBodySchema = z.record(z.string(), z.unknown())

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(StocktakeBodySchema, await readBody(event), 'STOCKTAKE_PAYLOAD_INVALID', 'Dữ liệu kiểm kê không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Stocktake, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'stocktake.create', key: idempotencyKey, payload: body },
        async () => {
          const result = await createStocktake(Stocktake, siteId, body, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: result.created ? 201 : 200,
            value: successResponse({
              data: result.stocktake,
              message: result.created ? 'Đã tạo phiếu kiểm kê' : 'Đã khôi phục phiếu kiểm kê',
            }),
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
