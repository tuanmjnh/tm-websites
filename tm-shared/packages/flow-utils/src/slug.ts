import type { CategoryLike, LocalizedPathOptions, LocalizedString } from './types'

export const toSlug = (str: string): string => {
  return str
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/([^0-9a-z-\s])/g, '')
    .replace(/(\s+)/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const slugify = toSlug

export const toNormalize = (string: string): string => {
  if (!string) return ''
  return string
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
}

export const toCode = (str: string): string => toSlug(str).replace(/-/g, '_').toUpperCase()

export const ensureForwardSlash = (url: string): string => {
  if (!url || typeof url !== 'string') return url
  const u = url.trim()
  if (u.startsWith('http') || u.startsWith('data:') || u.startsWith('/') || u.startsWith('<svg')) return u
  return '/' + u
}

export const escapeRegExp = (string: string): string => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const escapeNormalize = (string: string): string => escapeRegExp(toNormalize(string))

export const calculateLocalizedPath = (pathOptions: LocalizedPathOptions): string => {
  const { slug, type, urlMode = 'category', parentPath } = pathOptions
  if (!slug) return ''

  if (urlMode === 'flat') return slug
  if (urlMode === 'prefix' && type) return `${type}/${slug}`
  if (urlMode === 'category' && parentPath) return `${parentPath}/${slug}`

  return slug
}

export const generateSlug = (
  title: LocalizedString,
  code: string,
  parentId?: string | null,
  categories?: CategoryLike[]
): string => {
  if (!title || !title[code]) return ''

  let slugValue = toSlug(title[code])

  if (parentId && categories) {
    const parent = categories.find(c => c._id === parentId)
    if (parent?.slug?.[code]) {
      slugValue = `${parent.slug[code]}-${slugValue}`
    }
  }

  return slugValue
}