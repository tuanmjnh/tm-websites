import { voidPayable } from '#server/services/payableService'
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

const PayableVoidSchema = z.object({
  reason: z.string().trim().min(1).max(500),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(PayableVoidSchema, await readBody(event), 'PAYABLE_VOID_INVALID', 'Dữ liệu huỷ công nợ không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Payable, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `payable.void:${id}`, key: idempotencyKey, payload: body },
        async () => {
          const voided = await voidPayable(Payable, siteId, id, body.reason, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: 200,
            value: successResponse({ data: voided, message: 'Đã huỷ công nợ' }),
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
