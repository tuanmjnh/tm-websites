import { AdminRedirectDraftSchema } from '@tm/flow-contracts/redirect-admin'
import { createRedirect } from '#server/services/redirectService'
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
 * `POST /api/v1/admin/redirects` adds one entry to the redirect map. The service
 * normalizes both paths; a reused old path is `409 REDIRECT_EXISTS` and a map
 * that would loop is `409 REDIRECT_LOOP`.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = parseInput(
    AdminRedirectDraftSchema,
    await readBody(event),
    'REDIRECT_PAYLOAD_INVALID',
    'Dữ liệu chuyển hướng không hợp lệ',
  )
  const idempotencyKey = idempotencyKeyOf(event)

  try {
    const executed = await withPreparedDb(event, ({ Redirect, Audit, Revision, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'redirect.create', key: idempotencyKey, payload: body },
        async () => {
          const created = await createRedirect(Redirect, siteId, body, writeMetaOf(event, user, Audit, Revision))
          return {
            statusCode: 201,
            value: successResponse({ data: created, message: 'Đã thêm chuyển hướng' }),
          }
        },
      ))

    setResponseStatus(event, executed.statusCode)
    setHeader(event, 'cache-control', 'no-store')
    if (executed.replayed) setHeader(event, 'idempotent-replay', 'true')

    if (!executed.replayed) {
      setRevalidateHeader(event, await revalidateStorefrontForEvent(event, 'redirect.create'))
    }
    return executed.value
  } catch (error) {
    return translateContentError(error)
  }
})
