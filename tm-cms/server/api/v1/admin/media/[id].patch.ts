import { updateMedia } from '#server/services/mediaService'
import { MediaUpdateBodySchema, translateContentError, writeMetaOf } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'media.upload')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(MediaUpdateBodySchema, await readBody(event), 'MEDIA_PAYLOAD_INVALID', 'Dữ liệu tệp không hợp lệ')

  try {
    const origin = getRequestURL(event).origin
    const updated = await withPreparedDb(event, ({ Media, Audit, Revision }) =>
      updateMedia(Media, siteId, origin, id, body, writeMetaOf(event, user, Audit, Revision).audit))

    setHeader(event, 'cache-control', 'no-store')

    return successResponse({ event, data: updated, message: 'Đã cập nhật thông tin tệp' })
  } catch (error) {
    return translateContentError(error)
  }
})
