import { restoreContentRevision } from '#server/services/contentService'
import {
  ContentRestoreSchema,
  idempotencyKeyOf,
  revisionParamOf,
  translateContentError,
  writeMetaOf,
} from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'

/**
 * Restores an earlier snapshot as a new revision. `revision` in the body is the
 * editor's current revision, so a stale tab cannot silently overwrite a later
 * edit; the restore itself is idempotent when the caller sends a key.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const targetRevision = revisionParamOf(event)
  const body = parseInput(ContentRestoreSchema, await readBody(event), 'CONTENT_REVISION_REQUIRED', 'Thiếu phiên bản hiện tại')
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Content, Audit, Revision, IdempotencyKey, Redirect }) =>
      executeIdempotent(
        {
          model: IdempotencyKey,
          siteId,
          action: `content.restore:${id}:${targetRevision}`,
          key: idempotencyKey,
          payload: body,
        },
        async () => {
          const updated = await restoreContentRevision(
            Content,
            Revision,
            siteId,
            id,
            targetRevision,
            body.revision,
            {
              ...writeMetaOf(event, user, Audit, Revision),
              redirects: Redirect,
            },
          )
          return {
            statusCode: 200,
            value: successResponse({ data: updated, message: 'Đã khôi phục phiên bản nội dung' }),
          }
        },
      ))

    setResponseStatus(event, executed.statusCode)
    setHeader(event, 'cache-control', 'no-store')
    if (executed.replayed) setHeader(event, 'idempotent-replay', 'true')

    return executed.value
  } catch (error) {
    return translateContentError(error)
  }
})
