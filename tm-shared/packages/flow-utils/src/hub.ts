export interface HubRequestContext {
  appId: string
  tenantId?: string
  accessToken?: string | null
}

export interface HubTokenPayload {
  accessToken: string
  refreshToken?: string
}

const AUTH_ENDPOINTS = ['/auth/login', '/auth/refresh', '/auth/register']

export function resolveHubUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path
  }

  const base = baseUrl.replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}

export function buildHubHeaders(context: HubRequestContext, init?: HeadersInit): Headers {
  const headers = new Headers(init)

  if (!headers.has('X-App-Id')) {
    headers.set('X-App-Id', context.appId)
  }

  if (context.tenantId && !headers.has('X-Tenant-Id')) {
    headers.set('X-Tenant-Id', context.tenantId)
  }

  if (context.accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${context.accessToken}`)
  }

  return headers
}

export function shouldAttemptTokenRefresh(status: number | undefined, path: string): boolean {
  if (status !== 401) {
    return false
  }

  const normalizedPath = path.split('?')[0] ?? path
  return !AUTH_ENDPOINTS.some(endpoint => normalizedPath.endsWith(endpoint) || normalizedPath.includes(`${endpoint}/`))
}

export function extractHubTokens(payload: unknown): HubTokenPayload | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, unknown>
  const data = (record.data ?? payload) as Record<string, unknown>
  const candidate = (data.tokens ?? data) as Record<string, unknown>
  const accessToken = candidate.accessToken

  if (typeof accessToken !== 'string' || !accessToken) {
    return null
  }

  const refreshToken = typeof candidate.refreshToken === 'string' ? candidate.refreshToken : undefined
  return { accessToken, refreshToken }
}

export function getErrorStatus(error: unknown): number | undefined {
  const candidate = error as {
    statusCode?: number
    status?: number
    response?: { status?: number }
  }

  return candidate?.statusCode ?? candidate?.response?.status ?? candidate?.status
}

export function getHubErrorCode(error: unknown): string | undefined {
  const candidate = error as {
    statusMessage?: string
    data?: {
      statusMessage?: string
      error?: { code?: string }
      data?: { error?: { code?: string } }
    }
  }

  return candidate?.data?.data?.error?.code
    ?? candidate?.data?.error?.code
    ?? candidate?.data?.statusMessage
    ?? candidate?.statusMessage
}

export function sanitizeHubProxyPath(raw: string | undefined): string | null {
  if (!raw) {
    return null
  }

  let path = raw
  try {
    path = decodeURIComponent(path)
  } catch {
    return null
  }

  if (
    path.includes('..')
    || path.includes('\\')
    || path.includes('?')
    || path.includes('#')
    || path.startsWith('/')
    || /^[a-z][a-z0-9+.-]*:/i.test(path)
    || !path.startsWith('api/v1/')
  ) {
    return null
  }

  return `/${path}`
}
