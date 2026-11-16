import { toValue } from 'vue'

/**
 * The site description owned by the settings document, with the per-locale
 * override applied before the site-wide default. Returns an empty string when
 * neither is set, so callers can decide their own fallback (translated copy,
 * an empty-state notice, robots, ...).
 */
export const useSiteSeoDescription = (fallback?: MaybeRefOrGetter<string>) => {
  const { seo } = usePublicSite()
  const { locale } = useI18n()

  return computed(() => {
    const code = String(locale.value || '')
    const localized = seo.value?.defaultDescriptions?.[code]
    if (localized && localized.trim()) return localized.trim()
    if (seo.value?.defaultDescription) return seo.value.defaultDescription
    return toValue(fallback) ?? ''
  })
}
