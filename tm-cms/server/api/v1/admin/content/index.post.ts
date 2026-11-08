import { createContent } from '#server/services/contentService'
import { ContentBodySchema, idempotencyKeyOf, translateContentError, writeMetaOf } from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(ContentBodySchema, await readBody(event), 'CONTENT_PAYLOAD_INVALID', 'Dữ liệu nội dung không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Content, Audit, Revision, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'content.create', key: idempotencyKey, payload: body },
        async () => {
          const created = await createContent(Content, siteId, body, writeMetaOf(event, user, Audit, Revision))
          return {
            statusCode: 201,
            value: successResponse({ data: created, message: 'Đã tạo bản ghi nội dung' }),
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
