import { subscribeNewsletter } from '#server/services/newsletterService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const PublicNewsletterSubscribeBodySchema = z.object({
  email: z.string().trim().toLowerCase().max(200),
  name: z.string().trim().max(120).optional(),
  source: z.string().trim().max(120).optional(),
  consent: z.boolean(),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const siteId = resolveSiteId(event)
  const body = await readBody(event)
  const input = parseInput(PublicNewsletterSubscribeBodySchema, body, 'NEWSLETTER_PAYLOAD_INVALID', 'Dữ liệu đăng ký không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ NewsletterSubscription }) =>
      subscribeNewsletter(NewsletterSubscription, siteId, {
        ...input,
        name: input.name ?? '',
        source: input.source ?? 'public-form',
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: { subscription: result.subscription, confirmRequired: result.confirmRequired },
      message: result.confirmRequired ? 'Vui lòng xác nhận email' : 'Đã đăng ký',
    })
  } catch (error) {
    return translateContentError(error)
  }
})
