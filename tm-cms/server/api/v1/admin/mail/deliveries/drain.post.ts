import { drainMailQueue } from '#server/services/mailService'
import { resolveMailTransport } from '#server/services/mailTransport'
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

const DrainBodySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).optional(),
})

/**
 * Deliver what is due, at most 25 messages per call. There is no scheduler in the
 * CMS, so an operator or an external cron calls this and reads the counts.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(DrainBodySchema, (await readBody(event)) ?? {}, 'MAIL_DRAIN_PAYLOAD_INVALID', 'Dữ liệu không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)
  const transport = resolveMailTransport()

  try {
    const executed = await withPreparedDb(event, ({ MailDelivery, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'mail_delivery.drain', key: idempotencyKey, payload: body },
        async () => {
          const result = await drainMailQueue(MailDelivery, transport, siteId, { limit: body.limit }, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: 200,
            value: successResponse({
              data: result,
              message: `Đã xử lý ${result.processed} thư (${result.sent} gửi, ${result.failed} lỗi)`,
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
