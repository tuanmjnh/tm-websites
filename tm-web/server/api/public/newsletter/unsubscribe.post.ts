import { NewsletterTokenRequestSchema, NewsletterUnsubscribeResponseSchema } from '@tm/flow-contracts'
import { CheckoutError } from '#server/utils/checkoutService'
import { unsubscribePublicNewsletter } from '#server/utils/newsletterService'

/**
 * `POST /api/public/newsletter/unsubscribe` opts an address out from the link
 * in its mail.
 *
 * The link carries its own token, because confirmation consumes the first one;
 * a second click on the same link still answers `unsubscribed` instead of
 * pretending the link is broken.
 */
export default defineEventHandler(async (event) => {
  const body = NewsletterTokenRequestSchema.safeParse(await readBody(event).catch(() => null))
  if (!body.success) {
    throw createError({
      statusCode: 422,
      statusMessage: 'error.newsletterTokenInvalid',
      data: { code: 'NEWSLETTER_TOKEN_INVALID' },
    })
  }

  try {
    await unsubscribePublicNewsletter(event, body.data.token)
  } catch (error) {
    if (error instanceof CheckoutError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.code, data: { code: error.code } })
    }
    throw error
  }

  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return NewsletterUnsubscribeResponseSchema.parse({ success: true, data: { status: 'unsubscribed' } })
})
