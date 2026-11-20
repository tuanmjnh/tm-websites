import { subscribePushSubscription } from '#server/services/pushSubscriptionService'
import {
  auditMetaOf,
  translateContentError,
} from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const PushBodySchema = z.record(z.string(), z.unknown())

/**
 * Registers this browser's push endpoint for the signed-in person. The browser
 * supplies the subscription keys; the recipient is never taken from the body.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)

  const siteId = resolveSiteId(event)
  const body = parseInput(PushBodySchema, await readBody(event), 'PUSH_SUBSCRIPTION_PAYLOAD_INVALID', 'Dữ liệu đăng ký không hợp lệ')

  try {
    const subscription = await withPreparedDb(event, ({ PushSubscription, Audit }) =>
      subscribePushSubscription(PushSubscription, siteId, user.id, body, {
        audit: auditMetaOf(event, user, Audit),
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: subscription, message: 'Đã đăng ký nhận thông báo' })
  } catch (error) {
    return translateContentError(error)
  }
})
