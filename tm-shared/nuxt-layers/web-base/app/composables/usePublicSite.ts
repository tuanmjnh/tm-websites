import type { PublicSite } from '@tm/flow-contracts/site-public'
import {
  PUBLIC_MENU_FOOTER,
  PUBLIC_MENU_HEADER,
  findPublicMenu,
  publicMenuLabel,
} from '@tm/flow-contracts/site-public'

export interface PublicSiteLink {
  label: string
  to: string
}

/**
 * Reads the public site projection once per render (company identity, SEO
 * defaults and CMS-owned menus) and keeps the static values as a fallback.
 *
 * A site that has not saved its settings, or a failing read, must never leave
 * the storefront with an empty header: `useSiteConfig()` still supplies the
 * customer's company name and the built-in navigation is used until menus exist.
 */
export const usePublicSite = () => {
  const { t, locale } = useI18n()
  const { companyName, siteConfig } = useSiteConfig()

  const { data } = useAsyncData<PublicSite | null>(
    'public-site',
    async () => {
      try {
        const response = await $fetch<{ success: boolean, data: PublicSite }>('/api/public/site', {
          query: { locale: locale.value },
        })
        return response.data ?? null
      } catch {
        return null
      }
    },
    { default: () => null, watch: [locale] },
  )

  const publicSite = computed(() => data.value ?? null)
  const company = computed(() => publicSite.value?.company)
  const seo = computed(() => publicSite.value?.seo)

  const brandName = computed(() => company.value?.name || companyName.value)
  const contactEmail = computed(() => company.value?.email || siteConfig.value.supportEmail || '')
  const contactPhone = computed(() => company.value?.phone || siteConfig.value.supportPhone || '')
  const contactAddress = computed(() => company.value?.address || siteConfig.value.address || '')

  const menuLinks = (key: string): PublicSiteLink[] | null => {
    const menu = findPublicMenu(publicSite.value?.menus ?? [], key)
    if (!menu?.items.length) return null
    return menu.items
      .map(item => ({ label: publicMenuLabel(item.label, locale.value), to: item.href }))
      .filter(link => link.label)
  }

  const fallbackHeaderLinks = computed<PublicSiteLink[]>(() => [
    { label: t('nav.home'), to: '/' },
    { label: t('nav.products'), to: '/products' },
    { label: t('nav.categories'), to: '/categories' },
    { label: t('nav.about'), to: '/about' },
    { label: t('nav.contact'), to: '/contact' },
    { label: t('nav.search'), to: '/tim-kiem' },
  ])

  const fallbackFooterLinks = computed<PublicSiteLink[]>(() => [
    { label: t('nav.products'), to: '/products' },
    { label: t('nav.categories'), to: '/categories' },
    { label: t('nav.about'), to: '/about' },
    { label: t('nav.contact'), to: '/contact' },
  ])

  const headerLinks = computed(() => menuLinks(PUBLIC_MENU_HEADER) ?? fallbackHeaderLinks.value)
  const footerLinks = computed(() => menuLinks(PUBLIC_MENU_FOOTER) ?? fallbackFooterLinks.value)

  return {
    publicSite,
    company,
    seo,
    brandName,
    contactEmail,
    contactPhone,
    contactAddress,
    headerLinks,
    footerLinks,
  }
}
