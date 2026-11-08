import { z } from 'zod'
import { LocalizedTextSchema, type PublicCatalogItemDetail } from './catalog.js'

/**
 * Cart contracts shared by the storefront composable, the Web BFF and the
 * contract tests.
 *
 * The cart itself is client-owned: only the list of item ids, optional variant
 * SKUs and quantities travel to the server. Prices, stock and totals are always
 * recomputed from the published catalog, so a tampered localStorage entry can
 * never change what a visitor is quoted.
 */

export const PUBLIC_CART_MAX_LINES = 20
export const PUBLIC_CART_MAX_QUANTITY = 99

/** Why a line cannot be quoted as stored. The client renders one message per code. */
export const PUBLIC_CART_ISSUE_CODES = [
  'item_unavailable',
  'variant_unavailable',
  'out_of_stock',
  'price_changed',
] as const
export type PublicCartIssue = (typeof PUBLIC_CART_ISSUE_CODES)[number]

export const PublicCartLineInputSchema = z.object({
  itemId: z.string().trim().min(1).max(64),
  variantSku: z.string().trim().min(1).max(64).optional(),
  quantity: z.number().int().min(1).max(PUBLIC_CART_MAX_QUANTITY),
  /** Price the visitor was shown. A mismatch becomes `price_changed`, never a rejection. */
  expectedPrice: z.number().nonnegative().optional(),
})
export type PublicCartLineInput = z.infer<typeof PublicCartLineInputSchema>

export const PublicCartRequestSchema = z.object({
  lines: z.array(PublicCartLineInputSchema).max(PUBLIC_CART_MAX_LINES),
})
export type PublicCartRequest = z.infer<typeof PublicCartRequestSchema>

export const PublicCartLineSchema = z.object({
  itemId: z.string().min(1),
  variantSku: z.string().nullable(),
  name: LocalizedTextSchema,
  path: z.string().startsWith('/').optional(),
  unitPrice: z.number().nonnegative(),
  quantity: z.number().int().min(1).max(PUBLIC_CART_MAX_QUANTITY),
  lineTotal: z.number().nonnegative(),
  available: z.boolean(),
  issues: z.array(z.enum(PUBLIC_CART_ISSUE_CODES)),
})
export type PublicCartLine = z.infer<typeof PublicCartLineSchema>

export const PublicCartSchema = z.object({
  lines: z.array(PublicCartLineSchema),
  subtotal: z.number().nonnegative(),
  currency: z.string().min(1),
  itemCount: z.number().int().nonnegative(),
  issues: z.array(z.enum(PUBLIC_CART_ISSUE_CODES)),
})
export type PublicCart = z.infer<typeof PublicCartSchema>

export const PublicCartApiResponseSchema = z.object({
  success: z.literal(true),
  data: PublicCartSchema,
})
export type PublicCartApiResponse = z.infer<typeof PublicCartApiResponseSchema>

/** Stable client-side identity of one stored line. */
export function cartLineKey(line: { itemId: string, variantSku?: string | null }): string {
  return `${line.itemId}::${line.variantSku ?? ''}`
}

const roundMoney = (value: number) => Math.round(value * 100) / 100

function unavailableLine(
  input: PublicCartLineInput,
  issues: PublicCartIssue[],
  item?: PublicCatalogItemDetail
): PublicCartLine {
  return {
    itemId: input.itemId,
    variantSku: input.variantSku ?? null,
    name: item?.name ?? {},
    ...(item ? { path: item.path } : {}),
    unitPrice: 0,
    quantity: input.quantity,
    lineTotal: 0,
    available: false,
    issues,
  }
}

/**
 * Rebuilds the cart from authoritative catalog records.
 *
 * A product with variants cannot be quoted without a variant, so a line that
 * omits the SKU is reported as unavailable instead of silently using the base
 * price. Unavailable lines stay in the response (the visitor can see what was
 * dropped) but never contribute to `subtotal` or `itemCount`.
 */
export function buildPublicCart(
  items: PublicCatalogItemDetail[],
  lines: PublicCartLineInput[],
  currency: string
): PublicCart {
  const itemsById = new Map(items.map(item => [item.id, item]))
  const result: PublicCartLine[] = []

  for (const input of lines) {
    const item = itemsById.get(input.itemId)
    if (!item) {
      result.push(unavailableLine(input, ['item_unavailable']))
      continue
    }

    const variant = input.variantSku
      ? item.variants.find(entry => entry.sku === input.variantSku)
      : undefined

    if ((input.variantSku && !variant) || (!input.variantSku && item.variants.length > 0)) {
      result.push(unavailableLine(input, ['variant_unavailable'], item))
      continue
    }

    const unitPrice = variant ? variant.price : item.price
    const inStock = item.inStock && (variant ? variant.inStock : true)
    const issues: PublicCartIssue[] = []

    if (input.expectedPrice !== undefined && roundMoney(input.expectedPrice) !== roundMoney(unitPrice)) {
      issues.push('price_changed')
    }

    if (!inStock) {
      issues.push('out_of_stock')
      result.push({
        ...unavailableLine(input, issues, item),
        unitPrice,
      })
      continue
    }

    result.push({
      itemId: item.id,
      variantSku: input.variantSku ?? null,
      name: item.name,
      path: item.path,
      unitPrice,
      quantity: input.quantity,
      lineTotal: roundMoney(unitPrice * input.quantity),
      available: true,
      issues,
    })
  }

  const subtotal = result.reduce((total, line) => total + line.lineTotal, 0)
  const itemCount = result.reduce((count, line) => count + (line.available ? line.quantity : 0), 0)
  const issues = PUBLIC_CART_ISSUE_CODES.filter(code => result.some(line => line.issues.includes(code)))

  return {
    lines: result,
    subtotal: roundMoney(subtotal),
    currency,
    itemCount,
    issues,
  }
}
