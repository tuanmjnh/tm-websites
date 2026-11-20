import { cancelInventoryTransfer } from '#server/services/inventoryTransferService'
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

const TransferCancelSchema = z.record(z.string(), z.unknown())

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(TransferCancelSchema, await readBody(event), 'INVENTORY_TRANSFER_CANCEL_INVALID', 'Dữ liệu huỷ chuyển kho không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ InventoryTransfer, Inventory, InventoryTransaction, SerialNumber, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `inventory_transfer.cancel:${id}`, key: idempotencyKey, payload: body },
        async () => {
          const cancelled = await cancelInventoryTransfer(InventoryTransfer, Inventory, InventoryTransaction, siteId, id, body, {
            audit: auditMetaOf(event, user, Audit),
            serialNumberModel: SerialNumber,
          })
          return {
            statusCode: 200,
            value: successResponse({ data: cancelled, message: 'Đã huỷ phiếu chuyển kho' }),
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
