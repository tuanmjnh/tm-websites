import { setSalaryConfig } from '#server/services/payrollService'
import { auditMetaOf, idempotencyKeyOf, translateContentError } from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const SalaryBodySchema = z.record(z.string(), z.unknown())

/**
 * Effective-dated compensation: a new row from a date, never an edit of the past.
 * Re-posting the same `effectiveFrom` corrects that row.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(SalaryBodySchema, await readBody(event), 'SALARY_CONFIG_PAYLOAD_INVALID', 'Dữ liệu lương không hợp lệ')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ SalaryConfig, StaffProfile, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'salary_config.set', key: idempotencyKey, payload: body },
        async () => {
          const config = await setSalaryConfig(SalaryConfig, StaffProfile, siteId, body, {
            audit: auditMetaOf(event, user, Audit),
          })
          return {
            statusCode: 201,
            value: successResponse({ data: config, message: 'Đã lưu cấu hình lương' }),
          }
        },
      ))

    setResponseStatus(event, executed.statusCode)
    setHeader(event, 'cache-control', 'no-store')
    if (executed.replayed) setHeader(event, 'idempotent-replay', 'true')

    return executed.value
  } catch (error) {
    return translateContentError(error)
  }
})
