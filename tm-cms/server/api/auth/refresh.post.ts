export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  if (isMockAuth(event)) {
    return successResponse({ event, data: null, message: 'Token refreshed' })
  }

  const refreshToken = getRefreshToken(event)
  if (!refreshToken) {
    return errorResponse(401, 'NO_REFRESH_TOKEN', 'Không có refresh token')
  }

  try {
    const tokens = await renewSessionTokens(event, refreshToken)
    setAuthCookies(event, tokens)
    return successResponse({ event, data: null, message: 'Token refreshed' })
  } catch (error) {
    if (error instanceof HubRequestError && error.statusCode === 401) {
      return endExpiredSession(event)
    }

    return translateHubAuthError(error)
  }
})
