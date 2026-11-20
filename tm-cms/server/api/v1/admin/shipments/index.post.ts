import { createShipment } from '#server/services/shipmentService'
import {
  auditMetaOf,
  translateContentError,
} from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const ShipmentItemBodySchema = z.object({
  itemId: z.string().trim().max(64).nullable().optional(),
  variantId: z.string().trim().max(64).nullable().optional(),
  itemName: z.string().trim().min(1).max(300),
  sku: z.string().trim().max(120).optional(),
  quantity: z.coerce.number().int().min(1).max(999999),
})

const ShipmentCreateBodySchema = z.object({
  code: z.string().trim().max(32),
  orderId: z.string().trim().min(1).max(64),
  status: z.enum(['draft', 'shipped', 'in_transit', 'delivered', 'returned', 'cancelled']).optional(),
  carrier: z.string().trim().max(120).optional(),
  trackingNumber: z.string().trim().max(200).optional(),
  items: z.array(ShipmentItemBodySchema).min(1).max(200),
  shippingAddress: z.record(z.string(), z.string()).optional(),
  note: z.string().trim().max(2000).optional(),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = await readBody(event)
  const input = parseInput(ShipmentCreateBodySchema, body, 'SHIPMENT_PAYLOAD_INVALID', 'Dữ liệu vận đơn không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ Shipment, Order, Audit }) =>
      createShipment(Shipment, Order, siteId, input, {
        audit: auditMetaOf(event, user, Audit),
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result, message: 'Đã tạo vận đơn' })
  } catch (error) {
    return translateContentError(error)
  }
})
