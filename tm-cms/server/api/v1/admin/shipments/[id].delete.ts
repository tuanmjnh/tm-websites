import { softDeleteShipment } from '#server/services/shipmentService'
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

const ShipmentDeleteQuerySchema = z.object({ revision: z.coerce.number().int().min(1) })

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const { revision } = parseInput(ShipmentDeleteQuerySchema, getQuery(event), 'SHIPMENT_REVISION_REQUIRED', 'Thiếu phiên bản hiện tại')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Shipment, Audit, IdempotencyKey, Order, Inventory, InventoryTransaction, SerialNumber }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `shipment.delete:${id}`, key: idempotencyKey, payload: { revision } },
        async () => {
          const removed = await softDeleteShipment(Shipment, siteId, id, revision, {
            audit: auditMetaOf(event, user, Audit),
            serialNumberModel: SerialNumber,
          }, Inventory, InventoryTransaction, Order)
          return {
            statusCode: 200,
            value: successResponse({ data: removed, message: 'Đã ẩn vận đơn' }),
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