import { importCatalogItems } from '#server/services/catalogService'
import { auditMetaOf, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { revalidateStorefrontForEvent, setRevalidateHeader } from '#server/utils/storefrontRevalidate'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

/**
 * `POST /api/v1/admin/catalog/items/import` upserts up to 500 catalog rows by
 * `key` and answers with one result per row, so one bad row does not discard the
 * rest. A row that matches an existing key updates it (and bumps its revision);
 * a new key is created as a draft, like the create route.
 */
const CatalogImportBodySchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const input = parseInput(CatalogImportBodySchema, await readBody(event), 'CATALOG_IMPORT_INVALID', 'Dữ liệu nhập không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ CatalogItem, CatalogCategory, Audit }) =>
      importCatalogItems(CatalogItem, CatalogCategory, siteId, input.rows, {
        audit: auditMetaOf(event, user, Audit),
      }))

    setHeader(event, 'cache-control', 'no-store')
    if (result.created + result.updated > 0) {
      setRevalidateHeader(event, await revalidateStorefrontForEvent(event, 'catalog.item.import'))
    }

    return successResponse({
      data: result,
      message: `Đã nhập ${result.created} mới, ${result.updated} cập nhật, ${result.failed} lỗi`,
    })
  } catch (error) {
    return translateContentError(error)
  }
})
