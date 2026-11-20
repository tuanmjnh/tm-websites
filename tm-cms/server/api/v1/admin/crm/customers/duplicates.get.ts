import { findDuplicateCustomers } from '#server/services/customerService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/**
 * Read-only duplicate report. Nothing is merged: an operator decides per group,
 * because merging would move order history and loyalty points.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)

  try {
    const groups = await withPreparedDb(event, ({ Customer }) => findDuplicateCustomers(Customer, siteId))
    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: groups, meta: { groups: groups.length } })
  } catch (error) {
    return translateContentError(error)
  }
})
