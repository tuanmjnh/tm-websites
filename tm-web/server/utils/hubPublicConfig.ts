import type { H3Event } from 'h3'
import { resolveHubUrl } from '@tm/flow-utils'

const HUB_TIMEOUT_MS = 6000

export interface HubPublicConfigResult {
  /** `false` when the Hub could not be reached, so callers can report honestly. */
  reachable: boolean
  values: Record<string, string>
}

function publicConfigPath(appId: string): string {
  return `/api/v1/apps/${encodeURIComponent(appId)}/configs/public`
}

/**
 * Reads the app's public, non-secret configuration from TM Hub.
 * The endpoint requires no authentication and never returns secret values; a
 * failure degrades to layer defaults instead of failing the page.
 */
export async function fetchHubPublicConfig(event: H3Event): Promise<HubPublicConfigResult> {
  const config = useRuntimeConfig(event)
  const baseUrl = String(config.public.hubUrl || '')
  const appId = String(config.public.hubAppId || config.public.appId || '')

  if (!baseUrl || !appId) return { reachable: false, values: {} }

  try {
    const payload = await $fetch<{ data?: unknown }>(resolveHubUrl(baseUrl, publicConfigPath(appId)), {
      headers: { Accept: 'application/json' },
      timeout: HUB_TIMEOUT_MS,
    })

    const raw = payload?.data
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { reachable: true, values: {} }
    }

    const values: Record<string, string> = {}
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') values[key] = value
      else if (typeof value === 'number' || typeof value === 'boolean') values[key] = String(value)
    }

    return { reachable: true, values }
  } catch {
    return { reachable: false, values: {} }
  }
}
