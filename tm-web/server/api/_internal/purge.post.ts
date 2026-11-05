import { timingSafeEqual } from 'node:crypto'

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Drops every cached Nitro handler response so freshly published content and
 * catalog changes appear immediately instead of waiting for the SWR window.
 * Requires REVALIDATE_SECRET; the route is inert until that variable is set.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const expected = String(config.revalidateSecret || '')

  if (!expected) {
    throw createError({
      statusCode: 503,
      statusMessage: 'error.revalidateDisabled',
      data: { code: 'REVALIDATE_DISABLED' },
    })
  }

  const headerSecret = String(getHeader(event, 'x-revalidate-secret') || '')
  const body = await readBody<{ secret?: unknown }>(event).catch(() => ({} as { secret?: unknown }))
  const bodySecret = typeof body?.secret === 'string' ? body.secret : ''
  const provided = headerSecret || bodySecret

  if (!provided || !secretsMatch(provided, expected)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'error.invalidRevalidateSecret',
      data: { code: 'INVALID_REVALIDATE_SECRET' },
    })
  }

  const storage = useStorage('cache')
  const keys = (await storage.getKeys()).filter(key => key.includes('nitro:handlers:'))
  for (const key of keys) {
    await storage.removeItem(key)
  }

  setHeader(event, 'Cache-Control', 'no-store')
  return { success: true, removedCount: keys.length }
})
