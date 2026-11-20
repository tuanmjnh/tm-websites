import type { H3Event } from 'h3'
import {
  type OrderLookupOrder,
  type OrderLookupRequest,
  normalizeLookupPhone,
} from '@tm/flow-contracts'
import { PublicCheckoutOrderModel } from '#server/models/orderPublic'
import { type CheckoutOrderRecord, CheckoutError, resolveSiteId, toOrder } from './checkoutService'
import { withSiteDb } from './mongo'

/**
 * Guest order lookup.
 *
 * The caller proves ownership with the order code *and* the phone used on the
 * order. A wrong phone answers exactly like an unknown code, so the endpoint
 * never confirms that a code exists.
 */
export async function lookupPublicOrder(
  event: H3Event,
  request: OrderLookupRequest,
): Promise<OrderLookupOrder> {
  const siteId = resolveSiteId(event)
  const phone = normalizeLookupPhone(request.phone)

  return withSiteDb(event, async () => {
    const order = await PublicCheckoutOrderModel
      .findOne({ siteId, code: request.code, isDeleted: { $ne: true } })
      .lean<CheckoutOrderRecord | null>()

    if (!order) throw orderNotFound()

    const address = (order as { shippingAddress?: { phone?: unknown } }).shippingAddress
    const candidates = [(order as { phone?: unknown }).phone, address?.phone]
      .map(value => normalizeLookupPhone(String(value ?? '')))
      .filter(value => value.length >= 9)

    if (!candidates.includes(phone)) throw orderNotFound()

    return {
      ...toOrder(order),
      paymentMethod: typeof (order as unknown as { paymentMethod?: unknown }).paymentMethod === 'string'
        ? (order as unknown as { paymentMethod: string }).paymentMethod
        : null,
      createdAt: toIsoString((order as { createdAt?: unknown }).createdAt),
    }
  })
}

function orderNotFound(): CheckoutError {
  return new CheckoutError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng khớp mã và số điện thoại')
}

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}
