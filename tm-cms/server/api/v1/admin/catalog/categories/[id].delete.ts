import { deleteCatalogCategory } from '#server/services/catalogService'
import { CatalogDeleteQuerySchema, translateContentError, writeMetaOf } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { revalidateStorefrontForEvent, setRevalidateHeader } from '#server/utils/storefrontRevalidate'

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const query = parseInput(CatalogDeleteQuerySchema, getQuery(event), 'CATALOG_REVISION_REQUIRED', 'Thiếu phiên bản bản ghi')

  try {
    const result = await withPreparedDb(event, ({ CatalogCategory, CatalogItem, Audit, Revision }) =>
      deleteCatalogCategory(
        CatalogCategory,
        CatalogItem,
        siteId,
        id,
        query.revision,
        writeMetaOf(event, user, Audit, Revision),
      ))

    setHeader(event, 'cache-control', 'no-store')
    setRevalidateHeader(event, await revalidateStorefrontForEvent(event, 'catalog.category.delete'))
    return successResponse({ event, data: result, message: 'Đã xoá danh mục sản phẩm' })
  } catch (error) {
    return translateContentError(error)
  }
})
