import { importCustomers } from '#server/services/customerService'
import { auditMetaOf, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

/**
 * `POST /api/v1/admin/crm/customers/import` upserts up to 500 customer profiles
 * by `code`. A row without a code is always a new profile, and a profile can
 * never be relinked to another Hub subject by an import.
 */
const CustomerImportBodySchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const input = parseInput(CustomerImportBodySchema, await readBody(event), 'CUSTOMER_IMPORT_INVALID', 'Dữ liệu nhập không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ Customer, CustomerSegment, Audit }) =>
      importCustomers(Customer, CustomerSegment, siteId, input.rows, {
        audit: auditMetaOf(event, user, Audit),
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: result,
      message: `Đã nhập ${result.created} mới, ${result.updated} cập nhật, ${result.failed} lỗi`,
    })
  } catch (error) {
    return translateContentError(error)
  }
})
