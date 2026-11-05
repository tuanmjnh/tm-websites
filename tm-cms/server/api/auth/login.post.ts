import { LoginRequestSchema } from '@tm/flow-contracts'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const validation = LoginRequestSchema.safeParse(body)

  if (!validation.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Dữ liệu đăng nhập không hợp lệ', validation.error.flatten())
  }

  if (isMockAuth(event)) {
    const config = useRuntimeConfig(event)
    setAuthCookies(event, {
      accessToken: 'mock_access_token',
      refreshToken: 'mock_refresh_token',
    })

    return successResponse({
      event,
      data: {
        id: 'user_admin_01',
        name: 'Quản trị viên',
        email: validation.data.email,
        tenantId: config.public.tenantId,
        appId: config.public.hubAppId,
        roles: ['admin'],
        permissions: ['*'],
        allowedRoutes: ['*'],
      },
      message: 'Đăng nhập thành công',
    })
  }

  try {
    const result = await hubLogin(event, validation.data)

    if (result.totpRequired) {
      setPendingTotpCookie(event, result.pendingTotpToken)
      return errorResponse(409, 'TOTP_REQUIRED', 'Tài khoản yêu cầu xác thực 2 lớp (TOTP)')
    }

    setAuthCookies(event, result.tokens)

    return successResponse({
      event,
      data: result.user,
      message: 'Đăng nhập thành công',
    })
  } catch (error) {
    return translateHubAuthError(error)
  }
})
