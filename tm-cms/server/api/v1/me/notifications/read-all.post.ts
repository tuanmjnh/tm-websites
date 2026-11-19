import { markAllNotificationsRead } from '#server/services/notificationService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const ReadAllSchema = z.object({ type: z.string().trim().max(64).optional() })

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)

  const siteId = resolveSiteId(event)
  const body = parseInput(ReadAllSchema, (await readBody(event)) ?? {}, 'NOTIFICATION_READ_ALL_INVALID', 'Dữ liệu không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ Notification }) =>
      markAllNotificationsRead(Notification, siteId, user.id, { type: body.type }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result, message: `Đã đọc ${result.updated} thông báo` })
  } catch (error) {
    return translateContentError(error)
  }
})
