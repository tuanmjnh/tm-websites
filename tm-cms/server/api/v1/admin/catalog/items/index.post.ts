import { createCatalogItem } from '#server/services/catalogService'
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

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(CatalogItemBodySchema, await readBody(event), 'CATALOG_PAYLOAD_INVALID', 'Dữ liệu sản phẩm không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ CatalogItem, CatalogCategory, Audit, Revision, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'catalog.item.create', key: idempotencyKey, payload: body },
        async () => {
          const created = await createCatalogItem(
            CatalogItem,
            CatalogCategory,
            siteId,
            body,
            writeMetaOf(event, user, Audit, Revision),
          )
          return {
            statusCode: 201,
            value: successResponse({ data: created, message: 'Đã tạo sản phẩm' }),
          }
        },
      ))

    setResponseStatus(event, executed.statusCode)
    setHeader(event, 'cache-control', 'no-store')
    if (executed.replayed) setHeader(event, 'idempotent-replay', 'true')

    return executed.value
  } catch (error) {
    return translateContentError(error)
  }
})
