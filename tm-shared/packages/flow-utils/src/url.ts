import type { AlternateLink, LocaleLike } from './types'

export const getCanonicalUrl = (siteUrl: string, currentPath: string): string => {
  const p = currentPath === '/' ? '' : currentPath
  const baseUrl = (siteUrl || '').replace(/\/$/, '')
  return `${baseUrl}${p}`
}

export const getAlternateLinks = (siteUrl: string, currentPath: string, locales: LocaleLike[]): AlternateLink[] => {
  const baseUrl = (siteUrl || '').replace(/\/$/, '')
  const links: AlternateLink[] = locales.map(l => {
    const localePath = currentPath.startsWith(`/${l.code}/`) || currentPath === `/${l.code}`
      ? currentPath
      : (l.code === 'vi' ? currentPath : `/${l.code}${currentPath}`)

    return {
      rel: 'alternate',
      hreflang: l.iso || l.code,
      href: `${baseUrl}${localePath}`
    }
  })

  links.push({
    rel: 'alternate',
    hreflang: 'x-default',
    href: `${baseUrl}${currentPath}`
  })

  return links
}

export const getFlagEmoji = (code: string): string => {
  const country = code.split('-').pop()?.toUpperCase() ?? code.slice(0, 2).toUpperCase()
  return [...country].map(c => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0))).join('')
}