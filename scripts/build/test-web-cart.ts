import assert from 'node:assert/strict'
import {
  PUBLIC_CART_MAX_LINES,
  PUBLIC_CART_MAX_QUANTITY,
  PublicCartRequestSchema,
  PublicCartSchema,
  buildPublicCart,
  cartLineKey,
  type PublicCartLineInput,
} from '../../tm-shared/packages/flow-contracts/src/public-cart.js'
import type { PublicCatalogItemDetail } from '../../tm-shared/packages/flow-contracts/src/catalog.js'

let checks = 0

function check(name: string, fn: () => void) {
  try {
    fn()
    checks++
    console.log(`   ✅ ${name}`)
  } catch (error) {
    console.error(`   ❌ ${name}`)
    console.error(`      ${(error as Error).message}`)
    process.exitCode = 1
  }
}

function makeItem(overrides: Partial<PublicCatalogItemDetail> = {}): PublicCatalogItemDetail {
  return {
    id: '64b000000000000000000001',
    slug: { vi: 'ao-thun' },
    path: '/products/ao-thun',
    name: { vi: 'Áo thun', en: 'T-shirt' },
    price: 100000,
    currency: 'VND',
    categories: [],
    tags: [],
    inStock: true,
    gallery: [],
    variants: [],
    attributes: [],
    updatedAt: null,
    ...overrides,
  }
}

const line = (overrides: Partial<PublicCartLineInput> = {}): PublicCartLineInput => ({
  itemId: '64b000000000000000000001',
  quantity: 1,
  ...overrides,
})

console.log('Testing the public cart contract and builder...\n')

console.log('1. Request schema')

check('accepts a line with an expected price', () => {
  const parsed = PublicCartRequestSchema.parse({ lines: [line({ expectedPrice: 100000, quantity: 2 })] })
  assert.equal(parsed.lines.length, 1)
  assert.equal(parsed.lines[0].quantity, 2)
})

check('rejects an empty item id, zero quantity and quantity above the cap', () => {
  assert.equal(PublicCartRequestSchema.safeParse({ lines: [{ itemId: '', quantity: 1 }] }).success, false)
  assert.equal(PublicCartRequestSchema.safeParse({ lines: [{ itemId: 'x', quantity: 0 }] }).success, false)
  assert.equal(
    PublicCartRequestSchema.safeParse({ lines: [{ itemId: 'x', quantity: PUBLIC_CART_MAX_QUANTITY + 1 }] }).success,
    false
  )
})

check('rejects more lines than the cart cap', () => {
  const lines = Array.from({ length: PUBLIC_CART_MAX_LINES + 1 }, (_, index) => ({ itemId: `id-${index}`, quantity: 1 }))
  assert.equal(PublicCartRequestSchema.safeParse({ lines }).success, false)
})

console.log('\n2. Builder')

check('quotes a simple product from the catalog, not from the request', () => {
  const cart = buildPublicCart([makeItem()], [line({ quantity: 3, expectedPrice: 100000 })], 'VND')
  assert.equal(cart.lines[0].unitPrice, 100000)
  assert.equal(cart.lines[0].lineTotal, 300000)
  assert.equal(cart.subtotal, 300000)
  assert.equal(cart.itemCount, 3)
  assert.equal(cart.currency, 'VND')
  assert.deepEqual(cart.lines[0].issues, [])
})

check('uses the variant price when a SKU is stored', () => {
  const item = makeItem({
    price: 100000,
    variants: [
      { sku: 'AO-M', name: { vi: 'M' }, price: 120000, inStock: true },
      { sku: 'AO-L', name: { vi: 'L' }, price: 130000, inStock: true },
    ],
  })
  const cart = buildPublicCart([item], [line({ variantSku: 'AO-L', quantity: 2, expectedPrice: 130000 })], 'VND')
  assert.equal(cart.lines[0].variantSku, 'AO-L')
  assert.equal(cart.lines[0].unitPrice, 130000)
  assert.equal(cart.lines[0].lineTotal, 260000)
  assert.deepEqual(cart.lines[0].issues, [])
})

check('refuses to quote a variant product without a variant', () => {
  const item = makeItem({ variants: [{ sku: 'AO-M', price: 120000, inStock: true }] })
  const cart = buildPublicCart([item], [line()], 'VND')
  assert.equal(cart.lines[0].available, false)
  assert.deepEqual(cart.lines[0].issues, ['variant_unavailable'])
  assert.equal(cart.subtotal, 0)
  assert.equal(cart.itemCount, 0)
})

