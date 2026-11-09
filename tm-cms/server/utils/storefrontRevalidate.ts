import type { H3Event } from 'h3'

/**
 * Drop the storefront's cached public responses after a CMS save.
 *
 * `GET /api/public/site` is a cached Nitro handler (60s), so a saved menu or
 * setting only reached the site on the next expiry. The storefront exposes
 * `POST /api/_internal/purge` for exactly this, guarded by a shared secret.
 *
 * Revalidation is best-effort on purpose: the CMS write already succeeded, so a
 * storefront that is down, slow or missing the secret must never fail the save.
 * The caller records the outcome instead of throwing.
 */

export const STOREFRONT_REVALIDATE_TIMEOUT_MS = 5000
export const STOREFRONT_PURGE_PATH = '/api/_internal/purge'

export type StorefrontRevalidateOutcome = 'not-configured' | 'revalidated' | 'http-error' | 'request-failed'

export interface StorefrontRevalidateTarget {
  /** Absolute base URL of the storefront, without a trailing slash. */
  baseUrl: string
  secret: string
}

export interface StorefrontRevalidateResult {
  attempted: boolean
  ok: boolean
  outcome: StorefrontRevalidateOutcome
  status?: number
  detail?: string
}

export interface StorefrontRevalidateOptions {
  reason: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** `null` when either half of the pair is missing, so an unconfigured site stays silent. */
export function parseRevalidateTarget(url: unknown, secret: unknown): StorefrontRevalidateTarget | null {
  const rawUrl = typeof url === 'string' ? url.trim() : ''
  const rawSecret = typeof secret === 'string' ? secret.trim() : ''
  if (!rawUrl || !rawSecret) return null

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  return {
    baseUrl: `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`,
    secret: rawSecret,
  }
}

export function storefrontPurgeUrl(target: StorefrontRevalidateTarget): string {
  return `${target.baseUrl}${STOREFRONT_PURGE_PATH}`
}

export async function revalidateStorefront(
  target: StorefrontRevalidateTarget | null,
  options: StorefrontRevalidateOptions,
): Promise<StorefrontRevalidateResult> {
  if (!target) return { attempted: false, ok: false, outcome: 'not-configured' }

  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? STOREFRONT_REVALIDATE_TIMEOUT_MS

  try {
    const response = await fetchImpl(storefrontPurgeUrl(target), {
      method: 'POST',
      headers: {
        'x-revalidate-secret': target.secret,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: options.reason }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      return {
        attempted: true,
        ok: false,
        outcome: 'http-error',
        status: response.status,
        detail: `HTTP ${response.status}`,
      }
    }
    return { attempted: true, ok: true, outcome: 'revalidated', status: response.status }
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      outcome: 'request-failed',
      detail: (error as Error)?.message ?? 'request failed',
    }
  }
}

/**
 * Event-scoped wrapper: reads the deployment's storefront URL and shared secret.
 * A missing pair is not an error, it means the deployment has no storefront.
 */
export async function revalidateStorefrontForEvent(
  event: H3Event,
  reason: string,
): Promise<StorefrontRevalidateResult> {
  const config = useRuntimeConfig(event)
  const target = parseRevalidateTarget(config.webRevalidateUrl, config.revalidateSecret)
  const result = await revalidateStorefront(target, { reason })

  if (result.outcome === 'http-error' || result.outcome === 'request-failed') {
    console.warn(`[storefront-revalidate] ${reason}: ${result.outcome}${result.detail ? ` (${result.detail})` : ''}`)
  }

  return result
}

/** Response header so an operator (and a test) can see whether the purge ran. */
export function setRevalidateHeader(event: H3Event, result: StorefrontRevalidateResult): void {
  setHeader(event, 'x-storefront-revalidate', result.attempted ? result.outcome : 'not-configured')
}
