import { listCategoryMenuReferences } from '#server/services/categoryService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/**
 * `GET /api/v1/admin/categories/:id/menu-references` lists the menus that link
 * to this category, so the editor can warn before a delete is attempted.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')

  try {
    const menus = await withPreparedDb(event, ({ Category, Menu }) =>
      listCategoryMenuReferences(Category, Menu, siteId, id))

    setHeader(event, 'cache-control', 'no-store')

    return successResponse({ data: { menus } })
  } catch (error) {
    return translateContentError(error)
  }
})
