import { deleteMenu } from '#server/services/menuService'
import {
  MenuDeleteQuerySchema,
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
 * Deletes a menu. `?revision=` is the revision the editor saw, so a stale tab
 * cannot remove a menu another admin just edited.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'configs.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const { revision } = parseInput(
    MenuDeleteQuerySchema,
    getQuery(event),
    'MENU_REVISION_REQUIRED',
    'Thiếu phiên bản hiện tại',
  )
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Menu, Audit, Revision, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `menu.delete:${id}`, key: idempotencyKey, payload: { revision } },
        async () => {
          const removed = await deleteMenu(Menu, siteId, id, revision, writeMetaOf(event, user, Audit, Revision))
          return {
            statusCode: 200,
            value: successResponse({ data: removed, message: 'Đã xoá menu' }),
          }
        },
      ))

    setResponseStatus(event, executed.statusCode)
    setHeader(event, 'cache-control', 'no-store')
    if (executed.replayed) setHeader(event, 'idempotent-replay', 'true')

    if (!executed.replayed) {
      setRevalidateHeader(event, await revalidateStorefrontForEvent(event, 'menu.delete'))
    }
    return executed.value
  } catch (error) {
    return translateContentError(error)
  }
})
