import { confirmNewsletterSubscription } from '#server/services/newsletterService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const PublicNewsletterConfirmBodySchema = z.object({ token: z.string().trim().min(1).max(200) })

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const siteId = resolveSiteId(event)
  const body = await readBody(event)
  const { token } = parseInput(PublicNewsletterConfirmBodySchema, body, 'NEWSLETTER_TOKEN_REQUIRED', 'Thiếu mã xác nhận')

  try {
    const result = await withPreparedDb(event, ({ NewsletterSubscription }) =>
      confirmNewsletterSubscription(NewsletterSubscription, siteId, token))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result, message: 'Đã xác nhận đăng ký' })
  } catch (error) {
    return translateContentError(error)
  }
})
