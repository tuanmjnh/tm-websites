import assert from 'node:assert/strict'
import { toCatalogItemDetail } from '../../tm-web/server/utils/catalogMapper.js'
import {
  buildVariantOptionGroups,
  isVariantOptionAvailable,
  selectVariantWithOption,
  variantMatchesSelection,
  variantSelection,
} from '../../tm-shared/nuxt-layers/web-base/app/utils/variantOptions.js'

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

function option(size: string, colour: string) {
  return [
    { name: { vi: 'Kích thước', en: 'Size' }, value: { vi: size, en: size } },
    { name: { vi: 'Màu sắc', en: 'Colour' }, value: { vi: colour, en: colour === 'Trắng' ? 'White' : 'Black' } },
  ]
}

// S/Trắng, S/Đen and M/Trắng exist; M/Đen does not.
const product = {
  _id: '64b000000000000000000001',
  title: { vi: 'Áo thun' },
  slug: { vi: 'ao-thun' },
  type: 'variable',
  basePrice: 100000,
  variants: [
    { sku: 'S-TRANG', basePrice: 100000, stock: 4, attributes: option('S', 'Trắng') },
    { sku: 'S-DEN', basePrice: 100000, salePrice: 90000, stock: 2, attributes: option('S', 'Đen') },
    { sku: 'M-TRANG', basePrice: 120000, stock: 0, attributes: option('M', 'Trắng') },
    { sku: 'X-OFF', basePrice: 50000, stock: 1, isActive: false, attributes: option('X', 'Xám') },
  ],
}

const detail = toCatalogItemDetail(product, { currency: 'VND', categoriesById: new Map() })
const variants = detail?.variants ?? []

check('the product detail carries each variant option, not just the joined label', () => {
  assert.equal(variants.length, 3, 'an inactive variant is not for sale')
  assert.deepEqual(variants[0]?.attributes, [
    { name: { vi: 'Kích thước', en: 'Size' }, value: { vi: 'S', en: 'S' } },
    { name: { vi: 'Màu sắc', en: 'Colour' }, value: { vi: 'Trắng', en: 'White' } },
  ])
  assert.equal(variants[0]?.name?.vi, 'S / Trắng', 'the label still reads as one line')
  assert.equal(variants[2]?.inStock, false)
})

check('one chip group per option, ordered by first appearance', () => {
  const groups = buildVariantOptionGroups(variants)
  assert.deepEqual(groups.map(group => group.label), ['Kích thước', 'Màu sắc'])
  assert.deepEqual(groups.map(group => group.values.map(value => value.label)), [['S', 'M'], ['Trắng', 'Đen']])
})

check('labels follow the visitor locale while keys stay Vietnamese', () => {
  const groups = buildVariantOptionGroups(variants, 'en')
  assert.equal(groups[0]?.label, 'Size')
  assert.deepEqual(groups[1]?.values.map(value => value.label), ['White', 'Black'])
  assert.deepEqual(groups[1]?.values.map(value => value.key), ['Trắng', 'Đen'])
})

check('the selected variant marks its own option chips', () => {
  assert.deepEqual(variantSelection(variants[1]), { 'Kích thước': 'S', 'Màu sắc': 'Đen' })
  assert.deepEqual(variantSelection(null), {})
})

check('a chip keeps the other choices and resolves the variant it would sell', () => {
  const chosen = selectVariantWithOption(variants, variants[0], 'Màu sắc', 'Đen')
  assert.equal(chosen?.sku, 'S-DEN')
  assert.equal(selectVariantWithOption(variants, variants[0], 'Kích thước', 'M'), variants[2])
  // From S/Đen there is no M/Đen, so that chip keeps the colour and finds nothing.
  assert.equal(selectVariantWithOption(variants, variants[1], 'Kích thước', 'M'), null)
})

check('a combination the catalog does not hold is reported unavailable', () => {
  // From M/Trắng there is no black M variant.
  assert.equal(isVariantOptionAvailable(variants, variants[2], 'Màu sắc', 'Đen'), false)
  assert.equal(selectVariantWithOption(variants, variants[2], 'Màu sắc', 'Đen'), null)
  assert.equal(isVariantOptionAvailable(variants, variants[0], 'Màu sắc', 'Đen'), true)
})

check('a variant without options matches an empty selection, and extra options are allowed', () => {
  assert.equal(variantMatchesSelection({ sku: 'X' }, {}), true)
  assert.equal(variantMatchesSelection(variants[0]!, { 'Kích thước': 'S' }), true)
  assert.equal(variantMatchesSelection(variants[0]!, { 'Kích thước': 'M' }), false)
})

check('a simple product has no chip groups', () => {
  assert.deepEqual(buildVariantOptionGroups([]), [])
  assert.deepEqual(buildVariantOptionGroups([{ sku: 'ONLY' }]), [])
})

console.log(`\n${checks} checks passed`)
if (process.exitCode) console.error('Variant option checks failed')
