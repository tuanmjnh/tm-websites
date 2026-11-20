import { registerSerialNumbers } from '#server/services/serialNumberService'
import {
  auditMetaOf,
  translateContentError,
} from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const SerialRegisterItemSchema = z.object({
  serial: z.string().trim().min(3).max(64),
  itemId: z.string().trim().min(1).max(64),
  variantId: z.string().trim().max(64).nullable().optional(),
  warehouseId: z.string().trim().max(64).nullable().optional(),
  purchaseOrderId: z.string().trim().max(64).nullable().optional(),
  note: z.string().trim().max(500).optional(),
})

const SerialRegisterBodySchema = z.object({
  serials: z.array(SerialRegisterItemSchema).min(1).max(500),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = await readBody(event)
  const input = parseInput(SerialRegisterBodySchema, body, 'SERIAL_NUMBER_PAYLOAD_INVALID', 'Dữ liệu serial không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ SerialNumber, Audit }) =>
      registerSerialNumbers(SerialNumber, siteId, siteId, input.serials, {
        audit: auditMetaOf(event, user, Audit),
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result, message: 'Đã đăng ký serial' })
  } catch (error) {
    return translateContentError(error)
  }
})
