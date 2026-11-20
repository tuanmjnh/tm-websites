import { updateTask } from '#server/services/taskService'
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

const TaskBodySchema = z.record(z.string(), z.unknown())

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(TaskBodySchema, await readBody(event), 'TASK_PAYLOAD_INVALID', 'Dữ liệu công việc không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Task, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `task.update:${id}`, key: idempotencyKey, payload: body },
        async () => {
          const updated = await updateTask(Task, siteId, id, body, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: 200,
            value: successResponse({ data: updated, message: 'Đã cập nhật công việc' }),
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
