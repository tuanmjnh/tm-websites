import { receiveInventoryTransfer } from '#server/services/inventoryTransferService'
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

const TransferReceiveSchema = z.record(z.string(), z.unknown())

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(TransferReceiveSchema, await readBody(event), 'INVENTORY_TRANSFER_RECEIPT_INVALID', 'Dữ liệu nhận kho không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ InventoryTransfer, Warehouse, Inventory, InventoryTransaction, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `inventory_transfer.receive:${id}`, key: idempotencyKey, payload: body },
        async () => {
          const received = await receiveInventoryTransfer(
            InventoryTransfer,
            Warehouse,
            Inventory,
            InventoryTransaction,
            siteId,
            id,
            body,
            { audit: auditMetaOf(event, user, Audit) },
          )
          return {
            statusCode: 200,
            value: successResponse({ data: received, message: 'Đã nhận hàng chuyển kho' }),
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
