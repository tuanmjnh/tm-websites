import { listMailTemplates } from '#server/services/mailService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const TemplateListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  purpose: z.enum(['transactional', 'marketing']).optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(TemplateListQuerySchema, getQuery(event), 'MAIL_TEMPLATE_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ MailTemplate }) =>
      listMailTemplates(MailTemplate, siteId, {
        q: query.q,
        status: query.status,
        purpose: query.purpose,
        includeDeleted: query.includeDeleted === 'true',
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
          draft: result.counts.draft,
          active: result.counts.active,
          archived: result.counts.archived,
        },
      },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
