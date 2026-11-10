import { renameTag } from '#server/services/tagService'
import {
  AdminTagRenameRequestSchema,
  idempotencyKeyOf,
  translateContentError,
  writeMetaOf,
} from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

/**
 * Rewrites one tag across every content record. Retrying the same request is
 * safe: the second run finds nothing left to rename, so it reports 0 updates.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(
    AdminTagRenameRequestSchema,
    await readBody(event),
    'TAG_PAYLOAD_INVALID',
    'Dữ liệu thẻ không hợp lệ',
  )
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Content, Audit, Revision, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'tag.rename', key: idempotencyKey, payload: body },
        async () => {
          const result = await renameTag(Content, siteId, body, writeMetaOf(event, user, Audit, Revision))
          return {
            statusCode: 200,
            value: {
              success: true as const,
              data: result,
              message: body.to === null ? 'Đã gỡ thẻ khỏi nội dung' : 'Đã đổi tên thẻ',
            },
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
