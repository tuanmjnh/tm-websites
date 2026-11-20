import { NewsletterConfirmResponseSchema, NewsletterTokenRequestSchema } from '@tm/flow-contracts'
import { CheckoutError } from '#server/utils/checkoutService'
import { confirmPublicNewsletter } from '#server/utils/newsletterService'

/**
 * `POST /api/public/newsletter/confirm` turns a pending signup into a confirmed
 * one. The token is single-use: a second attempt answers 404 like an expired
 * link, which is also what a forged token gets.
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
    await confirmPublicNewsletter(event, body.data.token)
  } catch (error) {
    if (error instanceof CheckoutError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.code, data: { code: error.code } })
    }
    throw error
  }

  setHeader(event, 'Cache-Control', 'no-store')
  return NewsletterConfirmResponseSchema.parse({ success: true, data: { status: 'confirmed' } })
})
