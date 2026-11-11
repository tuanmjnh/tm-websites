import { updateCatalogItem } from '#server/services/catalogService'
import {
  CatalogItemBodySchema,
  idempotencyKeyOf,
  translateContentError,
  writeMetaOf,
} from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
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
  const body = parseInput(CatalogItemBodySchema, await readBody(event), 'CATALOG_PAYLOAD_INVALID', 'Dữ liệu sản phẩm không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ CatalogItem, CatalogCategory, Audit, Revision, IdempotencyKey }) =>
      executeIdempotent(
        {
          model: IdempotencyKey,
          siteId,
          action: `catalog.item.update:${id}`,
          key: idempotencyKey,
          payload: body,
        },
        async () => {
          const updated = await updateCatalogItem(
            CatalogItem,
            CatalogCategory,
            siteId,
            id,
            body,
            writeMetaOf(event, user, Audit, Revision),
          )
          return {
            statusCode: 200,
            value: successResponse({ data: updated, message: 'Đã cập nhật sản phẩm' }),
          }
        },
      ))

    setResponseStatus(event, executed.statusCode)
    setHeader(event, 'cache-control', 'no-store')
    if (executed.replayed) setHeader(event, 'idempotent-replay', 'true')

    if (!executed.replayed) {
      setRevalidateHeader(event, await revalidateStorefrontForEvent(event, 'catalog.item.update'))
    }
    return executed.value
  } catch (error) {
    return translateContentError(error)
  }
})
