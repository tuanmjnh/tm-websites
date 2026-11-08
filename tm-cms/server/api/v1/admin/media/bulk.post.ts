import { AdminMediaBulkRequestSchema } from '@tm/flow-contracts/media-admin'
import { runBulkMediaCommand } from '#server/services/mediaService'
import { translateContentError, writeMetaOf } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

/**
 * `POST /api/v1/admin/media/bulk` moves or deletes up to 50 files and answers
 * `200` with one row per input file, so a file that is still attached to
 * content (or carries a stale revision) fails on its own row instead of
 * aborting the batch. No `Idempotency-Key`: each row is a guarded single-file
 * command, so a retry re-attempts only the rows that failed.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  const body = parseInput(
    AdminMediaBulkRequestSchema,
    await readBody(event),
    'MEDIA_BULK_INVALID',
    'Danh sách thao tác hàng loạt không hợp lệ',
  )
  requireCapabilities(user, body.action === 'delete' ? 'media.delete' : 'media.upload')

  const siteId = resolveSiteId(event)

  try {
    const origin = getRequestURL(event).origin
    const result = await withPreparedDb(event, ({ Media, Content, Audit, Revision }) =>
      runBulkMediaCommand(
        { media: Media, content: Content },
        siteId,
        origin,
        body,
        writeMetaOf(event, user, Audit, Revision).audit,
      ))

    setHeader(event, 'cache-control', 'no-store')

    return successResponse({
      event,
      data: result,
      message: result.failed
        ? `Đã xử lý ${result.succeeded}/${result.results.length} tệp`
        : `Đã xử lý ${result.succeeded} tệp`,
    })
  } catch (error) {
    return translateContentError(error)
  }
})
