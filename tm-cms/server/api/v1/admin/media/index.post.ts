import { createMedia } from '#server/services/mediaService'
import { translateContentError, writeMetaOf } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/**
 * Multipart upload. The type allowlist and size cap are enforced by the service
 * on the bytes actually received, not on the declared part headers, and the
 * binary goes to the storage adapter instead of MongoDB.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'media.upload')

  const siteId = resolveSiteId(event)

  try {
    const parts = await readMultipartFormData(event)
    const file = parts?.find(part => part.name === 'file' && part.filename)
    if (!file) {
      return errorResponse(422, 'MEDIA_FILE_REQUIRED', 'Chưa chọn tệp để tải lên')
    }

    const field = (name: string) => {
      const part = parts?.find(entry => entry.name === name && entry.filename === undefined)
      return part ? part.data.toString('utf8') : undefined
    }

    const origin = getRequestURL(event).origin
    const created = await withPreparedDb(event, ({ Media, Audit, Revision }) =>
      createMedia(
        Media,
        siteId,
        origin,
        {
          body: file.data,
          mimeType: file.type,
          originalName: file.filename,
          title: field('title'),
          alt: field('alt'),
          folder: field('folder'),
          uploader: { id: user.id, name: user.name ?? '', email: user.email ?? '' },
        },
        writeMetaOf(event, user, Audit, Revision).audit,
      ))

    setResponseStatus(event, 201)
    setHeader(event, 'cache-control', 'no-store')

    return successResponse({ event, data: created, message: 'Đã tải tệp lên thư viện' })
  } catch (error) {
    return translateContentError(error)
  }
})
