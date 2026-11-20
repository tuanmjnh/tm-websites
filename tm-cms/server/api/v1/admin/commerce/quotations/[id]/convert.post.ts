import { convertQuotationToOrder } from '#server/services/quotationService'
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

const ConvertBodySchema = z.object({ revision: z.number().int().min(1) })

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(ConvertBodySchema, await readBody(event).catch(() => ({})), 'QUOTATION_REVISION_REQUIRED', 'Thiếu phiên bản hiện tại')
  const revision = body.revision
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Quotation, Order, Customer, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `quotation.convert:${id}`, key: idempotencyKey, payload: { revision } },
        async () => {
          const result = await convertQuotationToOrder(Quotation, Order, Customer, siteId, id, revision, {
            audit: auditMetaOf(event, user, Audit),
            actorId: user.id,
          })
          return {
            statusCode: 200,
            value: successResponse({ data: result, message: 'Đã chuyển báo giá thành đơn hàng' }),
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
