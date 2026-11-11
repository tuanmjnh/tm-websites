import { runCatalogItemEvent } from '#server/services/catalogService'
import { CatalogEventSchema, translateContentError, writeMetaOf } from '#server/utils/contentApi'
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
  const body = parseInput(CatalogEventSchema, await readBody(event), 'CATALOG_EVENT_INVALID', 'Sự kiện không hợp lệ')

  try {
    const updated = await withPreparedDb(event, ({ CatalogItem, Audit, Revision }) =>
      runCatalogItemEvent(
        CatalogItem,
        siteId,
        id,
        body,
        writeMetaOf(event, user, Audit, Revision),
      ))

    setHeader(event, 'cache-control', 'no-store')
    setRevalidateHeader(event, await revalidateStorefrontForEvent(event, `catalog.item.${body.event}`))
    return successResponse({ event, data: updated, message: 'Đã cập nhật trạng thái sản phẩm' })
  } catch (error) {
    return translateContentError(error)
  }
})
