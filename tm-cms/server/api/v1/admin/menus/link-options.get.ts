import { listMenuLinkOptions } from '#server/services/menuService'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/**
 * `GET /api/v1/admin/menus/link-options` lists the pages and categories an item
 * can point at. The save path still validates the target, so this is an editor
 * convenience: a stale picker cannot store a key that does not resolve.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'configs.read')

  const siteId = resolveSiteId(event)
  const options = await withPreparedDb(event, ({ Content, Category }) =>
    listMenuLinkOptions({ content: Content, category: Category }, siteId))

  setHeader(event, 'cache-control', 'no-store')

  return { success: true, data: options }
})
