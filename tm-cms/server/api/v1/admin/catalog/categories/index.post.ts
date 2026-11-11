import { createCatalogCategory } from '#server/services/catalogService'
import {
  CatalogCategoryBodySchema,
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
  const body = parseInput(
    CatalogCategoryBodySchema,
    await readBody(event),
    'CATALOG_PAYLOAD_INVALID',
    'Dữ liệu danh mục sản phẩm không hợp lệ',
  )
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ CatalogCategory, Audit, Revision, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'catalog.category.create', key: idempotencyKey, payload: body },
        async () => {
          const created = await createCatalogCategory(
            CatalogCategory,
            siteId,
            body,
            writeMetaOf(event, user, Audit, Revision),
          )
          return {
            statusCode: 201,
            value: successResponse({ data: created, message: 'Đã tạo danh mục sản phẩm' }),
          }
        },
      ))

    setResponseStatus(event, executed.statusCode)
    setHeader(event, 'cache-control', 'no-store')
    if (executed.replayed) setHeader(event, 'idempotent-replay', 'true')

    if (!executed.replayed) {
      setRevalidateHeader(event, await revalidateStorefrontForEvent(event, 'catalog.category.create'))
    }
    return executed.value
  } catch (error) {
    return translateContentError(error)
  }
})
