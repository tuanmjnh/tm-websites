import {
  PUBLIC_CHECKOUT_IDEMPOTENCY_HEADER,
  PublicCheckoutRequestSchema,
  PublicCheckoutResponseSchema,
} from '@tm/flow-contracts'
import { CheckoutError, createPublicCheckout } from '#server/utils/checkoutService'

/** Retry token shape: opaque, long enough to be unique per submit. */
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/

/**
 * `POST /api/public/checkout` places a guest order.
 *
 * Only ids, variants and quantities come from the browser: the server re-quotes
 * the cart against the published catalog and writes the order itself. The
 * `Idempotency-Key` header is required so a double submit (or a timeout retry)
 * resolves to the same order instead of charging twice.
 *
 * The response is never cached and carries no internal ids or contact details
 * beyond what the customer just typed.
 */
export default defineEventHandler(async (event) => {
  const body = PublicCheckoutRequestSchema.safeParse(await readBody(event).catch(() => null))
  if (!body.success) {
    throw createError({
      statusCode: 422,
      statusMessage: 'error.checkoutInvalid',
      data: { code: 'CHECKOUT_INVALID' },
    })
  }

  const idempotencyKey = String(getHeader(event, PUBLIC_CHECKOUT_IDEMPOTENCY_HEADER) || '').trim()
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'error.checkoutIdempotencyRequired',
      data: { code: 'CHECKOUT_IDEMPOTENCY_REQUIRED' },
    })
  }

  try {
    const result = await createPublicCheckout(event, body.data, idempotencyKey)

    setResponseStatus(event, 201)
    setHeader(event, 'Cache-Control', 'no-store')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')

    return PublicCheckoutResponseSchema.parse({
      success: true,
      data: result.order,
      mailQueued: result.mailQueued,
    })
  } catch (error) {
    if (error instanceof CheckoutError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.code,
        data: { code: error.code, ...(error.details as Record<string, unknown> | undefined) },
      })
    }
    throw error
  }
})
