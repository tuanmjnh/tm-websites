import { sendDelivery } from '#server/services/mailService'
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

const SendBodySchema = z.record(z.string(), z.unknown())

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(SendBodySchema, (await readBody(event)) ?? {}, 'MAIL_SEND_PAYLOAD_INVALID', 'Dữ liệu không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)
  const transport = resolveMailTransport()

  try {
    const executed = await withPreparedDb(event, ({ MailDelivery, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `mail_delivery.send:${id}`, key: idempotencyKey, payload: body },
        async () => {
          const delivery = await sendDelivery(MailDelivery, transport, siteId, id, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: 200,
            value: successResponse({
              data: delivery,
              message: delivery.status === 'sent' ? 'Đã gửi thư' : 'Gửi thất bại, thư được xếp gửi lại',
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
