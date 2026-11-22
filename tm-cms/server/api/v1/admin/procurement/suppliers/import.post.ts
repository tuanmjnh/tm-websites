import { importSuppliers } from '#server/services/supplierService'
import { auditMetaOf, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

/** `POST /api/v1/admin/procurement/suppliers/import` upserts up to 500 suppliers by `code`. */
const SupplierImportBodySchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const input = parseInput(SupplierImportBodySchema, await readBody(event), 'SUPPLIER_IMPORT_INVALID', 'Dữ liệu nhập không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ Supplier, Audit }) =>
      importSuppliers(Supplier, siteId, input.rows, {
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
