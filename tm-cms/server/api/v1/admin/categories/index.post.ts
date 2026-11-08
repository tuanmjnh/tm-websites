import { createCategory } from '#server/services/categoryService'
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
  const body = parseInput(CategoryBodySchema, await readBody(event), 'CATEGORY_PAYLOAD_INVALID', 'Dữ liệu danh mục không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Category, Audit, Revision, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'category.create', key: idempotencyKey, payload: body },
        async () => {
          const created = await createCategory(Category, siteId, body, writeMetaOf(event, user, Audit, Revision))
          return {
            statusCode: 201,
            value: successResponse({ data: created, message: 'Đã tạo danh mục nội dung' }),
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
