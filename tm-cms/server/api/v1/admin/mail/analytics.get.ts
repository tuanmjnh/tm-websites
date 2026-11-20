import { mailDeliveryAnalytics } from '#server/services/mailAnalyticsService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = getQuery(event)

  try {
    const analytics = await withPreparedDb(event, ({ MailDelivery }) =>
      mailDeliveryAnalytics(MailDelivery, siteId, { from: query.from, to: query.to }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: analytics })
  } catch (error) {
    return translateContentError(error)
  }
})
