import { NewsletterSubscribeRequestSchema, NewsletterSubscribeResponseSchema } from '@tm/flow-contracts'
import { subscribePublicNewsletter } from '#server/utils/newsletterService'

/**
 * `POST /api/public/newsletter/subscribe` starts a double opt-in signup.
 *
 * The response says whether a confirmation mail was queued, so the form can
 * tell the visitor to check their inbox instead of claiming a subscription that
 * is still pending — or claiming a mail that no template/provider allowed.
 */
export default defineEventHandler(async (event) => {
  const body = NewsletterSubscribeRequestSchema.safeParse(await readBody(event).catch(() => null))
  if (!body.success) {
    throw createError({
      statusCode: 422,
      statusMessage: 'error.newsletterInvalid',
      data: { code: 'NEWSLETTER_INVALID' },
    })
  }

  const state = await subscribePublicNewsletter(event, body.data)

  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')

  return NewsletterSubscribeResponseSchema.parse({ success: true, data: { state } })
})
