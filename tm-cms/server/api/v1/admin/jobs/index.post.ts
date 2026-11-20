import { enqueueJob } from '#server/services/jobService'
import {
  idempotencyKeyOf,
  translateContentError,
} from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const JobBodySchema = z.record(z.string(), z.unknown())

/**
 * Queues work for a worker to claim. Nothing runs this queue inside the CMS
 * request cycle: without a runner the job stays `queued` and is visible here.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(JobBodySchema, await readBody(event), 'JOB_PAYLOAD_INVALID', 'Dữ liệu công việc không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Job, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'job.enqueue', key: idempotencyKey, payload: body },
        async () => {
          const created = await enqueueJob(Job, siteId, body)
          return {
            statusCode: 201,
            value: successResponse({ data: created, message: 'Đã đưa vào hàng đợi' }),
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
