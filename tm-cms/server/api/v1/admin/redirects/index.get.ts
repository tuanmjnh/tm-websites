import { z } from 'zod'
import { listRedirects } from '#server/services/redirectService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

const RedirectListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
})

/**
 * `GET /api/v1/admin/redirects` lists the site's redirect map sorted by old
 * path. `q` is a literal case-insensitive filter over old path, target and note.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(RedirectListQuerySchema, getQuery(event), 'REDIRECT_QUERY_INVALID', 'Bộ lọc không hợp lệ')

  try {
    const list = await withPreparedDb(event, ({ Redirect }) => listRedirects(Redirect, siteId, query))
    setHeader(event, 'cache-control', 'no-store')
    return { success: true as const, data: list.data, total: list.total }
  } catch (error) {
    return translateContentError(error)
  }
})
