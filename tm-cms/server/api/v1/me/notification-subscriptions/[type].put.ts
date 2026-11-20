import { setNotificationSubscription } from '#server/services/notificationService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const SubscriptionSchema = z.object({ enabled: z.boolean() })

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)

  const siteId = resolveSiteId(event)
  const type = String(getRouterParam(event, 'type') || '')
  const body = parseInput(SubscriptionSchema, await readBody(event), 'NOTIFICATION_SUBSCRIPTION_INVALID', 'Trạng thái đăng ký không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ NotificationSubscription }) =>
      setNotificationSubscription(NotificationSubscription, siteId, user.id, type, body.enabled))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: result,
      message: body.enabled ? 'Đã bật lại thông báo' : 'Đã tắt thông báo',
    })
  } catch (error) {
    return translateContentError(error)
  }
})
