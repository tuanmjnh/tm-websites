import { softDeleteTask } from '#server/services/taskService'
import {
  auditMetaOf,
  idempotencyKeyOf,
  translateContentError,
} from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const RevisionQuerySchema = z.object({
  revision: z.coerce.number().int().min(1),
})

/** Hides a task; the row stays for audit and can be restored. */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const { revision } = parseInput(RevisionQuerySchema, getQuery(event), 'TASK_REVISION_REQUIRED', 'Thiếu phiên bản hiện tại')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Task, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `task.delete:${id}`, key: idempotencyKey, payload: { revision } },
        async () => {
          const removed = await softDeleteTask(Task, siteId, id, revision, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: 200,
            value: successResponse({ data: removed, message: 'Đã ẩn công việc' }),
          }
        },
      ))

    setResponseStatus(event, executed.statusCode)
    setHeader(event, 'cache-control', 'no-store')
    if (executed.replayed) setHeader(event, 'idempotent-replay', 'true')

    return executed.value
  } catch (error) {
    return translateContentError(error)
  }
})
