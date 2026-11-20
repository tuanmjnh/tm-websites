import { unsubscribeNewsletter } from '#server/services/newsletterService'
import {
  auditMetaOf,
  translateContentError,
} from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const UnsubscribeBodySchema = z.object({
  email: z.string().trim().toLowerCase().max(200).optional(),
  token: z.string().trim().max(200).optional(),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = await readBody(event)
  const input = parseInput(UnsubscribeBodySchema, body, 'NEWSLETTER_UNSUBSCRIBE_INVALID', 'Dữ liệu huỷ đăng ký không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ NewsletterSubscription, Audit }) =>
      unsubscribeNewsletter(NewsletterSubscription, siteId, input, {
        audit: auditMetaOf(event, user, Audit),
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result, message: 'Đã huỷ đăng ký' })
  } catch (error) {
    return translateContentError(error)
  }
})
