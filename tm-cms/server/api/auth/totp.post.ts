export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const code = String(body?.code || '').trim()

  if (!code) {
    return errorResponse(400, 'TOTP_CODE_REQUIRED', 'Vui lòng nhập mã xác thực')
  }

  const pendingTotpToken = getPendingTotpCookie(event)
  if (!pendingTotpToken) {
    return errorResponse(401, 'TOTP_CHALLENGE_EXPIRED', 'Phiên xác thực 2 lớp đã hết hạn. Vui lòng đăng nhập lại.')
  }

  try {
    const result = await hubTotpLogin(event, { pendingTotpToken, code })
    clearPendingTotpCookie(event)
    setAuthCookies(event, result.tokens)

    return successResponse({
      event,
      data: result.user,
      message: 'Đăng nhập thành công',
    })
  } catch (error) {
    // Keep the challenge cookie on a wrong code so the user can retry within its TTL.
    if (error instanceof HubRequestError && error.statusCode === 401) {
      clearPendingTotpCookie(event)
    }

    return translateHubTotpError(error)
  }
})
