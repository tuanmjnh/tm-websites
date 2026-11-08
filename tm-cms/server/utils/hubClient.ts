import type { H3Event } from 'h3'
import type { LoginRequest, UserSession } from '@tm/flow-contracts'
import type { HubResponse } from 'tm-hub-client'
import { UserSessionSchema } from '@tm/flow-contracts'
import { getErrorStatus, getHubErrorCode } from '@tm/flow-utils/hub'
import { HubClient } from 'tm-hub-client'

export interface HubTokens {
  accessToken: string
  refreshToken?: string
}

interface HubUserPayload {
  id?: string
  userId?: string
  email?: string
  name?: string | null
  username?: string | null
  appId?: string
  roles?: string[]
  permissions?: string[]
  allowedRoutes?: string[]
  totpEnabled?: boolean
}

interface HubAuthPayload {
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
  user?: HubUserPayload
  totpRequired?: boolean
  pendingTotpToken?: string
}

export interface HubAuthTransport {
  auth: {
    login: (credentials: { email: string, password: string, platform?: string }) => Promise<HubResponse<unknown>>
    verifyTotp: (pendingTotpToken: string, code: string) => Promise<HubResponse<unknown>>
    me: () => Promise<HubResponse<unknown>>
    refresh: (refreshToken: string) => Promise<HubResponse<unknown>>
    logout: (refreshToken?: string) => Promise<HubResponse<unknown>>
  }
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

export interface HubSettings {
  baseUrl: string
  appId: string
  tenantId: string
  secret: string
  authMode: string
}

export function getHubSettings(event: H3Event): HubSettings {
  const config = useRuntimeConfig(event)
  return {
    baseUrl: String(config.public.hubUrl || ''),
    appId: String(config.public.hubAppId || config.public.appId || ''),
    tenantId: String(config.public.tenantId || ''),
    secret: String(config.hubSecret || ''),
    authMode: String(config.authMode || 'hub'),
  }
}

export interface HubTransportConfig {
  baseUrl: string
  appId: string
  accessToken?: string
  fetch?: typeof globalThis.fetch
}

/**
 * A transport is built per request and never shared: the SDK caches refresh
 * state and permissions per instance, so a process-global client would leak one
 * user's token into another request.
 */
export function createHubTransport(config: HubTransportConfig): HubClient {
  const accessToken = config.accessToken
  return new HubClient({
    baseUrl: config.baseUrl,
    appId: config.appId,
    ...(accessToken ? { getAccessToken: () => accessToken } : {}),
    ...(config.fetch ? { fetch: config.fetch } : {}),
  })
}

export function toHubRequestError(error: unknown): HubRequestError {
  if (error instanceof HubRequestError) {
    return error
  }

  const statusCode = getErrorStatus(error)
  const body = (error as { data?: Record<string, unknown> })?.data
  const message = String(body?.message || body?.statusMessage || (error as Error)?.message || 'TM Hub request failed')

  if (!statusCode) {
    return new HubRequestError(503, 'HUB_UNAVAILABLE', message)
  }

  return new HubRequestError(statusCode, getHubErrorCode(error) || 'HUB_REQUEST_FAILED', message, body)
}

async function runHubCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    throw toHubRequestError(error)
  }
}

export function mapHubUser(user: HubUserPayload, context: { appId: string, tenantId: string }): UserSession {
  const claimedAppId = user.appId
  if (claimedAppId && claimedAppId !== context.appId) {
    throw new HubRequestError(403, 'APP_MISMATCH', 'TM Hub session belongs to a different application')
  }

  const id = user.id || user.userId
  if (!id || !user.email) {
    throw new HubRequestError(502, 'HUB_INVALID_RESPONSE', 'TM Hub did not return a complete user payload')
  }

  if (!context.tenantId) {
    throw new HubRequestError(503, 'HUB_TENANT_UNCONFIGURED', 'TM_TENANT_ID is not configured for this deployment')
  }

  return UserSessionSchema.parse({
    id,
    email: user.email,
    name: user.name || user.email,
    username: user.username ?? undefined,
    tenantId: context.tenantId,
    appId: context.appId,
    roles: user.roles ?? [],
    permissions: user.permissions ?? [],
    allowedRoutes: user.allowedRoutes ?? [],
    totpEnabled: user.totpEnabled,
  })
}

