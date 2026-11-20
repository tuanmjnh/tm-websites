import { unsubscribePushSubscription } from '#server/services/pushSubscriptionService'
import {
  auditMetaOf,
  translateContentError,
} from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const UnsubscribeSchema = z.object({
  endpoint: z.string().trim().min(1).max(2048),
})

/** Removes one of the caller's own endpoints; someone else's is a no-op. */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)

  const siteId = resolveSiteId(event)
  const body = parseInput(UnsubscribeSchema, await readBody(event), 'PUSH_SUBSCRIPTION_ENDPOINT_REQUIRED', 'Thiếu địa chỉ đăng ký')

  try {
    const result = await withPreparedDb(event, ({ PushSubscription, Audit }) =>
      unsubscribePushSubscription(PushSubscription, siteId, user.id, body.endpoint, {
        audit: auditMetaOf(event, user, Audit),
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: result,
      message: result.removed ? 'Đã huỷ đăng ký nhận thông báo' : 'Không có đăng ký nào để huỷ',
    })
  } catch (error) {
    return translateContentError(error)
  }
})
