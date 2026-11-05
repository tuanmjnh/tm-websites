import type { LoginRequest, UserSession } from '@tm/flow-contracts'
import { getErrorStatus, shouldAttemptTokenRefresh } from '@tm/flow-utils/hub'

interface SessionPayload {
  success?: boolean
  data?: UserSession | null
}

interface HubFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
  query?: Record<string, unknown>
  headers?: HeadersInit
  retryOnUnauthorized?: boolean
}

export const useHub = () => {
  const config = useRuntimeConfig()
  const user = useState<UserSession | null>('hub:user', () => null)
  const loading = useState<boolean>('hub:loading', () => false)
  const loginError = useState<string | null>('hub:login-error', () => null)
  const totpRequired = useState<boolean>('hub:totp-required', () => false)

  const hubUrl = String(config.public.hubUrl || '')
  const appId = String(config.public.hubAppId || config.public.appId || '')
  // Public Website content is owned by a different app than the CMS itself.
  const contentAppId = String(config.public.contentAppId || appId)
  const tenantId = String(config.public.tenantId || '')

  const isAuthenticated = computed(() => Boolean(user.value))
  const isConfigured = computed(() => Boolean(appId))
  const permissions = computed<string[]>(() => user.value?.permissions ?? [])

  const hasCapability = (capability: string) => {
    return permissions.value.includes('*') || permissions.value.includes(capability)
  }

  const toProxyUrl = (path: string) => `/api/hub/${path.replace(/^\/+/, '')}`

  const refresh = async () => {
    try {
      await $fetch('/api/auth/refresh', { method: 'POST' })
      return true
    } catch {
      return false
    }
  }

  const hubFetch = async <T>(path: string, options: HubFetchOptions = {}): Promise<T> => {
    const { retryOnUnauthorized = true, headers, ...requestOptions } = options
    // A dynamic proxy URL has no route literal to infer, so `$fetch`'s typed-route
    // overloads recurse without bound; use the plain signature instead.
    const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<T>
    const request = () => plainFetch(toProxyUrl(path), {
      ...requestOptions,
      headers,
    })

    try {
      return await request()
    } catch (error) {
      if (retryOnUnauthorized && shouldAttemptTokenRefresh(getErrorStatus(error), path) && await refresh()) {
        return await request()
      }
      throw error
    }
  }

  const fetchSession = async () => {
    loading.value = true
    try {
      const payload = await $fetch<SessionPayload>('/api/auth/session')
      user.value = payload?.success && payload.data ? payload.data : null
    } catch {
      user.value = null
    } finally {
      loading.value = false
    }
  }

  const readErrorCode = (error: unknown) => {
    const body = (error as {
      data?: { error?: { code?: string }, data?: { error?: { code?: string } } }
    })?.data
    return body?.data?.error?.code || body?.error?.code || 'LOGIN_FAILED'
  }

  const login = async (credentials: LoginRequest) => {
    loginError.value = null
    totpRequired.value = false
    loading.value = true
    try {
      const payload = await $fetch<SessionPayload>('/api/auth/login', {
        method: 'POST',
        body: credentials,
      })
      if (payload?.success && payload.data) {
        user.value = payload.data
        return true
      }
      user.value = null
      loginError.value = 'LOGIN_FAILED'
      return false
    } catch (error) {
      user.value = null
      loginError.value = readErrorCode(error)
      totpRequired.value = loginError.value === 'TOTP_REQUIRED'
      return false
    } finally {
      loading.value = false
    }
  }

  const verifyTotp = async (code: string) => {
    loginError.value = null
    loading.value = true
    try {
      const payload = await $fetch<SessionPayload>('/api/auth/totp', {
        method: 'POST',
        body: { code },
      })
      if (payload?.success && payload.data) {
        user.value = payload.data
        totpRequired.value = false
        return true
      }
      user.value = null
      loginError.value = 'TOTP_FAILED'
      return false
    } catch (error) {
      user.value = null
      loginError.value = readErrorCode(error)
      return false
    } finally {
      loading.value = false
    }
  }

  const cancelTotp = () => {
    loginError.value = null
    totpRequired.value = false
  }

  const logout = async () => {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // Local state is cleared even if the BFF session teardown fails.
    } finally {
      user.value = null
      loginError.value = null
      totpRequired.value = false
      await navigateTo('/login')
    }
  }

  return {
    user,
    loading,
    loginError,
    totpRequired,
    isAuthenticated,
    isConfigured,
    permissions,
    hasCapability,
    hubUrl,
    appId,
    contentAppId,
    tenantId,
    hubFetch,
    refresh,
    fetchSession,
    login,
    verifyTotp,
    cancelTotp,
    logout,
  }
}
