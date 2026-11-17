import { updateContent } from '#server/services/contentService'
import { ContentBodySchema, idempotencyKeyOf, translateContentError, writeMetaOf } from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { revalidateStorefrontForEvent, setRevalidateHeader } from '#server/utils/storefrontRevalidate'
import { parseInput } from '#server/utils/validation'

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(ContentBodySchema, await readBody(event), 'CONTENT_PAYLOAD_INVALID', 'Dữ liệu nội dung không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Content, Audit, Revision, IdempotencyKey, Redirect }) =>
      executeIdempotent(
        {
          model: IdempotencyKey,
          siteId,
          action: `content.update:${id}`,
          key: idempotencyKey,
          payload: body,
        },
        async () => {
          const updated = await updateContent(Content, siteId, id, body, {
            ...writeMetaOf(event, user, Audit, Revision),
            redirects: Redirect,
          })
          return {
            statusCode: 200,
            value: successResponse({ data: updated, message: 'Đã cập nhật bản ghi nội dung' }),
          }
        },
      ))

    setResponseStatus(event, executed.statusCode)
    setHeader(event, 'cache-control', 'no-store')
    if (executed.replayed) setHeader(event, 'idempotent-replay', 'true')
    if (!executed.replayed) {
      setRevalidateHeader(event, await revalidateStorefrontForEvent(event, 'content.update'))
    }

    return executed.value
  } catch (error) {
    return translateContentError(error)
  }
})
