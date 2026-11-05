import { resolveHubUrl, sanitizeHubProxyPath } from '@tm/flow-utils/hub'

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export default defineEventHandler(async (event) => {
  const path = sanitizeHubProxyPath(getRouterParam(event, 'path'))
  if (!path) {
    return errorResponse(400, 'INVALID_PROXY_PATH', 'Chỉ cho phép gọi các endpoint /api/v1 của TM Hub')
  }

  let accessToken = getAccessToken(event)
  if (!accessToken) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
  }

  const settings = getHubSettings(event)
  if (!settings.baseUrl) {
    return errorResponse(503, 'HUB_NOT_CONFIGURED', 'TM_HUB_URL chưa được cấu hình')
  }

  const method = getMethod(event).toUpperCase()
  const query = getQuery(event)
  const contentType = getHeader(event, 'content-type')
  const rawBody = BODY_METHODS.has(method) ? await readRawBody(event) : undefined

  const callHub = async (token: string) => {
    const headers = new Headers()
    headers.set('Accept', 'application/json')
    if (settings.appId) headers.set('X-App-Id', settings.appId)
    if (settings.tenantId) headers.set('X-Tenant-Id', settings.tenantId)
    if (settings.secret) headers.set('X-Api-Key', settings.secret)
    headers.set('Authorization', `Bearer ${token}`)
    if (contentType) headers.set('Content-Type', contentType)

    return await $fetch.raw(resolveHubUrl(settings.baseUrl, path), {
      method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      query,
      headers,
      body: rawBody,
      ignoreResponseError: true,
    })
  }

  setHeader(event, 'Cache-Control', 'no-store')

  try {
    let response = await callHub(accessToken)

    if (response.status === 401) {
      const refreshToken = getRefreshToken(event)
      if (!refreshToken) {
        clearAuthCookies(event)
        return errorResponse(401, 'UNAUTHENTICATED', 'Phiên đăng nhập đã hết hạn')
      }

      const tokens = await hubRefresh(event, refreshToken)
      setAuthCookies(event, tokens)
      accessToken = tokens.accessToken
      response = await callHub(accessToken)
    }

    setResponseStatus(event, response.status)
    const upstreamType = response.headers.get('content-type')
    if (upstreamType) {
      setHeader(event, 'content-type', upstreamType)
    }

    return response._data
  } catch (error) {
    if (error instanceof HubRequestError) {
      return translateHubAuthError(error)
    }
    return errorResponse(502, 'HUB_UNAVAILABLE', 'Không thể kết nối TM Hub')
  }
})
