import { z } from 'zod'
import { LocalizedTextSchema } from './catalog.js'
import {
  PUBLIC_CART_MAX_LINES,
  PublicCartLineInputSchema,
  type PublicCart,
  type PublicCartIssue,
} from './public-cart.js'

/**
 * Guest checkout contract shared by the storefront form and the Web BFF.
 *
 * The browser sends only item ids/variants/quantities plus the delivery details.
 * Prices, availability and the order code are recomputed server-side, so a
 * tampered request can never change what the customer is charged, and a retried
 * submit resolves to the order it already created.
 */

export const PUBLIC_CHECKOUT_IDEMPOTENCY_HEADER = 'idempotency-key'

/** Only methods a guest can actually pay with from the storefront today. */
export const PUBLIC_CHECKOUT_PAYMENT_METHODS = ['cod', 'banking'] as const
export type PublicCheckoutPaymentMethod = (typeof PUBLIC_CHECKOUT_PAYMENT_METHODS)[number]

const PHONE_PATTERN = /^[0-9+()\s.-]{6,40}$/

export const PublicCheckoutCustomerSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  phone: z.string().trim().regex(PHONE_PATTERN),
  email: z.string().trim().toLowerCase().email().max(200).or(z.literal('')).optional(),
})

export type PublicCheckoutCustomer = z.infer<typeof PublicCheckoutCustomerSchema>

export const PublicCheckoutAddressSchema = z.object({
  fullName: z.string().trim().max(200).default(''),
  phone: z.string().trim().max(40).default(''),
  street: z.string().trim().min(1).max(300),
  ward: z.string().trim().max(120).default(''),
  district: z.string().trim().max(120).default(''),
  city: z.string().trim().min(1).max(120),
  country: z.string().trim().max(120).default('Việt Nam'),
})

export type PublicCheckoutAddress = z.infer<typeof PublicCheckoutAddressSchema>

export const PublicCheckoutRequestSchema = z.object({
  lines: z.array(PublicCartLineInputSchema).min(1).max(PUBLIC_CART_MAX_LINES),
  customer: PublicCheckoutCustomerSchema,
  shippingAddress: PublicCheckoutAddressSchema,
  paymentMethod: z.enum(PUBLIC_CHECKOUT_PAYMENT_METHODS).default('cod'),
  note: z.string().trim().max(1000).default(''),
})

export type PublicCheckoutRequest = z.infer<typeof PublicCheckoutRequestSchema>

export const PublicCheckoutItemSchema = z.object({
  name: LocalizedTextSchema,
  quantity: z.number().int().min(1),
  unitPrice: z.number().nonnegative(),
  lineTotal: z.number().nonnegative(),
})

export const PublicCheckoutOrderSchema = z.object({
  code: z.string().min(1),
  status: z.string().min(1),
  paymentStatus: z.string().min(1),
  currency: z.string().min(1),
  totalAmount: z.number().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  items: z.array(PublicCheckoutItemSchema),
})

export type PublicCheckoutOrder = z.infer<typeof PublicCheckoutOrderSchema>

export const PublicCheckoutResponseSchema = z.object({
  success: z.literal(true),
  data: PublicCheckoutOrderSchema,
})

export type PublicCheckoutResponse = z.infer<typeof PublicCheckoutResponseSchema>

/**
 * Order codes are derived from the caller's idempotency key, so the same submit
 * retried after a timeout hits the unique `(siteId, code)` index instead of
 * creating a second order. The hash is deterministic, not a security primitive.
 */
export function checkoutOrderCode(idempotencyKey: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < idempotencyKey.length; index++) {
    hash ^= idempotencyKey.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `WEB-${hash.toString(16).toUpperCase().padStart(8, '0')}`
}

/** Issues that must stop a checkout instead of silently quoting something else. */
const BLOCKING_ISSUES: readonly PublicCartIssue[] = [
  'item_unavailable',
  'variant_unavailable',
  'out_of_stock',
  'quantity_reduced',
]

export const PublicCheckoutBlockedLineSchema = z.object({
  itemId: z.string().min(1),
  variantSku: z.string().nullable(),
  quantity: z.number().int().min(1),
  issues: z.array(z.string()),
})

export type PublicCheckoutBlockedLine = z.infer<typeof PublicCheckoutBlockedLineSchema>

/**
 * A cart the server had to change (price dropped, quantity capped, product
 * removed) is not checkout-able: the visitor must see the new quote first.
 * `price_changed` alone does not block — the server total always wins.
 */
export function checkoutBlockingLines(cart: PublicCart): PublicCheckoutBlockedLine[] {
  return cart.lines
    .filter((line) => {
      if (!line.available) return true
      return line.issues.some(issue => BLOCKING_ISSUES.includes(issue))
    })
    .map(line => ({
      itemId: line.itemId,
      variantSku: line.variantSku,
      quantity: line.quantity,
      issues: [...line.issues],
    }))
}
