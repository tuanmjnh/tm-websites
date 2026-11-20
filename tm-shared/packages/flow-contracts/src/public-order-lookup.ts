import { z } from 'zod'
import { LocalizedTextSchema } from './catalog.js'

/**
 * Guest order lookup contract.
 *
 * A visitor who checked out without an account still needs to see what they
 * ordered. The pair (order code, phone number used on the order) is the only
 * credential: the server never confirms whether a code exists on its own, and
 * a wrong phone answers exactly like an unknown code.
 */

export const ORDER_LOOKUP_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{3,31}$/

/** Codes are shown in uppercase without surrounding whitespace. */
export function orderLookupCode(value: string): string {
  return value.trim().toUpperCase()
}

/**
 * Phone comparison is digit-based, so `+84 90 123 4567`, `0901234567` and
 * `0901 234 567` all match the same order.
 */
export function normalizeLookupPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.startsWith('84')) return `0${digits.slice(2)}`
  return digits
}

export const OrderLookupRequestSchema = z.object({
  code: z.string().trim().transform(orderLookupCode).pipe(z.string().regex(ORDER_LOOKUP_CODE_PATTERN)),
  phone: z.string().trim().min(6).max(40).refine(value => normalizeLookupPhone(value).length >= 9),
})

export type OrderLookupRequest = z.infer<typeof OrderLookupRequestSchema>

export const OrderLookupItemSchema = z.object({
  name: LocalizedTextSchema,
  quantity: z.number().int().min(1),
  unitPrice: z.number().nonnegative(),
  lineTotal: z.number().nonnegative(),
})

export const OrderLookupOrderSchema = z.object({
  code: z.string().min(1),
  status: z.string().min(1),
  paymentStatus: z.string().min(1),
  paymentMethod: z.string().nullable(),
  currency: z.string().min(1),
  totalAmount: z.number().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  items: z.array(OrderLookupItemSchema),
  /** ISO timestamp of the order, so the visitor can recognise the right one. */
  createdAt: z.string().nullable(),
})

export type OrderLookupOrder = z.infer<typeof OrderLookupOrderSchema>

export const OrderLookupResponseSchema = z.object({
  success: z.literal(true),
  data: OrderLookupOrderSchema,
})

export type OrderLookupResponse = z.infer<typeof OrderLookupResponseSchema>
