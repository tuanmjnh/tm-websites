import type { ItemPrice } from './types'

interface VariantLike {
  salePrice?: number | null
  basePrice?: number
}

interface ItemLike {
  type?: string
  salePrice?: number | null
  basePrice?: number
  variants?: VariantLike[] | null
}

/**
 * What a customer actually pays: the sale price when there is one, the base price
 * otherwise. The one rule the storefront and the CMS both have to agree on.
 */
export const effectivePrice = (entry?: VariantLike | null): number =>
  entry?.salePrice || entry?.basePrice || 0

/**
 * The cheapest and dearest price a customer could pay. A variable item's own
 * `basePrice`/`salePrice` are a summary of its variants, so the variants decide.
 */
export const getItemPriceRange = (item?: ItemLike | null): { min: number, max: number } => {
  if (!item) return { min: 0, max: 0 }

  const prices = item.type === 'variable' && item.variants?.length
    ? item.variants.map(variant => effectivePrice(variant))
    : [effectivePrice(item)]

  return { min: Math.min(...prices), max: Math.max(...prices) }
}

export const getItemDisplayPrice = (item?: ItemLike | null): ItemPrice => {
  if (!item) return { price: 0, basePrice: 0 }

  if (item.type !== 'variable' || !item.variants?.length) {
    return {
      price: effectivePrice(item),
      basePrice: item.basePrice || 0
    }
  }

  // A variable product is priced by its variants; its own basePrice/salePrice are
  // only a summary, so they must not drag the minimum below (or above) what the
  // variants actually cost.
  const variants = item.variants.filter((variant): variant is VariantLike => Boolean(variant))
  const prices = variants.map(variant => effectivePrice(variant)).filter(price => price > 0)
  const bases = variants.map(variant => variant.basePrice || 0).filter(base => base > 0)

  return {
    price: prices.length ? Math.min(...prices) : 0,
    basePrice: bases.length ? Math.min(...bases) : 0
  }
}

export const numberToVietnameseWords = (amount: number): string => {
  const n = Math.round(Math.abs(amount))
  if (n === 0) return 'Không đồng'
  const digits = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']
  const units = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ']

  const readThreeDigits = (num: number, isHighest: boolean): string[] => {
    const h = Math.floor(num / 100)
    const t = Math.floor((num % 100) / 10)
    const o = num % 10
    const words: string[] = []

    if (h > 0 || !isHighest) {
      words.push(digits[h] as string, 'trăm')
    }

    if (t > 1) {
      words.push(digits[t] as string, 'mươi')
      if (o === 1) words.push('mốt')
      else if (o === 5) words.push('lăm')
      else if (o > 0) words.push(digits[o] as string)
    } else if (t === 1) {
      words.push('mười')
      if (o === 5) words.push('lăm')
      else if (o > 0) words.push(digits[o] as string)
    } else if (t === 0) {
      if (h > 0 || !isHighest) {
        if (o > 0) words.push('lẻ', digits[o] as string)
      } else if (o > 0) {
        words.push(digits[o] as string)
      }
    }

    return words
  }

  const str = n.toString()
  const groups: number[] = []
  for (let i = str.length; i > 0; i -= 3) {
    groups.unshift(Number(str.substring(Math.max(0, i - 3), i)))
  }

  const resultWords: string[] = []
  const totalGroups = groups.length

  for (let i = 0; i < totalGroups; i++) {
    const groupVal = groups[i] as number
    if (groupVal === 0) continue
    const groupWords = readThreeDigits(groupVal, i === 0)
    const unitIdx = totalGroups - 1 - i
    const unit = units[unitIdx % units.length] as string
    resultWords.push(...groupWords)
    if (unit) resultWords.push(unit)
  }

  const text = resultWords.join(' ').trim()
  if (!text) return 'Không đồng'
  const capitalized = text.charAt(0).toUpperCase() + text.slice(1)
  return `${capitalized} đồng chẵn`
}