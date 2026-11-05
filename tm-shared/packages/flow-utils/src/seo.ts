/**
 * Canonical URL, sitemap and XML helpers for the public storefront.
 */

export interface SitemapPage {
  path: string
  lastmod?: string | null
}

export interface SitemapEntry {
  loc: string
  lastmod?: string | null
}

export function normalizeSiteBaseUrl(value: string): string {
  return String(value ?? '').trim().replace(/\/+$/, '')
}

export function buildCanonicalUrl(baseUrl: string, path: string): string {
  const base = normalizeSiteBaseUrl(baseUrl)
  const raw = String(path ?? '').trim()
  const withoutHash = raw.split('#')[0] ?? ''
  const withoutQuery = withoutHash.split('?')[0] ?? ''
  const clean = withoutQuery.replace(/^\/+/, '').replace(/\/+$/, '')
  return clean ? `${base}/${clean}` : `${base}/`
}

export function resolveSiteUrl(baseUrl: string, value: string | null | undefined): string {
  if (!value) return ''
  const raw = String(value).trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('//')) return `https:${raw}`
  return buildCanonicalUrl(baseUrl, raw)
}

export function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildSitemapEntries(baseUrl: string, pages: SitemapPage[]): SitemapEntry[] {
  const entries: SitemapEntry[] = [{ loc: buildCanonicalUrl(baseUrl, '/') }]
  const seen = new Set(entries.map(entry => entry.loc))

  for (const page of pages) {
    if (!page?.path) continue
    const loc = buildCanonicalUrl(baseUrl, page.path)
    if (seen.has(loc)) continue
    seen.add(loc)
    entries.push(page.lastmod ? { loc, lastmod: page.lastmod } : { loc })
  }

  return entries
}

export function buildSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((entry) => {
      const lines = [`    <loc>${escapeXml(entry.loc)}</loc>`]
      if (entry.lastmod) lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`)
      return `  <url>\n${lines.join('\n')}\n  </url>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}
