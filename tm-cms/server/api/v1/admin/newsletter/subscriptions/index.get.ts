import { listNewsletterSubscriptions } from '#server/services/newsletterService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const NewsletterListQuerySchema = z.object({
  status: z.enum(['pending', 'confirmed', 'unsubscribed']).optional(),
  q: z.string().trim().max(120).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(NewsletterListQuerySchema, getQuery(event), 'NEWSLETTER_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ NewsletterSubscription }) =>
      listNewsletterSubscriptions(NewsletterSubscription, siteId, {
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
