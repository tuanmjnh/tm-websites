import { getMenu } from '#server/services/menuService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/** `GET /api/v1/admin/menus/:id` returns one menu with its items. */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'configs.read')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')

  try {
    const menu = await withPreparedDb(event, ({ Menu }) => getMenu(Menu, siteId, id))
    setHeader(event, 'cache-control', 'no-store')
    return { success: true, data: menu }
  } catch (error) {
    return translateContentError(error)
  }
})
