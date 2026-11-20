import assert from 'node:assert/strict'
import {
  OrderLookupRequestSchema,
  OrderLookupResponseSchema,
  normalizeLookupPhone,
  orderLookupCode,
} from '../../tm-shared/packages/flow-contracts/src/public-order-lookup.js'

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

const ORDER = {
  code: 'WEB-9423BFC2',
  status: 'pending',
  paymentStatus: 'unpaid',
  paymentMethod: 'banking',
  currency: 'VND',
  totalAmount: 2190000,
  itemCount: 1,
  items: [{ name: { vi: 'Đệm bông' }, quantity: 1, unitPrice: 2190000, lineTotal: 2190000 }],
  createdAt: '2026-11-20T09:30:00.000Z',
}

console.log('Order lookup — guest order contract\n')

await check('a code is shown uppercase without surrounding whitespace', async () => {
  assert.equal(orderLookupCode('  web-9423bfc2 '), 'WEB-9423BFC2')
})

await check('phone comparison ignores separators and the +84 prefix', async () => {
  assert.equal(normalizeLookupPhone('+84 90 123 4567'), '0901234567')
  assert.equal(normalizeLookupPhone('0901 234 567'), '0901234567')
  assert.equal(normalizeLookupPhone('84-901-234-567'), '0901234567')
})

await check('a local number keeps its leading zero', async () => {
  assert.equal(normalizeLookupPhone('0912345678'), '0912345678')
})

await check('the request normalizes the code it received', async () => {
  const parsed = OrderLookupRequestSchema.parse({ code: ' web-9423bfc2 ', phone: '+84 90 123 4567' })
  assert.equal(parsed.code, 'WEB-9423BFC2')
  assert.equal(parsed.phone, '+84 90 123 4567')
})

await check('an empty code or a too-short phone is rejected', async () => {
  assert.equal(OrderLookupRequestSchema.safeParse({ code: '', phone: '0901234567' }).success, false)
  assert.equal(OrderLookupRequestSchema.safeParse({ code: 'WEB-9423BFC2', phone: '0901' }).success, false)
  assert.equal(OrderLookupRequestSchema.safeParse({ code: 'WEB-9423BFC2', phone: 'abc' }).success, false)
})

await check('a response parses with a nullable payment method and date', async () => {
  const parsed = OrderLookupResponseSchema.parse({ success: true, data: { ...ORDER, paymentMethod: null, createdAt: null } })
  assert.equal(parsed.data.paymentMethod, null)
  assert.equal(parsed.data.createdAt, null)
})

await check('the response carries no internal ids, address or customer', async () => {
  const parsed = OrderLookupResponseSchema.parse({ success: true, data: ORDER })
  const keys = Object.keys(parsed.data)
  for (const forbidden of ['id', '_id', 'customerId', 'shippingAddress', 'phone']) {
    assert.equal(keys.includes(forbidden), false, `${forbidden} must not be exposed`)
  }
  assert.equal(parsed.data.items.length, 1)
})

console.log(`\n${process.exitCode ? '❌' : '✅'} Order lookup checks: ${checks} passed\n`)
