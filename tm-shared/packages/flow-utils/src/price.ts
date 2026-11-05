import type { ItemPrice } from './types'

interface VariantLike {
  salePrice?: number
  basePrice?: number
}

interface ItemLike {
  type?: string
  salePrice?: number
  basePrice?: number
  variants?: VariantLike[] | null
}

export const getItemDisplayPrice = (item?: ItemLike | null): ItemPrice => {
  if (!item) return { price: 0, basePrice: 0 }

  if (item.type !== 'variable' || !item.variants?.length) {
    return {
      price: item.salePrice || item.basePrice || 0,
      basePrice: item.basePrice || 0
    }
  }

  let minPrice = item.salePrice || item.basePrice || Infinity
  let minBasePrice = item.basePrice || Infinity

  for (const v of item.variants) {
    if (!v) continue
    const currentPrice = v.salePrice || v.basePrice || 0
    if (currentPrice > 0 && currentPrice < minPrice) minPrice = currentPrice
    const currentBase = v.basePrice || 0
    if (currentBase > 0 && currentBase < minBasePrice) minBasePrice = currentBase
  }

  return {
    price: minPrice === Infinity ? 0 : minPrice,
    basePrice: minBasePrice === Infinity ? 0 : minBasePrice
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