import { markSerialSold } from '#server/services/serialNumberService'
import {
  auditMetaOf,
  translateContentError,
} from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const MarkSoldBodySchema = z.object({
  orderId: z.string().trim().min(1).max(64),
  revision: z.coerce.number().int().min(1),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = await readBody(event)
  const input = parseInput(MarkSoldBodySchema, body, 'SERIAL_NUMBER_UPDATE_INVALID', 'Dữ liệu không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ SerialNumber, Audit }) =>
      markSerialSold(SerialNumber, siteId, id, input.orderId, input.revision, {
        audit: auditMetaOf(event, user, Audit),
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result, message: 'Đã đánh dấu đã bán' })
  } catch (error) {
    return translateContentError(error)
  }
})
