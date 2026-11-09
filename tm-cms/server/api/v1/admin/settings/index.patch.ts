import { AdminSiteSettingsSchema } from '@tm/flow-contracts/settings-admin'
import { SettingsServiceError, updateSiteSettings } from '#server/services/settingsService'
import { idempotencyKeyOf, requestIdOf } from '#server/utils/contentApi'
import { executeIdempotent } from '#server/utils/idempotency'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { revalidateStorefrontForEvent, setRevalidateHeader } from '#server/utils/storefrontRevalidate'

/**
 * `PATCH /api/v1/admin/settings` saves the sections the editor changed.
 *
 * `revision` is the lock the editor loaded; a stale one is `409`, an empty patch
 * is `422`, and the write records one `audit_logs` entry with the actor from the
 * verified session. `Idempotency-Key` works exactly as it does for content, so a
 * retried save does not bump the revision twice.
 */
export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'configs.write')

  const siteId = resolveSiteId(event)
  const body = await readBody(event)
  const idempotencyKey = idempotencyKeyOf(event)
  const actor = { id: user.id, name: user.name ?? '', email: user.email ?? '' }

  try {
    const executed = await withPreparedDb(event, ({ Settings, Audit, IdempotencyKey }) =>
      executeIdempotent(
        { model: IdempotencyKey, siteId, action: 'settings.update', key: idempotencyKey, payload: body },
        async () => {
          const settings = await updateSiteSettings(Settings, siteId, body, {
            audit: { model: Audit, actor, requestId: requestIdOf(event) },
          })
          return {
            statusCode: 200,
            value: successResponse({
              data: AdminSiteSettingsSchema.parse(settings),
              message: 'Đã lưu cấu hình site',
            }),
          }
        },
      ))

    setResponseStatus(event, executed.statusCode)
    setHeader(event, 'cache-control', 'no-store')
    if (executed.replayed) setHeader(event, 'idempotent-replay', 'true')

    if (!executed.replayed) {
      setRevalidateHeader(event, await revalidateStorefrontForEvent(event, 'settings.update'))
    }
    return executed.value
  } catch (error) {
    if (error instanceof SettingsServiceError) {
      return errorResponse(error.statusCode, error.code, error.message)
    }
    throw error
  }
})
