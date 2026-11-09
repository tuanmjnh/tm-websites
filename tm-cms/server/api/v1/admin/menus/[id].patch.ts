import { updateMenu } from '#server/services/menuService'
import {
  MenuBodySchema,
  idempotencyKeyOf,
  translateContentError,
  writeMetaOf,
} from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

/**
 * `PATCH /api/v1/admin/menus/:id` saves the name and the whole item list against
 * the revision the editor loaded. A stale revision is `409`, an empty change is
 * `422`, and the save records one audit entry with the actor from the session.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'configs.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(MenuBodySchema, await readBody(event), 'MENU_PAYLOAD_INVALID', 'Dữ liệu menu không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Menu, Audit, Revision, IdempotencyKey, Content, Category }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `menu.update:${id}`, key: idempotencyKey, payload: body },
        async () => {
          const updated = await updateMenu(Menu, siteId, id, body, {
            ...writeMetaOf(event, user, Audit, Revision),
            refs: { content: Content, category: Category },
          })
          return {
            statusCode: 200,
            value: successResponse({ data: updated, message: 'Đã lưu menu' }),
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
