import { createInventoryTransfer } from '#server/services/inventoryTransferService'
import {
  auditMetaOf,
  idempotencyKeyOf,
  translateContentError,
} from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const TransferBodySchema = z.record(z.string(), z.unknown())

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(TransferBodySchema, await readBody(event), 'INVENTORY_TRANSFER_PAYLOAD_INVALID', 'Dữ liệu chuyển kho không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ InventoryTransfer, Warehouse, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'inventory_transfer.create', key: idempotencyKey, payload: body },
        async () => {
          const created = await createInventoryTransfer(InventoryTransfer, Warehouse, siteId, body, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: 201,
            value: successResponse({ data: created, message: 'Đã tạo phiếu chuyển kho' }),
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
