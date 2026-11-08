import { updateCategory } from '#server/services/categoryService'
import { CategoryBodySchema, idempotencyKeyOf, translateContentError, writeMetaOf } from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(CategoryBodySchema, await readBody(event), 'CATEGORY_PAYLOAD_INVALID', 'Dữ liệu danh mục không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Category, Audit, Revision, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `category.update:${id}`, key: idempotencyKey, payload: body },
        async () => {
          const updated = await updateCategory(Category, siteId, id, body, writeMetaOf(event, user, Audit, Revision))
          return {
            statusCode: 200,
            value: successResponse({ data: updated, message: 'Đã cập nhật danh mục nội dung' }),
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
