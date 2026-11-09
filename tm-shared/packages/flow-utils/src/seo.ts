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

/**
 * robots.txt body for a deployment. A non-indexable deployment (preview) blocks
 * every crawler; otherwise only the API and the query-dependent search page are
 * excluded, and the sitemap is advertised on the canonical origin.
 */
export function buildRobotsTxt(baseUrl: string, indexable: boolean): string {
  if (!indexable) return 'User-agent: *\nDisallow: /\n'

  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /tim-kiem',
    '',
    `Sitemap: ${normalizeSiteBaseUrl(baseUrl)}/sitemap.xml`,
    '',
  ].join('\n')
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

/**
 * Applies the title template saved in site settings to one page title.
 *
 * `%s` stands for the page's own title, so `%s | Sen Tuấn` reproduces the legacy
 * `Page | Company` pattern. A template without the placeholder is treated as the
 * suffix, and an empty template (or the `%s` default) leaves the title as it is.
 * Separators left behind by an empty page title are trimmed instead of rendering
 * a `<title>` that starts with `|`.
 */
export function applySeoTitleTemplate(pageTitle: string, template: string): string {
  const title = String(pageTitle ?? '').trim()
  const raw = String(template ?? '').trim()

  if (!raw || raw === '%s') return title

  // A page that already names the company (the home page is just the brand) would
  // otherwise read `Sen Tuấn · Sen Tuấn`, so the suffix is skipped when it is
  // already part of the title once separators are ignored.
  const suffix = raw.replace(/%s/g, '').replace(/[|·—-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (suffix && title.toLowerCase().includes(suffix.toLowerCase())) return title

  if (!raw.includes('%s')) return title ? `${title} | ${raw}` : raw

  const filled = raw.replace(/%s/g, title)
  if (title) return filled
  return filled.replace(/^\s*[|·—-]\s*/, '').replace(/\s*[|·—-]\s*$/, '').trim()
}
