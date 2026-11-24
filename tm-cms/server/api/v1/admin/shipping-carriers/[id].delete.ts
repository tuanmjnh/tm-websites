import { softDeleteShippingCarrier } from '#server/services/shippingCarrierService'
import { auditMetaOf, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const BodySchema = z.object({ revision: z.coerce.number().int().min(1) })

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(BodySchema, await readBody(event), 'SHIPPING_CARRIER_PAYLOAD_INVALID', 'Dữ liệu không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ ShippingCarrier, Audit }) =>
      softDeleteShippingCarrier(ShippingCarrier, siteId, id, {
        audit: auditMetaOf(event, user, Audit),
        expectedRevision: body.revision,
      }))
    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result, message: 'Đã xoá đơn vị vận chuyển' })
  } catch (error) {
    return translateContentError(error)
  }
})