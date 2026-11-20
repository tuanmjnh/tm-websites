import { listPushSubscriptions } from '#server/services/pushSubscriptionService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/** The signed-in person's own push endpoints; the recipient comes from the session. */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)

  const siteId = resolveSiteId(event)

  try {
    const rows = await withPreparedDb(event, ({ PushSubscription }) =>
      listPushSubscriptions(PushSubscription, siteId, user.id))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: rows })
  } catch (error) {
    return translateContentError(error)
  }
})
