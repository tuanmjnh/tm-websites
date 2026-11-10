import { AdminCatalogBulkByFilterPatchSchema } from '@tm/flow-contracts/catalog-admin'
import { bulkUpdateCatalogItemsByFilter } from '#server/services/catalogService'
import { translateContentError, writeMetaOf } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

/**
 * `POST /api/v1/admin/catalog/items/bulk-by-filter` applies a partial
 * price/stock patch to every live record matching the list filter the editor is
 * looking at, capped at 500 records. Per-row results are identical to the
 * explicit-selection route; a filter that matches nothing answers `404`, so a
 * typo cannot turn into a silent no-op.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(
    AdminCatalogBulkByFilterPatchSchema,
    await readBody(event),
    'CATALOG_BULK_INVALID',
    'Bộ lọc cập nhật hàng loạt không hợp lệ',
  )

  try {
    const result = await withPreparedDb(event, ({ CatalogItem, CatalogCategory, Audit, Revision }) =>
      bulkUpdateCatalogItemsByFilter(
        CatalogItem,
        CatalogCategory,
        siteId,
        body,
        writeMetaOf(event, user, Audit, Revision),
      ))

    setResponseStatus(event, 200)
    setHeader(event, 'cache-control', 'no-store')

    return successResponse({
      data: result,
      message: result.failed
        ? `Đã cập nhật ${result.succeeded}/${result.results.length} sản phẩm`
        : `Đã cập nhật ${result.succeeded} sản phẩm`,
    })
  } catch (error) {
    return translateContentError(error)
  }
})
