import type { LocalizedString } from './types'

/**
 * Coerces a legacy localized field into a clean `locale -> text` map.
 * Records written before localization stored a plain string; empty entries are
 * dropped so the render model never carries blank translations.
 */
export const toLocalizedString = (value: unknown): LocalizedString => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? { vi: trimmed } : {}
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const result: LocalizedString = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && entry.trim()) result[key] = entry
  }
  return result
}

/**
 * Reads a localized map for the requested locale, falling back to the site
 * default and finally to any available translation.
 */
export const pickLocalized = (
  value: LocalizedString | string | null | undefined,
  locale: string,
  fallbackLocale = 'vi'
): string => {
  if (!value) return ''
  if (typeof value === 'string') return value

  for (const key of [locale, fallbackLocale, ...Object.keys(value)]) {
    const found = value[key]
    if (typeof found === 'string' && found.trim()) return found
  }
  return ''
}
