import { updateShippingCarrier } from '#server/services/shippingCarrierService'
import { auditMetaOf, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const BodySchema = z.record(z.string(), z.unknown())

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(BodySchema, await readBody(event), 'SHIPPING_CARRIER_PAYLOAD_INVALID', 'Dữ liệu không hợp lệ')

  try {
    const record = await withPreparedDb(event, ({ ShippingCarrier, Audit }) =>
      updateShippingCarrier(ShippingCarrier, siteId, id, body, {
        audit: auditMetaOf(event, user, Audit),
      }))
    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: record, message: 'Đã cập nhật đơn vị vận chuyển' })
  } catch (error) {
    return translateContentError(error)
  }
})