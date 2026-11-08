export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  if (!isMockAuth(event)) {
    const refreshToken = getRefreshToken(event)
    if (refreshToken) {
      await hubLogout(event, refreshToken)
    }
  }

  clearAuthCookies(event)

  return successResponse({
    event,
    data: null,
    message: 'Đã đăng xuất thành công',
  })
})
