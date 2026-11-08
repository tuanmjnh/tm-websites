import { isSafeStorageKey } from '#server/models/media'
import { findMediaByKey } from '#server/services/mediaService'
import { getMediaObject } from '#server/utils/mediaStorage'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/**
 * Public bytes for a library file. The URL carries the storage key (`site/year/
 * uuid.ext`), which is unguessable and immutable: a new upload always gets a new
 * key, so the response can be cached forever. Only allowlisted types can be
 * stored, and the stored type is served back with `nosniff`.
 */
export default defineEventHandler(async (event) => {
  const key = String(getRouterParam(event, 'key') || '')
  if (!isSafeStorageKey(key)) {
    return errorResponse(404, 'MEDIA_NOT_FOUND', 'File not found')
  }

  const siteId = key.split('/')[0]!
  if (siteId !== resolveSiteId(event)) {
    return errorResponse(404, 'MEDIA_NOT_FOUND', 'File not found')
  }

  const record = await withPreparedDb(event, ({ Media }) => findMediaByKey(Media, siteId, key))
  if (!record) {
    return errorResponse(404, 'MEDIA_NOT_FOUND', 'File not found')
  }

  const body = await getMediaObject(key)
  if (!body) {
    return errorResponse(404, 'MEDIA_NOT_FOUND', 'File not found')
  }

  setHeader(event, 'content-type', record.mimeType)
  setHeader(event, 'content-length', body.length)
  setHeader(event, 'cache-control', 'public, max-age=31536000, immutable')
  setHeader(event, 'x-content-type-options', 'nosniff')
  setHeader(event, 'cross-origin-resource-policy', 'cross-origin')
  setHeader(
    event,
    'content-disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(record.originalName)}`,
  )

  return body
})