export type HubLoginResult =
  | { totpRequired: true, pendingTotpToken: string }
  | { totpRequired: false, user: UserSession, tokens: HubTokens }

export async function loginViaHub(
  transport: HubAuthTransport,
  credentials: LoginRequest,
  context: { appId: string, tenantId: string },
): Promise<HubLoginResult> {
  const payload = await runHubCall(() => transport.auth.login({
    email: credentials.email,
    password: credentials.password,
    platform: 'web',
  }))

  const data = payload?.data as HubAuthPayload | undefined
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
    user: mapHubUser(data.user, context),
    tokens: {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    },
  }
}

export async function totpLoginViaHub(
  transport: HubAuthTransport,
  params: { pendingTotpToken: string, code: string },
  context: { appId: string, tenantId: string },
): Promise<{ user: UserSession, tokens: HubTokens }> {
  const payload = await runHubCall(() => transport.auth.verifyTotp(params.pendingTotpToken, params.code))
  const data = payload?.data as HubAuthPayload | undefined

  if (!data?.accessToken || !data.user) {
    throw new HubRequestError(502, 'HUB_INVALID_RESPONSE', 'TM Hub did not return a complete login payload')
  }

  return {
    user: mapHubUser(data.user, context),
    tokens: {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    },
  }
}

export async function fetchMeViaHub(
  transport: HubAuthTransport,
  context: { appId: string, tenantId: string },
): Promise<UserSession> {
  const payload = await runHubCall(() => transport.auth.me())
  const data = payload?.data as HubUserPayload | undefined

  if (!data) {
    throw new HubRequestError(401, 'UNAUTHENTICATED', 'TM Hub did not return a session')
  }

  return mapHubUser(data, context)
}

export async function refreshViaHub(transport: HubAuthTransport, refreshToken: string): Promise<HubTokens> {
  const payload = await runHubCall(() => transport.auth.refresh(refreshToken))
  const data = payload?.data as { accessToken?: string, refreshToken?: string } | undefined

  if (!data?.accessToken) {
    throw new HubRequestError(401, 'REFRESH_FAILED', 'Refresh token is invalid or expired')
  }

  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  }
}

async function transportForEvent(
  event: H3Event,
  options: { accessToken?: string } = {},
): Promise<{ transport: HubClient, context: { appId: string, tenantId: string } }> {
  const settings = getHubSettings(event)

  if (!settings.baseUrl) {
    throw new HubRequestError(503, 'HUB_NOT_CONFIGURED', 'TM_HUB_URL is not configured')
  }

  if (!settings.appId) {
    throw new HubRequestError(503, 'HUB_APP_ID_MISSING', 'CMS app id is not configured')
  }

  return {
    transport: createHubTransport({
      baseUrl: settings.baseUrl,
      appId: settings.appId,
      accessToken: options.accessToken,
    }),
    context: { appId: settings.appId, tenantId: settings.tenantId },
  }
}

export async function hubLogin(event: H3Event, credentials: LoginRequest): Promise<HubLoginResult> {
  const { transport, context } = await transportForEvent(event)
  return loginViaHub(transport, credentials, context)
}

export async function hubTotpLogin(
  event: H3Event,
  params: { pendingTotpToken: string, code: string },
): Promise<{ user: UserSession, tokens: HubTokens }> {
  const { transport, context } = await transportForEvent(event)
  return totpLoginViaHub(transport, params, context)
}

export async function hubFetchMe(event: H3Event, accessToken: string): Promise<UserSession> {
  const { transport, context } = await transportForEvent(event, { accessToken })
  return fetchMeViaHub(transport, context)
}

export async function hubRefresh(event: H3Event, refreshToken: string): Promise<HubTokens> {
  const { transport } = await transportForEvent(event)
  return refreshViaHub(transport, refreshToken)
}

export async function hubLogout(event: H3Event, refreshToken: string) {
  try {
    const { transport } = await transportForEvent(event)
    await transport.auth.logout(refreshToken)
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

  if (error.code === 'APP_MISMATCH') {
    return errorResponse(403, 'APP_MISMATCH', 'Phiên đăng nhập không thuộc ứng dụng này')
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

  if (error.code === 'APP_MISMATCH') {
    return errorResponse(403, 'APP_MISMATCH', 'Phiên đăng nhập không thuộc ứng dụng này')
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
