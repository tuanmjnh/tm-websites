import { z } from 'zod'
import { deleteRedirect } from '#server/services/redirectService'
import {
  idempotencyKeyOf,
  translateContentError,
  writeMetaOf,
} from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { revalidateStorefrontForEvent, setRevalidateHeader } from '#server/utils/storefrontRevalidate'

const RedirectDeleteQuerySchema = z.object({
  revision: z.coerce.number().int().min(1),
})

/**
 * `DELETE /api/v1/admin/redirects/:id?revision=` removes one row. The revision
 * keeps a stale tab from deleting a row another admin just edited.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const { revision } = parseInput(
    RedirectDeleteQuerySchema,
    getQuery(event),
    'REDIRECT_REVISION_REQUIRED',
    'Thiếu phiên bản hiện tại',
  )
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Redirect, Audit, Revision, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `redirect.delete:${id}`, key: idempotencyKey, payload: { revision } },
        async () => {
          const removed = await deleteRedirect(Redirect, siteId, id, revision, writeMetaOf(event, user, Audit, Revision))
          return {
            statusCode: 200,
            value: successResponse({ data: removed, message: 'Đã xoá chuyển hướng' }),
          }
        },
      ))

    setResponseStatus(event, executed.statusCode)
    setHeader(event, 'cache-control', 'no-store')
    if (executed.replayed) setHeader(event, 'idempotent-replay', 'true')

    if (!executed.replayed) {
      setRevalidateHeader(event, await revalidateStorefrontForEvent(event, 'redirect.delete'))
    }
    return executed.value
  } catch (error) {
    return translateContentError(error)
  }
})
