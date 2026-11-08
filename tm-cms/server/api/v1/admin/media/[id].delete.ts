import { deleteMedia } from '#server/services/mediaService'
import { MediaDeleteQuerySchema, translateContentError, writeMetaOf } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'media.delete')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const query = parseInput(MediaDeleteQuerySchema, getQuery(event), 'MEDIA_QUERY_INVALID', 'Thiếu phiên bản tệp cần xoá')

  try {
    const removed = await withPreparedDb(event, ({ Media, Content, Audit, Revision }) =>
      deleteMedia({ media: Media, content: Content }, siteId, id, query.revision, writeMetaOf(event, user, Audit, Revision).audit))

    setHeader(event, 'cache-control', 'no-store')

    return successResponse({ event, data: removed, message: 'Đã xoá tệp khỏi thư viện' })
  } catch (error) {
    return translateContentError(error)
  }
})
