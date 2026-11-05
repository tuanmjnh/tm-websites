import type { H3Event } from 'h3'
import { HubPublicContentListSchema, type HubPublicContent } from '@tm/flow-contracts'
import { getErrorStatus, resolveHubUrl } from '@tm/flow-utils/hub'
import { normalizeSiteBaseUrl } from '@tm/flow-utils/seo'

const CONTENT_PATH = '/api/v1/content/public'
const HUB_TIMEOUT_MS = 8000
const MAX_PAGES = 25

interface PublicContentSettings {
  baseUrl: string
  appId: string
}

interface PublicContentPage {
  items: HubPublicContent[]
  nextCursor?: string
}

export function getPublicContentSettings(event: H3Event): PublicContentSettings {
  const config = useRuntimeConfig(event)
  return {
    baseUrl: String(config.public.hubUrl || ''),
    appId: String(config.public.hubAppId || config.public.appId || ''),
  }
}

/**
 * Absolute public origin for canonical URLs, sitemap and robots.
 * Uses TM_SITE_URL when configured, otherwise the forwarded request origin.
 */
export function getSiteBaseUrl(event: H3Event): string {
  const config = useRuntimeConfig(event)
  const configured = normalizeSiteBaseUrl(String(config.public.siteUrl || ''))
  if (configured) return configured

  const proto = (getHeader(event, 'x-forwarded-proto') || 'https').split(',')[0]?.trim() || 'https'
  const host = (getHeader(event, 'x-forwarded-host') || getHeader(event, 'host') || 'localhost')
    .split(',')[0]
    ?.trim() || 'localhost'

  return `${proto}://${host}`
}

async function requestPublicContent(
  event: H3Event,
  query: Record<string, string | number | undefined>,
): Promise<PublicContentPage> {
  const { baseUrl, appId } = getPublicContentSettings(event)

  if (!baseUrl || !appId) {
    throw createError({
      statusCode: 503,
      statusMessage: 'error.contentUnavailable',
      data: { code: 'CONTENT_NOT_CONFIGURED' },
    })
  }

  const headers = new Headers()
  headers.set('Accept', 'application/json')
  headers.set('X-App-Id', appId)

  let payload: unknown
  try {
    payload = await $fetch(resolveHubUrl(baseUrl, CONTENT_PATH), {
      query,
      headers,
      timeout: HUB_TIMEOUT_MS,
    })
  } catch (error) {
    if (getErrorStatus(error) === 404) {
      throw createError({ statusCode: 404, statusMessage: 'error.contentNotFound' })
    }
    throw createError({
      statusCode: 503,
      statusMessage: 'error.contentUnavailable',
      data: { code: 'CONTENT_UPSTREAM_UNAVAILABLE' },
    })
  }

  const parsed = HubPublicContentListSchema.safeParse(payload)
  if (!parsed.success) {
    throw createError({
      statusCode: 502,
      statusMessage: 'error.contentInvalid',
      data: { code: 'CONTENT_INVALID_RESPONSE' },
    })
  }

  return {
    items: parsed.data.data,
    nextCursor: parsed.data.nextCursor ?? undefined,
  }
}

export async function fetchPublicContentPage(
  event: H3Event,
  options: {
    key?: string
    category?: string
    cursor?: string
    limit?: number
  } = {},
): Promise<PublicContentPage> {
  return requestPublicContent(event, {
    key: options.key,
    category: options.category,
    cursor: options.cursor,
    limit: options.limit,
  })
}

export async function fetchPublicContentByKey(
  event: H3Event,
  key: string,
): Promise<HubPublicContent | null> {
  const page = await fetchPublicContentPage(event, { key, limit: 1 })
  return page.items.find(item => item.key === key) ?? null
}

/**
 * Lists every published record for the configured app.
 * The public Hub API only returns published, non-deleted, exact-app content.
 */
export async function fetchAllPublishedContent(event: H3Event): Promise<HubPublicContent[]> {
  const items: HubPublicContent[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchPublicContentPage(event, { cursor, limit: 100 })
    items.push(...result.items)

    if (!result.nextCursor || seenCursors.has(result.nextCursor)) break
    seenCursors.add(result.nextCursor)
    cursor = result.nextCursor
  }

  return items
}
