import { listMenus } from '#server/services/menuService'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/**
 * `GET /api/v1/admin/menus` lists the site's menus with their revision and item
 * count; the editor fetches one menu in full when it opens it.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'configs.read')

  const siteId = resolveSiteId(event)
  const menus = await withPreparedDb(event, ({ Menu }) => listMenus(Menu, siteId))

  setHeader(event, 'cache-control', 'no-store')

  return { success: true, data: menus }
})
