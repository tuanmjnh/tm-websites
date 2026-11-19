import { listStaff } from '#server/services/staffService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import type { StaffPosition, StaffWorkStatus } from '#server/models/staffProfile'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = getQuery(event)
  const includeDeleted = query.includeDeleted === 'true' || query.includeDeleted === '1'

  try {
    const result = await withPreparedDb(event, ({ StaffProfile }) =>
      listStaff(StaffProfile, siteId, {
        q: typeof query.q === 'string' ? query.q : null,
        workStatus: typeof query.workStatus === 'string' ? query.workStatus as StaffWorkStatus : null,
        positionCode: typeof query.positionCode === 'string' ? query.positionCode as StaffPosition : null,
        includeDeleted,
        cursor: typeof query.cursor === 'string' ? query.cursor : null,
        limit: typeof query.limit === 'string' ? Number(query.limit) : undefined,
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: result.data,
      meta: { counts: result.counts, hasMore: result.hasMore, nextCursor: result.nextCursor ?? undefined },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
