import type { H3Event } from 'h3'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const SAME_SITE_VALUES = new Set(['same-origin', 'none'])

export interface MutationOriginInput {
  method: string
  origin?: string
  host?: string
  secFetchSite?: string
}

export type MutationOriginVerdict =
  | { allowed: true }
  | { allowed: false, reason: 'origin-mismatch' | 'cross-site' }

/**
 * Cookie-authenticated mutations must prove they come from this origin. A
 * browser always sends `Origin` for cross-site and same-origin POST/PUT/DELETE
 * fetches; `Sec-Fetch-Site` covers agents that omit it. Requests with neither
 * header are non-browser clients (curl, server-to-server) and carry no
 * ambient cookies, so they are allowed through.
 */
export function evaluateMutationOrigin(input: MutationOriginInput): MutationOriginVerdict {
  if (SAFE_METHODS.has(input.method.toUpperCase())) {
    return { allowed: true }
  }

  if (input.origin) {
    let originHost: string
    try {
      originHost = new URL(input.origin).host
    } catch {
      return { allowed: false, reason: 'origin-mismatch' }
    }

    if (!input.host || originHost.toLowerCase() !== input.host.toLowerCase()) {
      return { allowed: false, reason: 'origin-mismatch' }
    }

    return { allowed: true }
  }

  if (input.secFetchSite && !SAME_SITE_VALUES.has(input.secFetchSite.toLowerCase())) {
    return { allowed: false, reason: 'cross-site' }
  }

  return { allowed: true }
}

export function assertSameOriginMutation(event: H3Event): void {
  const verdict = evaluateMutationOrigin({
    method: getMethod(event),
    origin: getHeader(event, 'origin') || undefined,
    host: getHeader(event, 'host') || undefined,
    secFetchSite: getHeader(event, 'sec-fetch-site') || undefined,
  })

  if (verdict.allowed) {
    return
  }

  if (verdict.reason === 'cross-site') {
    return errorResponse(403, 'CSRF_REJECTED', 'Yêu cầu bị từ chối: nguồn gửi không hợp lệ')
  }

  return errorResponse(403, 'CSRF_ORIGIN_MISMATCH', 'Yêu cầu bị từ chối: origin không khớp với máy chủ')
}
