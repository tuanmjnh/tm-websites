import { subscribeNewsletter } from '#server/services/newsletterService'
import {
  auditMetaOf,
  translateContentError,
} from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const SubscribeBodySchema = z.object({
  email: z.string().trim().toLowerCase().max(200),
  name: z.string().trim().max(120).optional(),
  source: z.string().trim().max(120).optional(),
  consent: z.boolean(),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = await readBody(event)
  const input = parseInput(SubscribeBodySchema, body, 'NEWSLETTER_PAYLOAD_INVALID', 'Dữ liệu đăng ký không hợp lệ')

  try {
    const executed = await withPreparedDb(event, ({ NewsletterSubscription, Audit }) => {
      return subscribeNewsletter(NewsletterSubscription, siteId, input, {
        audit: auditMetaOf(event, user, Audit),
      })
    })

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: executed })
  } catch (error) {
    return translateContentError(error)
  }
})
