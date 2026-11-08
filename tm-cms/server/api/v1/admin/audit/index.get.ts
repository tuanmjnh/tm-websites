import { AdminAuditListSchema, AdminAuditQuerySchema } from '@tm/flow-contracts/audit-admin'
import { listAuditEntries, type AuditListInput } from '#server/services/auditService'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

/**
 * `GET /api/v1/admin/audit` lists the site's own business audit trail: the same
 * entries every content/category/media command writes. Hub IAM audit stays in
 * Hub; nothing here needs a Hub token or returns one.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'apps.logs.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(
    AdminAuditQuerySchema,
    getQuery(event),
    'AUDIT_QUERY_INVALID',
    'Bộ lọc nhật ký không hợp lệ',
  )

  const input: AuditListInput = { limit: query.limit }
  if (query.resourceType) input.resourceType = query.resourceType
  if (query.action) input.action = query.action
  if (query.resourceId) input.resourceId = query.resourceId
  if (query.actorId) input.actorId = query.actorId
  if (query.q) input.q = query.q
  if (query.cursor) input.cursor = query.cursor
  if (query.from) input.from = new Date(query.from)
  if (query.to) input.to = new Date(query.to)

  const result = await withPreparedDb(event, ({ Audit }) => listAuditEntries(Audit, siteId, input))

  setHeader(event, 'cache-control', 'no-store')

  return {
    success: true,
    ...AdminAuditListSchema.parse(result),
  }
})
