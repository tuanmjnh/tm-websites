import { listCategories } from '#server/services/categoryService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/** Flat list plus the ordered tree the editor renders. */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)

  try {
    const result = await withPreparedDb(event, ({ Category }) => listCategories(Category, siteId))

    setHeader(event, 'cache-control', 'no-store')

    // The category list ships the flat rows and the ordered tree together so the
    // editor never renders a second, differently sorted tree.
    return {
      success: true as const,
      data: result.data,
      tree: result.tree,
    }
  } catch (error) {
    return translateContentError(error)
  }
})
