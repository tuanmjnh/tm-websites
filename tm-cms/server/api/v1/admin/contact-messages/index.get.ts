import { listContactMessages } from '#server/services/contactMessageService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const ContactMessageListQuerySchema = z.object({
  status: z.enum(['new', 'read', 'replied', 'closed']).optional(),
  q: z.string().trim().max(120).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(ContactMessageListQuerySchema, getQuery(event), 'CONTACT_MESSAGE_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ ContactMessage }) =>
      listContactMessages(ContactMessage, siteId, {
        status: query.status,
        q: query.q,
        cursor: query.cursor,
        limit: query.limit,
        includeDeleted: query.includeDeleted === 'true',
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result.data, meta: { nextCursor: result.nextCursor ?? undefined, hasMore: result.hasMore, counts: result.counts } })
  } catch (error) {
    return translateContentError(error)
  }
})
