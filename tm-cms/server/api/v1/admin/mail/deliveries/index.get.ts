import { listMailDeliveries } from '#server/services/mailService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const DeliveryListQuerySchema = z.object({
  status: z.enum(['queued', 'sending', 'sent', 'failed', 'cancelled']).optional(),
  templateCode: z.string().trim().max(64).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(DeliveryListQuerySchema, getQuery(event), 'MAIL_DELIVERY_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ MailDelivery }) =>
      listMailDeliveries(MailDelivery, siteId, {
        status: query.status,
        templateCode: query.templateCode,
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
          queued: result.counts.queued,
          sending: result.counts.sending,
          sent: result.counts.sent,
          failed: result.counts.failed,
          cancelled: result.counts.cancelled,
        },
      },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
