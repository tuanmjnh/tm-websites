import { unsubscribeNewsletter } from '#server/services/newsletterService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const PublicNewsletterUnsubscribeBodySchema = z.object({
  email: z.string().trim().toLowerCase().max(200).optional(),
  token: z.string().trim().max(200).optional(),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const siteId = resolveSiteId(event)
  const body = await readBody(event)
  const input = parseInput(PublicNewsletterUnsubscribeBodySchema, body, 'NEWSLETTER_UNSUBSCRIBE_INVALID', 'Dữ liệu huỷ đăng ký không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ NewsletterSubscription }) =>
      unsubscribeNewsletter(NewsletterSubscription, siteId, input))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result, message: 'Đã huỷ đăng ký' })
  } catch (error) {
    return translateContentError(error)
  }
})
