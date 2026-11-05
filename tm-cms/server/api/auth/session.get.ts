export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)

  if (isMockAuth(event)) {
    if (!getAccessToken(event)) {
      return errorResponse(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
    }

    return successResponse({
      event,
      data: {
        id: 'user_admin_01',
        name: 'Quản trị viên',
        email: 'admin@example.com',
        tenantId: config.public.tenantId,
        appId: config.public.hubAppId,
        roles: ['admin'],
        permissions: ['*'],
        allowedRoutes: ['*'],
      },
    })
  }

  const accessToken = getAccessToken(event)
  if (!accessToken) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Chưa đăng nhập')
  }

  try {
    let user
    try {
      user = await hubFetchMe(event, accessToken)
    } catch (error) {
      if (!(error instanceof HubRequestError) || error.statusCode !== 401) {
        throw error
      }

      const refreshToken = getRefreshToken(event)
      if (!refreshToken) {
        clearAuthCookies(event)
        return errorResponse(401, 'UNAUTHENTICATED', 'Phiên đăng nhập đã hết hạn')
      }

      const tokens = await hubRefresh(event, refreshToken)
      setAuthCookies(event, tokens)
      user = await hubFetchMe(event, tokens.accessToken)
    }

    return successResponse({ event, data: user })
  } catch (error) {
    if (error instanceof HubRequestError && error.statusCode === 401) {
      clearAuthCookies(event)
      return errorResponse(401, 'UNAUTHENTICATED', 'Phiên đăng nhập đã hết hạn')
    }

    return translateHubAuthError(error)
  }
})
