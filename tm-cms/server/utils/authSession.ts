import type { H3Event } from 'h3'
import type { HubTokens } from '#server/utils/hubClient'

const ACCESS_COOKIE = 'tm_access_token'
const REFRESH_COOKIE = 'tm_refresh_token'
const TOTP_COOKIE = 'tm_totp_pending'
const MAX_AGE = 60 * 60 * 24 * 7
// Mirrors the short-lived TOTP challenge token TTL on TM Hub (5 minutes).
const TOTP_MAX_AGE = 60 * 5

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: MAX_AGE,
  }
}

export function setAuthCookies(event: H3Event, tokens: HubTokens) {
  setCookie(event, ACCESS_COOKIE, tokens.accessToken, cookieOptions())
  if (tokens.refreshToken) {
    setCookie(event, REFRESH_COOKIE, tokens.refreshToken, cookieOptions())
  }
}

export function clearAuthCookies(event: H3Event) {
  deleteCookie(event, ACCESS_COOKIE, { path: '/' })
  deleteCookie(event, REFRESH_COOKIE, { path: '/' })
  deleteCookie(event, TOTP_COOKIE, { path: '/' })
  // Remove the Phase 7 mock cookie so upgraded installs cannot keep a fake session.
  deleteCookie(event, 'tm_session_token', { path: '/' })
}

export function setPendingTotpCookie(event: H3Event, pendingTotpToken: string) {
  setCookie(event, TOTP_COOKIE, pendingTotpToken, { ...cookieOptions(), maxAge: TOTP_MAX_AGE })
}

export function getPendingTotpCookie(event: H3Event) {
  return getCookie(event, TOTP_COOKIE) || ''
}

export function clearPendingTotpCookie(event: H3Event) {
  deleteCookie(event, TOTP_COOKIE, { path: '/' })
}

export function getAccessToken(event: H3Event) {
  return getCookie(event, ACCESS_COOKIE) || ''
}

export function getRefreshToken(event: H3Event) {
  return getCookie(event, REFRESH_COOKIE) || ''
}

export function isMockAuth(event: H3Event) {
  return getHubSettings(event).authMode === 'mock'
}
