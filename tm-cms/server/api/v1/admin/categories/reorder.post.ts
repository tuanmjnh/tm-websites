import { AdminCategoryReorderRequestSchema } from '@tm/flow-contracts/category-admin'
import { reorderCategory } from '#server/services/categoryService'
import { idempotencyKeyOf, translateContentError, writeMetaOf } from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

/**
 * Drag-and-drop move: `{ key, parent, index }` with the index among the target
 * parent's children. Returns the same flat list and tree the list endpoint does,
 * so the editor re-renders from one response instead of re-sorting locally.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(
    AdminCategoryReorderRequestSchema,
    await readBody(event),
    'CATEGORY_PAYLOAD_INVALID',
    'Dữ liệu danh mục không hợp lệ',
  )
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Category, Audit, Revision, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `category.reorder:${body.key}`, key: idempotencyKey, payload: body },
        async () => {
          const result = await reorderCategory(
            Category,
            siteId,
            body,
            writeMetaOf(event, user, Audit, Revision),
          )
          return {
            statusCode: 200,
            value: {
              success: true as const,
              data: result.data,
              tree: result.tree,
              message: 'Đã cập nhật vị trí danh mục',
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
