export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const baseUrl = getSiteBaseUrl(event)
  const indexable = config.public.indexable !== false

  const lines = indexable
    ? [
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /preview/',
        'Disallow: /admin/',
        'Disallow: /login',
        '',
        `Sitemap: ${baseUrl}/sitemap.xml`,
        '',
      ]
    : [
        'User-agent: *',
        'Disallow: /',
        '',
      ]

  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=300, s-maxage=600')

  return lines.join('\n')
})
