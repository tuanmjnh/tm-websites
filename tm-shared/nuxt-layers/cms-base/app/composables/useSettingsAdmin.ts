import type { AdminSiteSettings, AdminSiteSettingsPatch } from '@tm/flow-contracts/settings-admin'

/**
 * Site settings client. The document is small and always read whole, so the page
 * keeps one copy (the revision it loaded) and sends that revision back with the
 * save; the server refuses a stale one instead of overwriting a colleague.
 */
export const useSettingsAdmin = () => {
  const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

  const fetchSettings = async (): Promise<AdminSiteSettings> => {
    const payload = await plainFetch('/api/v1/admin/settings') as { data: AdminSiteSettings }
    return payload.data
  }

  const saveSettings = async (patch: AdminSiteSettingsPatch): Promise<AdminSiteSettings> => {
    const payload = await plainFetch('/api/v1/admin/settings', { method: 'PATCH', body: patch }) as { data: AdminSiteSettings }
    return payload.data
  }

  const describeError = (error: unknown): string => {
    const status = (error as { statusCode?: number })?.statusCode
    // `errorResponse` nests the code as `data.error.code`; a dev-mode wrapper adds
    // one more `data` level, so accept both shapes.
    const body = (error as { data?: { error?: { code?: string }, data?: { error?: { code?: string } } } })?.data
    const code = body?.error?.code ?? body?.data?.error?.code
    if (code === 'SETTINGS_REVISION_CONFLICT') return 'conflict'
    if (code === 'SETTINGS_UPDATE_UNCHANGED') return 'noChanges'
    if (code === 'SETTINGS_LOCALES_INVALID' || code === 'SETTINGS_PAYLOAD_INVALID') return 'invalid'
    if (status === 403) return 'forbidden'
    return 'unavailable'
  }

  return { fetchSettings, saveSettings, describeError }
}
