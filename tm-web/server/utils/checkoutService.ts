import type { H3Event } from 'h3'
import { escapeRegExp, pickLocalized } from '@tm/flow-utils'
import {
  type PublicCheckoutBlockedLine,
  type PublicCheckoutOrder,
  type PublicCheckoutRequest,
  checkoutBlockingLines,
  checkoutOrderCode,
} from '@tm/flow-contracts'
import {
  PublicCheckoutAuditModel,
  PublicCheckoutCustomerModel,
  PublicCheckoutOrderModel,
} from '#server/models/orderPublic'
import { revalidatePublicCart } from './cartService'
import { getCatalogCurrency } from './catalogService'
import { withSiteDb } from './mongo'
import { getSiteLocale } from './publicSite'

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const DEFAULT_LOCALE = 'vi'

export class CheckoutError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'CheckoutError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

interface CheckoutOrderRecord {
  _id: unknown
  code: string
  status: string
  paymentStatus: string
  currency: string
  totalAmount: number
  items?: { itemName?: string, name?: Record<string, string>, quantity?: number, price?: number }[]
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function resolveSiteId(event: H3Event): string {
  const config = useRuntimeConfig(event)
  const siteId = String(config.siteId || config.public.siteId || '').trim()
  if (!SITE_ID_PATTERN.test(siteId)) {
    throw new CheckoutError(503, 'SITE_ID_INVALID', 'Cửa hàng chưa được cấu hình')
  }
  return siteId
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function toOrder(order: CheckoutOrderRecord): PublicCheckoutOrder {
  const items = Array.isArray(order.items) ? order.items : []
  return {
    code: order.code,
    status: order.status,
    paymentStatus: order.paymentStatus,
    currency: order.currency,
    totalAmount: order.totalAmount,
    itemCount: items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0),
    items: items.map(item => ({
      // The order stores one snapshot string (`itemName`); older rows may carry
      // the localized object, so keep that when it is there.
      name: item.name ?? (item.itemName ? { [DEFAULT_LOCALE]: item.itemName } : {}),
      quantity: Number(item.quantity ?? 0),
      unitPrice: Number(item.price ?? 0),
      lineTotal: round(Number(item.price ?? 0) * Number(item.quantity ?? 0)),
    })),
  }
}

/**
 * A cart line the server had to correct cannot be checked out silently.
 */
function cartChanged(blocked: PublicCheckoutBlockedLine[]): CheckoutError {
  return new CheckoutError(
    409,
    'CHECKOUT_CART_CHANGED',
    'Giỏ hàng đã thay đổi; vui lòng kiểm tra lại trước khi đặt hàng',
    { lines: blocked },
  )
}

/**
 * Guest checkout: prices, availability and totals are recomputed from the
 * published catalog, the customer profile is only linked when one already
 * matches the contact details, and a retried submit (same idempotency key)
 * returns the order it created instead of a second one.
 *
 * Stock is *validated*, not reserved: `catalog_items.stock` is the storefront
 * availability the CMS maintains, while the warehouse ledger moves when the
 * order is fulfilled. Reserving here would need a warehouse binding the
 * storefront does not have.
 */
export async function createPublicCheckout(
  event: H3Event,
  request: PublicCheckoutRequest,
  idempotencyKey: string,
): Promise<PublicCheckoutOrder> {
  const siteId = resolveSiteId(event)
  const locale = getSiteLocale(event)
  const currency = getCatalogCurrency(event)
  const code = checkoutOrderCode(idempotencyKey)

  return withSiteDb(event, async () => {
    const existing = await PublicCheckoutOrderModel.findOne({ siteId, code }).lean<CheckoutOrderRecord | null>()
    if (existing) return toOrder(existing)

    const cart = await revalidatePublicCart(event, request.lines)
    const blocked = checkoutBlockingLines(cart)
    if (blocked.length) throw cartChanged(blocked)

    const itemsPrice = round(cart.lines.reduce((sum, line) => sum + line.lineTotal, 0))
    if (itemsPrice <= 0) {
      throw new CheckoutError(422, 'CHECKOUT_EMPTY', 'Giỏ hàng không có sản phẩm nào có thể đặt')
    }

    const customerId = await findCustomerId(siteId, request)
    const now = new Date()

    const items = cart.lines.map(line => ({
      itemId: line.itemId,
      variantId: line.variantSku,
      supplierId: null,
      itemName: pickLocalized(line.name as never, locale).trim()
        || pickLocalized(line.name as never, DEFAULT_LOCALE).trim()
        || 'Sản phẩm',
      sku: line.variantSku ?? '',
      attributes: {},
      price: line.unitPrice,
      quantity: line.quantity,
      thumbnail: null,
      returnedQuantity: 0,
    }))

    const document = {
      siteId,
      code,
      customerId,
      channel: 'portal',
      status: 'pending',
      paymentStatus: 'unpaid',
      paymentMethod: request.paymentMethod,
      currency,
      items,
      itemsPrice,
      shippingFee: 0,
      discountAmount: 0,
      totalAmount: itemsPrice,
      paidAmount: 0,
      shippingAddress: {
        ...request.shippingAddress,
        fullName: request.shippingAddress.fullName || request.customer.fullName,
        phone: request.shippingAddress.phone || request.customer.phone,
      },
      note: request.note,
      warehouseId: null,
      history: [{
        status: 'pending',
        at: now.toISOString(),
        note: 'Web checkout',
        actorId: '',
      }],
      isDeleted: false,
      deletedAt: null,
      revision: 1,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    }

    let created
    try {
      created = await PublicCheckoutOrderModel.create(document)
    } catch (error) {
      // The unique `(siteId, code)` index is the idempotency guard: a concurrent
      // retry of the same submit lost the insert race, so return its order.
      if ((error as { code?: number }).code === 11000) {
        const raced = await PublicCheckoutOrderModel.findOne({ siteId, code }).lean<CheckoutOrderRecord | null>()
        if (raced) return toOrder(raced)
      }
      throw error
    }

    const record = created.toObject() as unknown as CheckoutOrderRecord

    await PublicCheckoutAuditModel.create({
      siteId,
      resourceType: 'order',
      resourceId: String(record._id),
      resourceKey: record.code,
      action: 'create',
      revision: 1,
      fromStatus: null,
      toStatus: 'pending',
      changedFields: ['code', 'customerId', 'status', 'totalAmount', 'items'],
      reason: null,
      // No Hub session exists on a public form; the actor says where it came from.
      actor: { id: 'web-checkout', name: 'Web checkout', email: '' },
      requestId: null,
      createdAt: now,
    })

    return toOrder(record)
  })
}

/**
 * Links the order to an existing CRM profile when one already carries the same
 * contact details. Checkout never creates a customer profile: identity and
 * profile lifecycle stay with the CMS, and a guest order is perfectly valid
 * with `customerId: null`.
 */
async function findCustomerId(siteId: string, request: PublicCheckoutRequest): Promise<unknown> {
  const email = (request.customer.email ?? '').trim().toLowerCase()
  const phone = request.customer.phone.trim()

  const candidates: Record<string, unknown>[] = []
  if (email) {
    candidates.push({ email: { $regex: `^${escapeRegExp(email)}$`, $options: 'i' } })
  }
  if (phone) candidates.push({ phone })
  if (!candidates.length) return null

  const customer = await PublicCheckoutCustomerModel
    .findOne({ siteId, isDeleted: { $ne: true }, $or: candidates })
    .select('_id')
    .lean<CheckoutCustomerRecord | null>()

  return customer ? readRecord(customer)._id ?? null : null
}

interface CheckoutCustomerRecord {
  _id: unknown
}
