/**
 * A path the redirect map marks gone (`410`).
 *
 * The server middleware only flags the request, because a Nitro-level error
 * there would replace the site's own error page with a bare response. This runs
 * before any page and turns the flag into a real 410 on the rendered page.
 */
export default defineNuxtRouteMiddleware(() => {
  if (!import.meta.server) return
  const event = useRequestEvent()
  if (!event?.context.publicGone) return
  throw createError({ statusCode: 410, statusMessage: 'error.contentGone', fatal: true })
})
