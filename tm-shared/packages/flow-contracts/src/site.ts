import { z } from 'zod'

/**
 * Public site identity for the storefront.
 *
 * The Hub exposes an app's public, non-secret configuration as a flat
 * `key -> string` map. Only the keys listed below are ever surfaced to a
 * visitor, so an operator cannot accidentally publish an internal key name.
 */

export const SITE_CONFIG_KEY_MAP = {
  companyName: ['site_name', 'company_name'],
  supportEmail: ['support_email', 'contact_email'],
  supportPhone: ['support_phone', 'contact_phone', 'hotline'],
  address: ['address', 'company_address'],
  currency: ['currency', 'default_currency'],
} as const

export const SITE_SOCIAL_KEY_MAP = {
  facebook: ['social_facebook', 'facebook_url'],
  instagram: ['social_instagram', 'instagram_url'],
  youtube: ['social_youtube', 'youtube_url'],
  tiktok: ['social_tiktok', 'tiktok_url'],
  zalo: ['social_zalo', 'zalo_url'],
} as const

export const SiteSocialLinksSchema = z.object({
  facebook: z.string().optional(),
  instagram: z.string().optional(),
  youtube: z.string().optional(),
  tiktok: z.string().optional(),
  zalo: z.string().optional(),
})
export type SiteSocialLinks = z.infer<typeof SiteSocialLinksSchema>

export const SiteConfigSchema = z.object({
  source: z.enum(['hub', 'fallback']),
  companyName: z.string().min(1),
  currency: z.string().min(1),
  supportEmail: z.string().optional(),
  supportPhone: z.string().optional(),
  address: z.string().optional(),
  social: SiteSocialLinksSchema,
})
export type SiteConfig = z.infer<typeof SiteConfigSchema>

function firstValue(values: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = values[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function buildSiteConfig(input: {
  values: Record<string, string>
  companyName: string
  currency: string
}): SiteConfig {
  const { values } = input

  const social: SiteSocialLinks = {}
  let hubKeysApplied = 0

  for (const keys of Object.values(SITE_CONFIG_KEY_MAP)) {
    if (firstValue(values, keys)) hubKeysApplied++
  }
  for (const [field, keys] of Object.entries(SITE_SOCIAL_KEY_MAP)) {
    const value = firstValue(values, keys)
    if (!value) continue
    hubKeysApplied++
    social[field as keyof SiteSocialLinks] = value
  }

  const companyName = firstValue(values, SITE_CONFIG_KEY_MAP.companyName)
  const currency = firstValue(values, SITE_CONFIG_KEY_MAP.currency)
  const supportEmail = firstValue(values, SITE_CONFIG_KEY_MAP.supportEmail)
  const supportPhone = firstValue(values, SITE_CONFIG_KEY_MAP.supportPhone)
  const address = firstValue(values, SITE_CONFIG_KEY_MAP.address)

  return {
    // "hub" only when something actually came from the Hub; an empty payload is
    // reported honestly as a fallback rather than pretending it was configured.
    source: hubKeysApplied > 0 ? 'hub' : 'fallback',
    companyName: companyName ?? input.companyName,
    currency: currency ?? input.currency,
    ...(supportEmail ? { supportEmail } : {}),
    ...(supportPhone ? { supportPhone } : {}),
    ...(address ? { address } : {}),
    social,
  }
}
