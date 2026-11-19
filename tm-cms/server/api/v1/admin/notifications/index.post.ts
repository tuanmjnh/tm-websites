import { dispatchNotification } from '#server/services/notificationService'
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

const DispatchSchema = z.record(z.string(), z.unknown())

/**
 * Send one notification to one Hub subject. The recipient is named here because
 * the sender is an operator acting on a business event, not the recipient; the
 * inbox routes below take the recipient from the session instead.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(DispatchSchema, await readBody(event), 'NOTIFICATION_PAYLOAD_INVALID', 'Dữ liệu thông báo không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Notification, NotificationSubscription, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'notification.dispatch', key: idempotencyKey, payload: body },
        async () => {
          const result = await dispatchNotification(Notification, NotificationSubscription, siteId, body, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: result.created ? 201 : 200,
            value: successResponse({
              data: {
                notification: result.notification,
                created: result.created,
                skipped: result.skipped,
              },
              message: result.skipped === 'muted'
                ? 'Người nhận đã tắt loại thông báo này'
                : result.created ? 'Đã gửi thông báo' : 'Thông báo đã tồn tại',
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
