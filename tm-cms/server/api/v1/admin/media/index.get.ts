import { listMedia } from '#server/services/mediaService'
import { MediaListQuerySchema, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'media.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(MediaListQuerySchema, getQuery(event), 'MEDIA_QUERY_INVALID', 'Bộ lọc thư viện không hợp lệ')

  try {
    const origin = getRequestURL(event).origin
    const result = await withPreparedDb(event, ({ Media }) => listMedia(Media, siteId, origin, query))

    setHeader(event, 'cache-control', 'no-store')

    // Folder list and per-kind counts ship with the page so the library never
    // renders a second, differently filtered query just to draw its toolbar.
    return successResponse({
      event,
      data: result.data,
      meta: {
        nextCursor: result.nextCursor ?? undefined,
        hasMore: result.hasMore,
        counts: result.counts,
        folders: result.folders,
      },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
