import type { H3Event } from 'h3'
import type { UserSession } from '@tm/flow-contracts'
import type { HubTokens } from './hubClient'
import { HubRequestError } from './hubClient'

export interface VerifiedContextDeps {
  accessToken: string
  refreshToken: string
  fetchMe: (accessToken: string) => Promise<UserSession>
  refresh: (refreshToken: string) => Promise<HubTokens>
}

export interface ResolvedContext {
  user: UserSession
  /** Present only when the access token was renewed during this request. */
  tokens?: HubTokens
}

/**
 * Resolves the current session from tokens only, so the refresh-once policy is
 * testable without an H3 event. A 401 from `me` is the only case worth a silent
 * refresh; every other failure (network, invalid payload, app mismatch)
 * propagates unchanged and the caller fails closed.
 */
export async function resolveSession(deps: VerifiedContextDeps): Promise<ResolvedContext> {
  if (!deps.accessToken) {
    throw new HubRequestError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
  }

  try {
    return { user: await deps.fetchMe(deps.accessToken) }
  } catch (error) {
    if (!(error instanceof HubRequestError) || error.statusCode !== 401) {
      throw error
    }

    if (!deps.refreshToken) {
      throw new HubRequestError(401, 'UNAUTHENTICATED', 'Phiên đăng nhập đã hết hạn')
    }

    const tokens = await deps.refresh(deps.refreshToken)
    return { user: await deps.fetchMe(tokens.accessToken), tokens }
  }
}

/**
 * Mock authentication exists for local UI work. It must never be a production
 * fallback, so a deployment that asks for it in production fails closed.
 */
export function isMockAuthAllowed(authMode: string, nodeEnv: string | undefined): boolean {
  return authMode === 'mock' && nodeEnv !== 'production'
}

function mockSession(event: H3Event): UserSession {
  const config = useRuntimeConfig(event)
  return {
    id: 'user_mock_admin',
    name: 'Quản trị viên',
    email: 'admin@example.com',
    tenantId: String(config.public.tenantId || ''),
    appId: String(config.public.hubAppId || ''),
    roles: ['admin'],
    permissions: ['*'],
    allowedRoutes: ['*'],
  }
}

/**
 * The single context gate for private CMS endpoints. It either returns a Hub
 * verified session or throws an HTTP error; there is no "unverified" branch a
 * caller could accidentally treat as success.
 */
export async function requireVerifiedContext(event: H3Event): Promise<UserSession> {
  const settings = getHubSettings(event)

  if (settings.authMode === 'mock') {
    if (!isMockAuthAllowed(settings.authMode, process.env.NODE_ENV)) {
      return errorResponse(503, 'AUTH_MODE_FORBIDDEN', 'Chế độ xác thực giả lập không được phép ở môi trường này')
    }

    if (!getAccessToken(event)) {
      return errorResponse(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
    }

    return mockSession(event)
  }

  try {
    const resolved = await resolveSession({
      accessToken: getAccessToken(event),
      refreshToken: getRefreshToken(event),
      fetchMe: token => hubFetchMe(event, token),
      refresh: token => hubRefresh(event, token),
    })

    if (resolved.tokens) {
      setAuthCookies(event, resolved.tokens)
    }

    return resolved.user
  } catch (error) {
    if (error instanceof HubRequestError && error.statusCode === 401) {
      clearAuthCookies(event)
      return errorResponse(401, 'UNAUTHENTICATED', 'Phiên đăng nhập đã hết hạn')
    }

    return translateHubAuthError(error)
  }
}

export function hasCapability(user: UserSession, capability: string): boolean {
  return user.permissions.includes('*') || user.permissions.includes(capability)
}

/** Throws 403 unless the verified session holds every requested capability. */
export function requireCapabilities(user: UserSession, ...capabilities: string[]): void {
  const missing = capabilities.filter(capability => !hasCapability(user, capability))
  if (missing.length > 0) {
    return errorResponse(403, 'FORBIDDEN', 'Tài khoản không có quyền thực hiện thao tác này', { missing })
  }
}
