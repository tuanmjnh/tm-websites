import { queueMail } from '#server/services/mailService'
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

const QueueBodySchema = z.record(z.string(), z.unknown())

/**
 * Queue a message. This never sends: a provider outage must not lose mail, and
 * the queue is drained separately once a provider is configured.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(QueueBodySchema, await readBody(event), 'MAIL_QUEUE_PAYLOAD_INVALID', 'Dữ liệu gửi thư không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ MailDelivery, MailTemplate, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'mail_delivery.queue', key: idempotencyKey, payload: body },
        async () => {
          const result = await queueMail(MailDelivery, MailTemplate, siteId, body, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: result.created ? 201 : 200,
            value: successResponse({
              data: result.delivery,
              message: result.created ? 'Đã đưa thư vào hàng đợi' : 'Thư này đã có trong hàng đợi',
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
