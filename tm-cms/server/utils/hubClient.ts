import type { H3Event } from 'h3'
import type { LoginRequest, UserSession } from '@tm/flow-contracts'
import { UserSessionSchema } from '@tm/flow-contracts'
import { getErrorStatus, resolveHubUrl } from '@tm/flow-utils/hub'

export interface HubTokens {
  accessToken: string
  refreshToken?: string
}

interface HubUserPayload {
  id?: string
  userId?: string
  email: string
  name?: string | null
  username?: string | null
  appId?: string
  roles?: string[]
  permissions?: string[]
  allowedRoutes?: string[]
  totpEnabled?: boolean
}

interface HubLoginData {
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
  user?: HubUserPayload
  totpRequired?: boolean
  pendingTotpToken?: string
}

interface HubResponse<T> {
  success?: boolean
  data?: T
}

export class HubRequestError extends Error {
  statusCode: number
  code: string
  details?: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'HubRequestError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export function getHubSettings(event: H3Event) {
  const config = useRuntimeConfig(event)
  return {
    baseUrl: String(config.public.hubUrl || ''),
    appId: String(config.public.hubAppId || config.public.appId || ''),
    tenantId: String(config.public.tenantId || ''),
    secret: String(config.hubSecret || ''),
    authMode: String(config.authMode || 'hub'),
  }
}

function toHubRequestError(error: unknown) {
  if (error instanceof HubRequestError) {
    return error
  }

  const statusCode = getErrorStatus(error)
  const body = (error as { data?: Record<string, unknown> })?.data
  const message = String(body?.message || body?.statusMessage || (error as Error)?.message || 'TM Hub request failed')

  if (!statusCode) {
    return new HubRequestError(503, 'HUB_UNAVAILABLE', message)
  }

  return new HubRequestError(statusCode, 'HUB_REQUEST_FAILED', message, body)
}

async function hubRequest<T>(
  event: H3Event,
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    body?: unknown
    headers?: HeadersInit
    accessToken?: string
  } = {},
): Promise<T> {
  const { baseUrl, appId, secret } = getHubSettings(event)

  if (!baseUrl) {
    throw new HubRequestError(503, 'HUB_NOT_CONFIGURED', 'TM_HUB_URL is not configured')
  }

  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  if (appId) headers.set('X-App-Id', appId)
  if (secret) headers.set('X-Api-Key', secret)
  if (options.accessToken) headers.set('Authorization', `Bearer ${options.accessToken}`)

  try {
    return await $fetch(resolveHubUrl(baseUrl, path), {
      method: options.method ?? 'GET',
      body: options.body as Record<string, unknown> | undefined,
      headers,
    }) as T
  } catch (error) {
    throw toHubRequestError(error)
  }
}

function mapHubUser(user: HubUserPayload, context: { appId: string, tenantId: string }): UserSession {
  return UserSessionSchema.parse({
    id: user.id || user.userId,
    email: user.email,
    name: user.name || user.email,
    username: user.username ?? undefined,
    tenantId: context.tenantId,
    appId: user.appId || context.appId,
    roles: user.roles ?? [],
    permissions: user.permissions ?? [],
    allowedRoutes: user.allowedRoutes ?? [],
    totpEnabled: user.totpEnabled,
  })
}

export type HubLoginResult =
  | { totpRequired: true, pendingTotpToken: string }
  | { totpRequired: false, user: UserSession, tokens: HubTokens }

export async function hubLogin(event: H3Event, credentials: LoginRequest): Promise<HubLoginResult> {
  const { appId, tenantId } = getHubSettings(event)

  if (!appId) {
    throw new HubRequestError(503, 'HUB_APP_ID_MISSING', 'CMS app id is not configured')
  }

  const payload = await hubRequest<HubResponse<HubLoginData>>(event, '/api/v1/auth/login', {
    method: 'POST',
    body: {
      appId,
      email: credentials.email,
      password: credentials.password,
      platform: 'web',
    },
  })

  const data = payload?.data
  if (!data) {
    throw new HubRequestError(502, 'HUB_INVALID_RESPONSE', 'TM Hub returned an empty login payload')
  }

  if (data.totpRequired) {
    if (!data.pendingTotpToken) {
      throw new HubRequestError(502, 'HUB_INVALID_RESPONSE', 'TM Hub did not return a TOTP challenge token')
    }

    return { totpRequired: true, pendingTotpToken: data.pendingTotpToken }
  }

  if (!data.accessToken || !data.user) {
    throw new HubRequestError(502, 'HUB_INVALID_RESPONSE', 'TM Hub did not return a complete login payload')
  }

  return {
    totpRequired: false,
    user: mapHubUser(data.user, { appId, tenantId }),
    tokens: {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    } satisfies HubTokens,
  }
}

