import { AdminRedirectUpdateSchema } from '@tm/flow-contracts/redirect-admin'
import { updateRedirect } from '#server/services/redirectService'
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

/**
 * `PATCH /api/v1/admin/redirects/:id` saves the whole row against the revision
 * the editor loaded. A stale revision is `409`, and a target change that would
 * close a loop is refused before the write.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(
    AdminRedirectUpdateSchema,
    await readBody(event),
    'REDIRECT_PAYLOAD_INVALID',
    'Dữ liệu chuyển hướng không hợp lệ',
  )
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Redirect, Audit, Revision, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: `redirect.update:${id}`, key: idempotencyKey, payload: body },
        async () => {
          const updated = await updateRedirect(Redirect, siteId, id, body, writeMetaOf(event, user, Audit, Revision))
          return {
            statusCode: 200,
            value: successResponse({ data: updated, message: 'Đã lưu chuyển hướng' }),
          }
        },
      ))

    setResponseStatus(event, executed.statusCode)
    setHeader(event, 'cache-control', 'no-store')
    if (executed.replayed) setHeader(event, 'idempotent-replay', 'true')

    if (!executed.replayed) {
      setRevalidateHeader(event, await revalidateStorefrontForEvent(event, 'redirect.update'))
    }
    return executed.value
  } catch (error) {
    return translateContentError(error)
  }
})
