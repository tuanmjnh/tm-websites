import { listAttendances } from '#server/services/attendanceService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import type { AttendanceStatus } from '#server/models/attendance'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = getQuery(event)

  try {
    const limit = typeof query.limit === 'string' && query.limit ? Number(query.limit) : undefined

    const result = await withPreparedDb(event, ({ Attendance }) =>
      listAttendances(Attendance, siteId, {
        month: typeof query.month === 'string' ? query.month : null,
        staffId: typeof query.staffId === 'string' ? query.staffId : null,
        status: typeof query.status === 'string' ? query.status as AttendanceStatus : null,
        cursor: typeof query.cursor === 'string' && query.cursor ? query.cursor : null,
        limit: Number.isFinite(limit) ? limit : undefined,
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: result.data,
      meta: { counts: result.summary, nextCursor: result.nextCursor ?? undefined, hasMore: result.hasMore },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
