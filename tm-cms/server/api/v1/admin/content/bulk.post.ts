import { AdminContentBulkRequestSchema } from '@tm/flow-contracts/content-admin'
import { runBulkContentCommand } from '#server/services/contentBulk'
import { translateContentError, writeMetaOf } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

/**
 * `POST /api/v1/admin/content/bulk` runs publish/archive/delete over up to 50
 * records and answers `200` with one row per input item, so a partial failure is
 * visible per record instead of aborting the batch.
 *
 * No `Idempotency-Key` here: each row is a guarded state transition, so a retried
 * batch re-attempts only the rows that failed and cannot apply a change twice.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(
    AdminContentBulkRequestSchema,
    await readBody(event),
    'CONTENT_BULK_INVALID',
    'Danh sách thao tác hàng loạt không hợp lệ',
  )

  try {
    const result = await withPreparedDb(event, ({ Content, Audit, Revision }) =>
      runBulkContentCommand(Content, siteId, body, new Date(), writeMetaOf(event, user, Audit, Revision)))

    setResponseStatus(event, 200)
    setHeader(event, 'cache-control', 'no-store')

    return successResponse({
      data: result,
      message: result.failed
        ? `Đã xử lý ${result.succeeded}/${result.results.length} bản ghi`
        : `Đã xử lý ${result.succeeded} bản ghi`,
    })
  } catch (error) {
    return translateContentError(error)
  }
})
