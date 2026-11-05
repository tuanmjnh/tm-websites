import { encodeBase64 } from './base64'
import { escapeRegExp } from './slug'

export const minifySvg = (svg: string): string => {
  return svg
    .trim()
    .replace(/<!--.*?-->/gs, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .replace(/\r?\n|\r/g, '')
}

export const isRawSvg = (val?: string): boolean => {
  if (!val || typeof val !== 'string') return false
  const trimmed = val.trim()
  return (trimmed.startsWith('<svg') || trimmed.startsWith('<?xml')) && trimmed.includes('<svg')
}

export const isIconify = (url?: string): boolean => {
  if (!url) return false
  const u = typeof url === 'string' ? url.trim() : url
  if (u.startsWith('<svg')) return false
  return (u.includes(':') || u.startsWith('i-')) && !u.startsWith('http') && !u.startsWith('/')
}

export const getFaviconHref = (val?: string): string => {
  if (!val) return '/favicon.ico'
  const trimmed = val.trim()
  if (trimmed.startsWith('<svg')) {
    try {
      return `data:image/svg+xml;base64,${encodeBase64(trimmed)}`
    } catch {
      return '/favicon.ico'
    }
  }
  return val
}

export const sanitizeSvg = (svg: string, prefix?: string): string => {
  if (!svg || typeof svg !== 'string') return ''
  let content = svg.trim()

  const svgMatch = content.match(/<svg[^>]*>/i)
  if (!svgMatch) return content

  const openingTag = svgMatch[0]
  let sanitizedTag = openingTag
    .replace(/\s+(width|height)=["'][^"']*["']/gi, '')
    .replace(/\s+(width|height)=[^ >"']+/gi, '')

  if (!/viewBox=/i.test(openingTag)) {
    const wMatch = openingTag.match(/\bwidth=["']?(\d+(\.\d+)?)px?["']?/i)
    const hMatch = openingTag.match(/\bheight=["']?(\d+(\.\d+)?)px?["']?/i)
    if (wMatch && hMatch) {
      sanitizedTag = sanitizedTag.replace(/<svg/i, `<svg viewBox="0 0 ${wMatch[1]} ${hMatch[1]}"`)
    }
  }

  content = content.replace(openingTag, sanitizedTag)

  const filterMatches = Array.from(content.matchAll(/filter=["']url\(#([^)'"]+)\)["']/gi))
  for (const match of filterMatches) {
    const filterId = match[1]
    if (!filterId) continue
    const hasFilterDef = new RegExp(`<filter[^>]*id=["']${filterId}["']`, 'i').test(content)
    if (!hasFilterDef) content = content.replace(match[0], '')
  }

  const isClient = typeof globalThis !== 'undefined' && 'window' in globalThis
  const effectivePrefix = prefix || (isClient ? `s-${Math.random().toString(36).slice(2, 8)}` : undefined)
  if (effectivePrefix) {
    const cleanPrefix = effectivePrefix.replace(/[^a-zA-Z0-9_-]/g, '')
    const idMatches = Array.from(content.matchAll(/\bid=["']([^"']+)["']/gi))
    for (const match of idMatches) {
      const oldId = match[1]
      if (!oldId) continue
      const newId = `${cleanPrefix}-${oldId}`
      const escapedOldId = escapeRegExp(oldId)
      content = content
        .replace(new RegExp(`\\bid=["']${escapedOldId}["']`, 'gi'), `id="${newId}"`)
        .replace(new RegExp(`url\\(\\s*['"]?#${escapedOldId}['"]?\\s*\\)`, 'gi'), `url(#${newId})`)
        .replace(new RegExp(`\\bhref=["']#${escapedOldId}["']`, 'gi'), `href="#${newId}"`)
        .replace(new RegExp(`\\bxlink:href=["']#${escapedOldId}["']`, 'gi'), `xlink:href="#${newId}"`)
    }
  }

  return content
}