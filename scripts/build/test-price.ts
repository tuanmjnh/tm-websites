import assert from 'node:assert/strict'
import { effectivePrice, getItemPriceRange } from '../../tm-shared/packages/flow-utils/src/price.js'

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

check('effectivePrice prefers a set sale price', () => {
  assert.equal(effectivePrice({ basePrice: 100, salePrice: 80 }), 80)
})

check('effectivePrice falls back to base price when sale price is null', () => {
  assert.equal(effectivePrice({ basePrice: 100, salePrice: null }), 100)
})

check('effectivePrice treats a zero sale price as no sale', () => {
  assert.equal(effectivePrice({ basePrice: 100, salePrice: 0 }), 100)
})

check('effectivePrice returns 0 when neither price exists', () => {
  assert.equal(effectivePrice({ basePrice: 0, salePrice: 0 }), 0)
  assert.equal(effectivePrice({ basePrice: undefined, salePrice: null }), 0)
})

check('effectivePrice handles a missing entry', () => {
  assert.equal(effectivePrice(null), 0)
  assert.equal(effectivePrice(undefined), 0)
})

check('getItemPriceRange: simple product with a sale price', () => {
  assert.deepEqual(getItemPriceRange({ type: 'simple', basePrice: 100, salePrice: 80 }), { min: 80, max: 80 })
})

check('getItemPriceRange: simple product, sale price null', () => {
  assert.deepEqual(getItemPriceRange({ type: 'simple', basePrice: 100, salePrice: null }), { min: 100, max: 100 })
})

check('getItemPriceRange: simple product, sale price zero counts as no sale', () => {
  assert.deepEqual(getItemPriceRange({ type: 'simple', basePrice: 100, salePrice: 0 }), { min: 100, max: 100 })
})

check('getItemPriceRange: product without variants uses its own price', () => {
  assert.deepEqual(getItemPriceRange({ type: 'variable', basePrice: 50, salePrice: 40, variants: [] }), { min: 40, max: 40 })
  assert.deepEqual(getItemPriceRange({ type: 'variable', basePrice: 50, salePrice: 40, variants: null }), { min: 40, max: 40 })
})

check('getItemPriceRange: variable product spans variant prices', () => {
  const item = {
    type: 'variable',
    basePrice: 0,
    salePrice: null,
    variants: [
      { basePrice: 100, salePrice: 90 },
      { basePrice: 200, salePrice: null },
      { basePrice: 150, salePrice: 0 },
    ],
  }
  // variant effective prices: 90, 200, 150
  assert.deepEqual(getItemPriceRange(item), { min: 90, max: 200 })
})

check('getItemPriceRange: mixed discounted and full-price variants', () => {
  const item = {
    type: 'variable',
    variants: [
      { basePrice: 100, salePrice: 80 },
      { basePrice: 120, salePrice: null },
    ],
  }
  assert.deepEqual(getItemPriceRange(item), { min: 80, max: 120 })
})

check('getItemPriceRange: missing item', () => {
  assert.deepEqual(getItemPriceRange(null), { min: 0, max: 0 })
  assert.deepEqual(getItemPriceRange(undefined), { min: 0, max: 0 })
})

console.log(`\n${checks} checks passed`)
if (process.exitCode) {
  console.error('Price checks failed')
}