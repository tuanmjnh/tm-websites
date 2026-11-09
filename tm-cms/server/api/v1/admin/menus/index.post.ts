import { createMenu } from '#server/services/menuService'
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
import { revalidateStorefrontForEvent, setRevalidateHeader } from '#server/utils/storefrontRevalidate'

/**
 * `POST /api/v1/admin/menus` creates an empty menu. The key is folded to a slug
 * by the service and cannot change afterwards, so links to a menu stay stable.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'configs.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(MenuBodySchema, await readBody(event), 'MENU_PAYLOAD_INVALID', 'Dữ liệu menu không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Menu, Audit, Revision, IdempotencyKey, Content, Category }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'menu.create', key: idempotencyKey, payload: body },
        async () => {
          const created = await createMenu(Menu, siteId, body, {
            ...writeMetaOf(event, user, Audit, Revision),
            refs: { content: Content, category: Category },
          })
          return {
            statusCode: 201,
            value: successResponse({ data: created, message: 'Đã tạo menu' }),
          }
        },
      ))

    setResponseStatus(event, executed.statusCode)
    setHeader(event, 'cache-control', 'no-store')
    if (executed.replayed) setHeader(event, 'idempotent-replay', 'true')

    if (!executed.replayed) {
      setRevalidateHeader(event, await revalidateStorefrontForEvent(event, 'menu.create'))
    }
    return executed.value
  } catch (error) {
    return translateContentError(error)
  }
})
