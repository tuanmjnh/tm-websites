import { exportAuditCsv } from '#server/services/auditService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const ExportQuerySchema = z.object({
  resourceType: z.string().trim().max(48).optional(),
  action: z.string().trim().max(32).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
})

/**
 * The audit trail leaves the system as CSV, so it takes `content.write` on top
 * of the log read capability. Rows are bounded and scoped to this site.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'apps.logs.read', 'content.write')

  const siteId = resolveSiteId(event)
  const query = parseInput(ExportQuerySchema, getQuery(event), 'AUDIT_EXPORT_QUERY_INVALID', 'Bộ lọc xuất nhật ký không hợp lệ')

  try {
    const exported = await withPreparedDb(event, ({ Audit }) =>
      exportAuditCsv(Audit, siteId, {
        resourceType: query.resourceType,
        action: query.action,
        limit: query.limit,
      }))

    setHeader(event, 'content-type', 'text/csv; charset=utf-8')
    setHeader(event, 'content-disposition', 'attachment; filename="nhat-ky.csv"')
    setHeader(event, 'cache-control', 'no-store')
    setHeader(event, 'x-export-rows', String(exported.rows))
    if (exported.truncated) setHeader(event, 'x-export-truncated', 'true')

    return exported.csv
  } catch (error) {
    return translateContentError(error)
  }
})
