import { importSerialNumbers } from '#server/services/serialNumberService'
import { auditMetaOf, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

/**
 * `POST /api/v1/admin/serial-numbers/import` registers up to 500 serials and
 * answers with one result per row. A duplicate serial (already registered, or
 * repeated inside the file) fails alone while the other rows are created. The
 * row limit and the required fields stay in the service, so its own
 * `SERIAL_NUMBER_IMPORT_*` codes are what the caller sees.
 */
const SerialImportBodySchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const input = parseInput(SerialImportBodySchema, await readBody(event), 'SERIAL_NUMBER_IMPORT_PAYLOAD_INVALID', 'Dữ liệu serial không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ SerialNumber, Audit }) =>
      importSerialNumbers(SerialNumber, siteId, input.rows, {
        audit: auditMetaOf(event, user, Audit),
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: result,
      message: `Đã nhập ${result.created} serial mới, ${result.failed} lỗi`,
    })
  } catch (error) {
    return translateContentError(error)
  }
})
