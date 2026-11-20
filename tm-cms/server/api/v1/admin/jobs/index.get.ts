import { listJobs } from '#server/services/jobService'
import { JOB_STATUSES } from '#server/models/job'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const JobQuerySchema = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  type: z.string().trim().max(64).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

/** Cursor page of the site's job queue. */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(JobQuerySchema, getQuery(event), 'JOB_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ Job }) =>
      listJobs(Job, siteId, {
        status: query.status,
        type: query.type,
        cursor: query.cursor,
        limit: query.limit,
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: result.data,
      meta: { nextCursor: result.nextCursor ?? undefined, hasMore: result.hasMore },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
