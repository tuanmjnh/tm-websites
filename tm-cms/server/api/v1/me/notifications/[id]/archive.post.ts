import { archiveNotification } from '#server/services/notificationService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')

  try {
    const result = await withPreparedDb(event, ({ Notification }) => archiveNotification(Notification, siteId, user.id, id))
    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result, message: 'Đã lưu trữ thông báo' })
  } catch (error) {
    return translateContentError(error)
  }
})
