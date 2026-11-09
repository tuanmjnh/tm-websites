import { applySeoTitleTemplate } from '@tm/flow-utils/seo'

/**
 * The storefront `<title>` template, owned by the settings document.
 *
 * Pages keep their own title; this only decides how it is rendered, so a site can
 * switch from bare titles to `Page | Company` without touching every page. The
 * `%s` default in settings means "no suffix", which is why an unsaved template
 * leaves the page title untouched.
 */
export const useSiteSeoTitle = () => {
  const { seo } = usePublicSite()
  const { locale } = useI18n()

  // A locale override wins; otherwise the site-wide template applies, so a
  // single-language site never has to fill in the per-locale fields.
  const template = computed(() => {
    const code = String(locale.value || '')
    const localized = seo.value?.titleTemplates?.[code]
    if (localized && localized.trim()) return localized
    return seo.value?.titleTemplate ?? '%s'
  })

  const titleTemplate = (pageTitle?: string) => applySeoTitleTemplate(String(pageTitle ?? ''), template.value)

  return { template, titleTemplate }
}
