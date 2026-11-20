import { listTasks } from '#server/services/taskService'
import { TASK_STATUSES } from '#server/models/task'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const TaskQuerySchema = z.object({
  assigneeId: z.string().trim().max(128).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

/** Cursor page of the site's task records, optionally for one assignee. */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(TaskQuerySchema, getQuery(event), 'TASK_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ Task }) =>
      listTasks(Task, siteId, {
        assigneeId: query.assigneeId,
        status: query.status,
        includeDeleted: query.includeDeleted === 'true',
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
