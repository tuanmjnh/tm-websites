import { OrderLookupRequestSchema, OrderLookupResponseSchema } from '@tm/flow-contracts'
import { CheckoutError } from '#server/utils/checkoutService'
import { lookupPublicOrder } from '#server/utils/orderLookupService'

/**
 * `POST /api/public/order-lookup` shows a guest the order they placed.
 *
 * The body is the order code plus the phone number on that order; both are
 * needed, and a mismatch answers 404 like an unknown code. The response is
 * never cached and carries no internal ids, no address and no customer id.
 */
export default defineEventHandler(async (event) => {
  const body = OrderLookupRequestSchema.safeParse(await readBody(event).catch(() => null))
  if (!body.success) {
    throw createError({
      statusCode: 422,
      statusMessage: 'error.orderLookupInvalid',
      data: { code: 'ORDER_LOOKUP_INVALID' },
    })
  }

  try {
    const order = await lookupPublicOrder(event, body.data)

    setHeader(event, 'Cache-Control', 'no-store')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')

    return OrderLookupResponseSchema.parse({ success: true, data: order })
  } catch (error) {
    if (error instanceof CheckoutError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.code,
        data: { code: error.code },
      })
    }
    throw error
  }
})
