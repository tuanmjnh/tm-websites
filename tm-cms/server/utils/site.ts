import type { H3Event } from 'h3'

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

/**
 * The site a deployment writes content for. It comes from deployment
 * configuration (registry customer), never from the request body, so a CMS
 * instance cannot address another customer's content.
 */
export function resolveSiteId(event: H3Event): string {
  const config = useRuntimeConfig(event)
  const siteId = String(config.siteId || config.public.customerId || '').trim()

  if (!SITE_ID_PATTERN.test(siteId)) {
    return errorResponse(503, 'SITE_ID_INVALID', 'Site chưa được cấu hình cho triển khai này')
  }

  return siteId
}