export async function hubTotpLogin(
  event: H3Event,
  params: { pendingTotpToken: string, code: string },
): Promise<{ user: UserSession, tokens: HubTokens }> {
  const { appId, tenantId } = getHubSettings(event)

  const payload = await hubRequest<HubResponse<HubLoginData>>(event, '/api/v1/auth/totp/login', {
    method: 'POST',
    body: {
      pendingTotpToken: params.pendingTotpToken,
      code: params.code,
    },
  })

  const data = payload?.data
  if (!data?.accessToken || !data.user) {
    throw new HubRequestError(502, 'HUB_INVALID_RESPONSE', 'TM Hub did not return a complete login payload')
  }

  return {
    user: mapHubUser(data.user, { appId, tenantId }),
    tokens: {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    } satisfies HubTokens,
  }
}

export async function hubFetchMe(event: H3Event, accessToken: string): Promise<UserSession> {
  const { appId, tenantId } = getHubSettings(event)
  const payload = await hubRequest<HubResponse<HubUserPayload>>(event, '/api/v1/auth/me', {
    accessToken,
  })

  if (!payload?.data) {
    throw new HubRequestError(401, 'UNAUTHENTICATED', 'TM Hub did not return a session')
  }

  return mapHubUser(payload.data, { appId, tenantId })
}

export async function hubRefresh(event: H3Event, refreshToken: string): Promise<HubTokens> {
  const { appId } = getHubSettings(event)

  const payload = await hubRequest<HubResponse<{ accessToken?: string, refreshToken?: string }>>(
    event,
    '/api/v1/auth/refresh',
    {
      method: 'POST',
      body: { refreshToken, appId },
    },
  )

  const data = payload?.data
  if (!data?.accessToken) {
    throw new HubRequestError(401, 'REFRESH_FAILED', 'Refresh token is invalid or expired')
  }

  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  }
}

export async function hubLogout(event: H3Event, refreshToken: string) {
  const { appId } = getHubSettings(event)
  try {
    await hubRequest(event, '/api/v1/auth/logout', {
      method: 'POST',
      body: { refreshToken, appId },
    })
  } catch {
    // Session cookies are cleared locally even when Hub revocation fails.
  }
}

export function translateHubAuthError(error: unknown): never {
  if (!(error instanceof HubRequestError)) {
    throw error
  }

  if (error.code === 'TOTP_REQUIRED') {
    return errorResponse(409, 'TOTP_REQUIRED', 'Tài khoản yêu cầu xác thực 2 lớp (TOTP)')
  }

  if (error.statusCode === 400) {
    return errorResponse(400, 'INVALID_APP', 'App ID chưa được đăng ký hoặc đang bị khóa trong TM Hub')
  }

  if (error.statusCode === 401) {
    return errorResponse(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng')
  }

  if (error.statusCode === 403) {
    return errorResponse(403, 'NO_APP_ACCESS', 'Tài khoản không có quyền truy cập ứng dụng này')
  }

  if (error.statusCode === 429) {
    return errorResponse(429, 'RATE_LIMITED', 'Quá nhiều lần đăng nhập. Vui lòng thử lại sau.')
  }

  if (error.code === 'HUB_NOT_CONFIGURED' || error.code === 'HUB_APP_ID_MISSING' || error.statusCode === 503) {
    return errorResponse(503, 'HUB_UNAVAILABLE', 'Không thể kết nối TM Hub')
  }

  return errorResponse(502, 'HUB_ERROR', 'TM Hub trả về lỗi không mong đợi')
}

export function translateHubTotpError(error: unknown): never {
  if (!(error instanceof HubRequestError)) {
    throw error
  }

  if (error.statusCode === 400) {
    return errorResponse(400, 'TOTP_INVALID_CODE', 'Mã xác thực không đúng hoặc đã hết hiệu lực')
  }

  if (error.statusCode === 401) {
    return errorResponse(401, 'TOTP_CHALLENGE_EXPIRED', 'Phiên xác thực 2 lớp đã hết hạn. Vui lòng đăng nhập lại.')
  }

  if (error.statusCode === 429) {
    return errorResponse(429, 'RATE_LIMITED', 'Quá nhiều lần xác thực. Vui lòng thử lại sau.')
  }

  if (error.code === 'HUB_NOT_CONFIGURED' || error.code === 'HUB_APP_ID_MISSING' || error.statusCode === 503) {
    return errorResponse(503, 'HUB_UNAVAILABLE', 'Không thể kết nối TM Hub')
  }

  return errorResponse(502, 'HUB_ERROR', 'TM Hub trả về lỗi không mong đợi')
}
