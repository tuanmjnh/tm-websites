import { updateShipment } from '#server/services/shipmentService'
import {
  auditMetaOf,
  translateContentError,
} from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const ShipmentUpdateBodySchema = z.object({
  status: z.enum(['draft', 'shipped', 'in_transit', 'delivered', 'returned', 'cancelled']).optional(),
  carrier: z.string().trim().max(120).optional(),
  trackingNumber: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional(),
  revision: z.coerce.number().int().min(1),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = await readBody(event)
  const input = parseInput(ShipmentUpdateBodySchema, body, 'SHIPMENT_UPDATE_INVALID', 'Dữ liệu cập nhật không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ Shipment, Audit, Order, Inventory, InventoryTransaction, SerialNumber, MailDelivery, MailTemplate, Customer }) =>
      updateShipment(Shipment, siteId, id, input, {
        audit: auditMetaOf(event, user, Audit),
        serialNumberModel: SerialNumber,
        notify: { delivery: MailDelivery, template: MailTemplate, customer: Customer },
      }, Inventory, InventoryTransaction, Order))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result, message: 'Đã cập nhật vận đơn' })
  } catch (error) {
    return translateContentError(error)
  }
})