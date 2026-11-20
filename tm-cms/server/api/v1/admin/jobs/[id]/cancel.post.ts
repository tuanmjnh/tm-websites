import { cancelJob } from '#server/services/jobService'
import {
  idempotencyKeyOf,
  translateContentError,
} from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Job, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `job.cancel:${id}`, key: idempotencyKey, payload: { id } },
        async () => {
          const cancelled = await cancelJob(Job, siteId, id)
          return {
            statusCode: 200,
            value: successResponse({ data: cancelled, message: 'Đã huỷ công việc' }),
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
