import assert from 'node:assert/strict'
import {
  PublicCheckoutRequestSchema,
  PublicCheckoutResponseSchema,
  checkoutBlockingLines,
  checkoutOrderCode,
} from '../../tm-shared/packages/flow-contracts/src/public-checkout.js'
import { buildPublicCart, type PublicCartLineInput } from '../../tm-shared/packages/flow-contracts/src/public-cart.js'
import type { PublicCatalogItemDetail } from '../../tm-shared/packages/flow-contracts/src/catalog.js'

let checks = 0

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    checks++
    console.log(`   ✅ ${name}`)
  } catch (error) {
    console.error(`   ❌ ${name}`)
    console.error(`      ${(error as Error).message}`)
    process.exitCode = 1
  }
}

const CUSTOMER = { fullName: 'Nguyễn Văn A', phone: '0901234567', email: 'A@Example.COM' }
const ADDRESS = { street: '12 Lê Lợi', city: 'Hồ Chí Minh' }
const LINES: PublicCartLineInput[] = [{ itemId: '0123456789abcdef01234567', quantity: 2 }]

function item(overrides: Partial<PublicCatalogItemDetail> = {}): PublicCatalogItemDetail {
  return {
    id: '0123456789abcdef01234567',
    slug: { vi: 'ao-thu' },
    path: '/san-pham/ao-thu',
    name: { vi: 'Áo thử' },
    price: 120000,
    currency: 'VND',
    thumbnail: null,
    categories: [],
    tags: [],
    inStock: true,
    updatedAt: null,
    gallery: [],
    variants: [],
    attributes: [],
    sku: 'SKU-1',
    uom: null,
    ...overrides,
  } as PublicCatalogItemDetail
}

console.log('Checkout — guest order contract\n')

await check('order code is deterministic and bounded', async () => {
  const first = checkoutOrderCode('checkout-key-0000000001')
  assert.equal(first, checkoutOrderCode('checkout-key-0000000001'))
  assert.match(first, /^WEB-[0-9A-F]{8}$/)
})

await check('a different submit key produces another code', async () => {
  assert.notEqual(checkoutOrderCode('checkout-key-0000000001'), checkoutOrderCode('checkout-key-0000000002'))
})

await check('a guest payload parses with COD and address defaults', async () => {
  const parsed = PublicCheckoutRequestSchema.parse({
    lines: LINES,
    customer: CUSTOMER,
    shippingAddress: ADDRESS,
  })
  assert.equal(parsed.paymentMethod, 'cod')
  assert.equal(parsed.shippingAddress.country, 'Việt Nam')
  assert.equal(parsed.customer.email, 'a@example.com')
  assert.equal(parsed.note, '')
})

await check('an empty cart is rejected', async () => {
  assert.equal(PublicCheckoutRequestSchema.safeParse({ lines: [], customer: CUSTOMER, shippingAddress: ADDRESS }).success, false)
})

await check('a malformed phone or missing street is rejected', async () => {
  assert.equal(PublicCheckoutRequestSchema.safeParse({
    lines: LINES,
    customer: { ...CUSTOMER, phone: 'abc' },
    shippingAddress: ADDRESS,
  }).success, false)
  assert.equal(PublicCheckoutRequestSchema.safeParse({
    lines: LINES,
    customer: CUSTOMER,
    shippingAddress: { city: 'Hồ Chí Minh' },
  }).success, false)
})

await check('an out-of-stock line blocks checkout', async () => {
  const cart = buildPublicCart([item({ inStock: false })], LINES, 'VND')
  const blocked = checkoutBlockingLines(cart)
  assert.equal(blocked.length, 1)
  assert.ok(blocked[0]!.issues.includes('out_of_stock'))
})

await check('a capped quantity blocks checkout', async () => {
  const cart = buildPublicCart([item({ maxQuantity: 1 })], LINES, 'VND')
  const blocked = checkoutBlockingLines(cart)
  assert.equal(blocked.length, 1)
  assert.ok(blocked[0]!.issues.includes('quantity_reduced'))
  assert.equal(blocked[0]!.quantity, 1)
})

await check('an unknown item blocks checkout', async () => {
  const cart = buildPublicCart([], LINES, 'VND')
  const blocked = checkoutBlockingLines(cart)
  assert.equal(blocked.length, 1)
  assert.ok(blocked[0]!.issues.includes('item_unavailable'))
})

await check('a price change alone does not block: the server price wins', async () => {
  const cart = buildPublicCart(
    [item()],
    [{ ...LINES[0]!, expectedPrice: 99000 }],
    'VND',
  )
  assert.deepEqual(checkoutBlockingLines(cart), [])
  assert.equal(cart.lines[0]!.unitPrice, 120000)
})

await check('the response carries no internal ids', async () => {
  const parsed = PublicCheckoutResponseSchema.parse({
    success: true,
    data: {
      code: 'WEB-1A2B3C4D',
      status: 'pending',
      paymentStatus: 'unpaid',
      currency: 'VND',
      totalAmount: 240000,
      itemCount: 2,
      items: [{ name: { vi: 'Áo thử' }, quantity: 2, unitPrice: 120000, lineTotal: 240000 }],
    },
  })
  assert.equal(parsed.data.items.length, 1)
  assert.equal(Object.keys(parsed.data).includes('id'), false)
})

console.log(`\n${process.exitCode ? '❌' : '✅'} Checkout checks: ${checks} passed\n`)
