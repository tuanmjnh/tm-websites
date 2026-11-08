import { getSiteSettings } from '#server/services/settingsService'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/**
 * `GET /api/v1/admin/settings` returns the site's settings document, or the
 * defaults with `revision: 0` when the site was never saved. No secret lives in
 * this document, so the whole record can go to an authenticated admin.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'configs.read')

  const siteId = resolveSiteId(event)
  const settings = await withPreparedDb(event, ({ Settings }) => getSiteSettings(Settings, siteId))

  setHeader(event, 'cache-control', 'no-store')

  return { success: true, data: settings }
})
