import { NewsletterResendRequestSchema, NewsletterResendResponseSchema } from '@tm/flow-contracts'
import { CheckoutError } from '#server/utils/checkoutService'
import { resendNewsletterConfirmation } from '#server/utils/newsletterService'

/**
 * `POST /api/public/newsletter/resend` queues the confirmation mail again for a
 * signup that never arrived.
 *
 * The answer is deliberately identical for every address — pending, confirmed
 * or unknown — so the button cannot be used to find out who subscribed. Whether
 * a mail actually went out is decided server-side: only a pending row gets a
 * fresh link, and only after the per-address cooldown.
 */
export default defineEventHandler(async (event) => {
  const body = NewsletterResendRequestSchema.safeParse(await readBody(event).catch(() => null))
  if (!body.success) {
    throw createError({
      statusCode: 422,
      statusMessage: 'error.newsletterInvalid',
      data: { code: 'NEWSLETTER_INVALID' },
    })
  }

  try {
    await resendNewsletterConfirmation(event, body.data.email)
  } catch (error) {
    if (error instanceof CheckoutError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.code, data: { code: error.code } })
    }
    throw error
  }

  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return NewsletterResendResponseSchema.parse({ success: true, data: { state: 'accepted' } })
})
