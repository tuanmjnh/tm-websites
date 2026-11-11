import { AdminCatalogBulkPatchSchema } from '@tm/flow-contracts/catalog-admin'
import { bulkUpdateCatalogItems } from '#server/services/catalogService'
import { translateContentError, writeMetaOf } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { revalidateStorefrontForEvent, setRevalidateHeader } from '#server/utils/storefrontRevalidate'

/**
 * `POST /api/v1/admin/catalog/items/bulk` applies a partial price/stock patch to
 * up to 100 records and answers `200` with one row per input item. A stale row
 * fails alone, and no `Idempotency-Key` is needed: a row that already has the
 * requested value is answered without bumping its revision.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(
    AdminCatalogBulkPatchSchema,
    await readBody(event),
    'CATALOG_BULK_INVALID',
    'Danh sách cập nhật hàng loạt không hợp lệ',
  )

  try {
    const result = await withPreparedDb(event, ({ CatalogItem, Audit, Revision }) =>
      bulkUpdateCatalogItems(CatalogItem, siteId, body, writeMetaOf(event, user, Audit, Revision)))

    setResponseStatus(event, 200)
    setHeader(event, 'cache-control', 'no-store')
    if (result.succeeded) {
      setRevalidateHeader(event, await revalidateStorefrontForEvent(event, 'catalog.item.bulk'))
    }

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