check('flags an unknown variant SKU', () => {
  const item = makeItem({ variants: [{ sku: 'AO-M', price: 120000, inStock: true }] })
  const cart = buildPublicCart([item], [line({ variantSku: 'AO-XL' })], 'VND')
  assert.deepEqual(cart.lines[0].issues, ['variant_unavailable'])
  assert.equal(cart.lines[0].available, false)
})

check('reports an unpublished or deleted item without leaking a price', () => {
  const cart = buildPublicCart([], [line({ itemId: '64b0000000000000000000ff', quantity: 2 })], 'VND')
  assert.deepEqual(cart.lines[0].issues, ['item_unavailable'])
  assert.equal(cart.lines[0].unitPrice, 0)
  assert.equal(cart.lines[0].lineTotal, 0)
  assert.deepEqual(cart.lines[0].name, {})
  assert.equal(cart.lines[0].path, undefined)
  assert.equal(cart.subtotal, 0)
})

check('keeps an out-of-stock line visible but out of the subtotal', () => {
  const item = makeItem({ inStock: false })
  const cart = buildPublicCart([item], [line({ quantity: 2 })], 'VND')
  assert.equal(cart.lines[0].available, false)
  assert.equal(cart.lines[0].unitPrice, 100000)
  assert.equal(cart.lines[0].lineTotal, 0)
  assert.deepEqual(cart.lines[0].issues, ['out_of_stock'])
  assert.equal(cart.subtotal, 0)
  assert.equal(cart.itemCount, 0)
  assert.deepEqual(cart.issues, ['out_of_stock'])
})

check('flags a moved price and still quotes the current one', () => {
  const cart = buildPublicCart([makeItem({ price: 120000 })], [line({ expectedPrice: 100000, quantity: 2 })], 'VND')
  assert.deepEqual(cart.lines[0].issues, ['price_changed'])
  assert.equal(cart.lines[0].unitPrice, 120000)
  assert.equal(cart.lines[0].lineTotal, 240000)
  assert.deepEqual(cart.issues, ['price_changed'])
})

check('rounds decimal line totals', () => {
  const cart = buildPublicCart([makeItem({ price: 10.005 })], [line({ quantity: 2 })], 'USD')
  assert.equal(cart.lines[0].lineTotal, 20.01)
  assert.equal(cart.subtotal, 20.01)
})

check('preserves input order and aggregates only available lines', () => {
  const items = [
    makeItem({ id: '64b000000000000000000001' }),
    makeItem({ id: '64b000000000000000000002', path: '/products/mu', name: { vi: 'Mũ' }, price: 50000 }),
    makeItem({ id: '64b000000000000000000003', inStock: false }),
  ]
  const cart = buildPublicCart(items, [
    line({ itemId: '64b000000000000000000002', quantity: 2 }),
    line({ itemId: '64b000000000000000000003' }),
    line({ itemId: '64b000000000000000000001' }),
  ], 'VND')

  assert.deepEqual(cart.lines.map(entry => entry.itemId), [
    '64b000000000000000000002',
    '64b000000000000000000003',
    '64b000000000000000000001',
  ])
  assert.equal(cart.subtotal, 200000)
  assert.equal(cart.itemCount, 3)
  assert.deepEqual(cart.issues, ['out_of_stock'])
})

check('the builder output satisfies the shared response schema', () => {
  const item = makeItem({ variants: [{ sku: 'AO-M', price: 120000, inStock: true }] })
  const cart = buildPublicCart([item], [line({ variantSku: 'AO-M', expectedPrice: 999 })], 'VND')
  assert.doesNotThrow(() => PublicCartSchema.parse(cart))
})

console.log('\n3. Client line identity')

check('the same product with different variants keeps separate keys', () => {
  assert.equal(cartLineKey({ itemId: 'a' }), 'a::')
  assert.notEqual(cartLineKey({ itemId: 'a', variantSku: 'M' }), cartLineKey({ itemId: 'a', variantSku: 'L' }))
  assert.equal(cartLineKey({ itemId: 'a', variantSku: 'M' }), cartLineKey({ itemId: 'a', variantSku: 'M' }))
})

if (process.exitCode) {
  console.error(`\n${checks} checks passed before the failure.`)
} else {
  console.log(`\n🎉 ${checks} cart checks passed successfully!`)
}
