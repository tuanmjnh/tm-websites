import type { ImageLike, ImageStorageMode } from './types'
import { encodeBase64 } from './base64'
import { isRawSvg } from './svg'

export const isSpecialImage = (url?: unknown): boolean => {
  if (typeof url !== 'string') return false
  const u = (url || '').toLowerCase()
  return u.match(/\.(ico|svg)$/) !== null
}

export const isImage = (url?: unknown): boolean => {
  if (!url || typeof url !== 'string') return false
  const u = url.trim().toLowerCase()
  if (isSpecialImage(u)) return true
  if (u.match(/\.(jpeg|jpg|gif|png|webp)$/) !== null) return true
  if (u.startsWith('http') || u.startsWith('/')) return true
  return false
}

export const detectDisplayType = (val?: string): 'svg' | 'image' | 'icon' => {
  if (!val) return 'icon'
  if (isRawSvg(val)) return 'svg'
  if (isImage(val)) return 'image'
  return 'icon'
}

export const formatImageUrl = (img: string | ImageLike | undefined, siteUrl?: string): string | undefined => {
  if (!img) return undefined
  let url = ''

  if (typeof img === 'object') {
    url = img.url || ''
  } else if (typeof img === 'string') {
    url = img.trim()
  }

  if (!url) return undefined

  if (url.startsWith('<svg')) {
    try {
      return `data:image/svg+xml;base64,${encodeBase64(url)}`
    } catch {
      return undefined
    }
  }

  if (siteUrl && url.startsWith('/') && !url.startsWith('//')) {
    return `${siteUrl.replace(/\/$/, '')}${url}`
  }

  return url
}

export const cleanImageUrl = (url: string): string => {
  if (!url || typeof url !== 'string' || url.startsWith('data:') || url.startsWith('<svg')) return url

  try {
    const urlObj = new URL(url)
    if (urlObj.hostname.includes('unsplash.com') || urlObj.hostname.includes('cloudinary.com')) {
      const searchParams = urlObj.searchParams
      searchParams.delete('w')
      searchParams.delete('h')
      searchParams.delete('width')
      searchParams.delete('height')
      searchParams.delete('fit')
      searchParams.delete('crop')
      return urlObj.origin + urlObj.pathname + (searchParams.toString() ? '?' + searchParams.toString() : '')
    }
  } catch {
    return url
  }

  return url
}

export const getImage = (img: unknown, customKey?: string | string[]): string => {
  if (!img) return '/placeholder.png'
  if (typeof img === 'string') return img

  const record = img as Record<string, unknown>
  const keys = Array.isArray(customKey) ? customKey : [customKey || 'url']

  for (const key of keys) {
    const value = record[key]
    if (value) return String(value)
  }

  return '/placeholder.png'
}

export const formatImage = (img: ImageLike | string | undefined | null, mode: ImageStorageMode = 'string'): ImageLike | string | null => {
  if (!img) return null
  if (mode === 'string') {
    return typeof img === 'string' ? img : (img.url || img.secure_url || img)
  }
  return img
}

export const ObjectToImageString = (
  data: unknown,
  mode: ImageStorageMode = 'string',
  customKeys?: string[]
): unknown => {
  if (!data || typeof data !== 'object' || mode === 'object') return data

  const targetKeys = customKeys || ['avatar', 'image', 'thumb', 'thumbnail', 'logo', 'favicon', 'icon', 'banner', 'url', 'qrCode']

  if (Array.isArray(data)) {
    return data.map(item => ObjectToImageString(item, mode, targetKeys))
  }

  const result: Record<string, unknown> = { ...(data as Record<string, unknown>) }

  for (const key in result) {
    const value = result[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>
      if (targetKeys.includes(key.toLowerCase()) && typeof record.url === 'string') {
        result[key] = record.url
      } else {
        result[key] = ObjectToImageString(record, mode, targetKeys)
      }
    }
  }

  return result
}