import { listContentMenuReferences } from '#server/services/contentService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/**
 * `GET /api/v1/admin/content/:id/menu-references` lists the menus that link to
 * this page, so the editor can warn before a delete is attempted instead of
 * explaining the refusal afterwards.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')

  try {
    const menus = await withPreparedDb(event, ({ Content, Menu }) =>
      listContentMenuReferences(Content, Menu, siteId, id))

    setHeader(event, 'cache-control', 'no-store')

    return successResponse({ data: { menus } })
  } catch (error) {
    return translateContentError(error)
  }
})
