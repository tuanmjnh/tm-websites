import { PublicCartApiResponseSchema, PublicCartRequestSchema } from '@tm/flow-contracts'
import { revalidatePublicCart } from '#server/utils/cartService'

/**
 * `POST /api/public/cart/validate` quotes a client-owned cart.
 *
 * It is a read-only computation over the published catalog, so it needs no CSRF
 * token and no session: the request carries only ids, variants and quantities,
 * and every price, total and availability flag comes back from the server. That
 * makes the response uncacheable per visitor.
 */
export default defineEventHandler(async (event) => {
  const body = PublicCartRequestSchema.safeParse(await readBody(event).catch(() => null))
  if (!body.success) {
    throw createError({
      statusCode: 422,
      statusMessage: 'error.cartInvalid',
      data: { code: 'CART_INVALID' },
    })
  }

  const cart = await revalidatePublicCart(event, body.data.lines)

  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')

  return PublicCartApiResponseSchema.parse({ success: true, data: cart })
})
