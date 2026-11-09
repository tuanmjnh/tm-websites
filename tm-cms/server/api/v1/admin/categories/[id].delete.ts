import { deleteCategory } from '#server/services/categoryService'
import {
  CategoryDeleteQuerySchema,
  idempotencyKeyOf,
  translateContentError,
  writeMetaOf,
} from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

/**
 * Deletes a leaf category that no content uses. `?revision=` is the revision the
 * editor saw, so a stale tree tab cannot remove a category someone just moved.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const { revision } = parseInput(CategoryDeleteQuerySchema, getQuery(event), 'CATEGORY_REVISION_REQUIRED', 'Thiếu phiên bản hiện tại')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Category, Content, Audit, Revision, IdempotencyKey, Menu }) =>
      executeIdempotent(
        {
          model: IdempotencyKey,
          siteId,
          action: `category.delete:${id}`,
          key: idempotencyKey,
          payload: { revision },
        },
        async () => {
          const removed = await deleteCategory(Category, Content, siteId, id, revision, {
            ...writeMetaOf(event, user, Audit, Revision),
            menus: Menu,
          })
          return {
            statusCode: 200,
            value: successResponse({ data: removed, message: 'Đã xoá danh mục nội dung' }),
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
