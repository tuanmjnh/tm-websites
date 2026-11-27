import { toValue } from 'vue'

/**
 * The OG image the settings document names: the per-locale override first, then
 * the resolved site-wide default, then the caller's fallback (the bundled cover).
 *
 * Returns an empty string when nothing is resolved and no fallback is given, so a
 * page can decide not to publish an `og:image` at all instead of an empty one.
 */
export const useSiteSeoImage = (fallback?: MaybeRefOrGetter<string>) => {
  const { seoImageUrl } = usePublicSite()

  return computed(() => seoImageUrl.value || toValue(fallback) || '')
}
