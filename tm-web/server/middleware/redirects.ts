/**
 * Legacy URL redirects.
 *
 * Runs before the router for document requests: a path present in the CMS
 * redirect map answers a 301/302 to its target instead of a 404. API routes,
 * Nuxt build assets and anything with a file extension (sitemap, robots, images)
 * are never redirected, and a map row is skipped when the site has no Mongo
 * binding, so a CMS-only or unconfigured deployment keeps rendering normally.
 */
export default defineEventHandler(async (event) => {
  const method = event.method
  if (method !== 'GET' && method !== 'HEAD') return

  const url = getRequestURL(event)
  const path = url.pathname
  if (path === '/') return
  if (path.startsWith('/api/') || path.startsWith('/_nuxt') || path.startsWith('/__nuxt')) return
  if (/\.[a-z0-9]{1,8}$/i.test(path)) return

  // A site without a Mongo binding serves its static shell; nothing to look up.
  const config = useRuntimeConfig(event)
  if (!String(config.mongoUri || '').trim() || !String(config.catalogDbName || '').trim()) return

  try {
    const redirect = await findRedirect(event, path)
    if (!redirect) return

    setHeader(event, 'Cache-Control', 'no-store')
    return sendRedirect(event, redirect.to, redirect.statusCode)
  } catch {
    // A redirect lookup must never turn a renderable page into a 500.
    return
  }
})
