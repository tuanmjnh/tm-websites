import { listNotifications } from '#server/services/notificationService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const InboxQuerySchema = z.object({
  status: z.enum(['unread', 'read', 'archived']).optional(),
  type: z.string().trim().max(64).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

/**
 * The signed-in person's own inbox. There is no recipient parameter: the subject
 * comes from the verified session, so one account cannot read another's mail by
 * editing a query string.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)

  const siteId = resolveSiteId(event)
  const query = parseInput(InboxQuerySchema, getQuery(event), 'NOTIFICATION_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ Notification }) =>
      listNotifications(Notification, siteId, user.id, {
        status: query.status,
        type: query.type,
        cursor: query.cursor,
        limit: query.limit,
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: result.data,
      meta: {
        nextCursor: result.nextCursor ?? undefined,
        hasMore: result.hasMore,
        counts: {
          all: result.counts.all,
          unread: result.counts.unread,
          read: result.counts.read,
          archived: result.counts.archived,
        },
      },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
