import { listNotificationSubscriptions } from '#server/services/notificationService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/**
 * What this person muted. Absence means subscribed, so the client only has to
 * know the types it renders.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)

  const siteId = resolveSiteId(event)

  try {
    const result = await withPreparedDb(event, ({ NotificationSubscription }) =>
      listNotificationSubscriptions(NotificationSubscription, siteId, user.id))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result })
  } catch (error) {
    return translateContentError(error)
  }
})
