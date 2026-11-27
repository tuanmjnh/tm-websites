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
  /** Dropdown rows. Empty for a plain link. */
  children?: PublicSiteLink[]
}

/**
 * Reads the public site projection once per render (company identity, SEO
 * defaults and CMS-owned menus) and keeps the static values as a fallback.
 *
 * A site that has not saved its settings, or a failing read, must never leave
 * the storefront with an empty header: `useSiteConfig()` still supplies the
 * customer's company name and the built-in navigation is used until menus exist.
 */
/**
 * The one public-site read. Nuxt shares an async-data entry by key, so every
 * component that asks for it (app shell, layout, page) joins the same request
 * instead of issuing another one.
 */
export const usePublicSiteData = () => {
  const { locale } = useI18n()

  return useAsyncData<PublicSite | null>(
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
}

/**
 * The listing affordance the site owner chose (`offset` = numbered pages,
 * `cursor` = load more).
 *
 * Awaiting the shared read before rendering matters: `usePublicSite` falls back
 * to `cursor` until the request resolves, so a server render would otherwise
 * paint the wrong mode — and the wrong canonical — on a `?page=` URL, then flip
 * after hydration.
 */
export const usePublicPaginationType = async () => {
  const { data } = await usePublicSiteData()
  return computed(() => data.value?.site?.paginationType ?? 'cursor')
}

export const usePublicSite = () => {
  const { t, locale } = useI18n()
  const { companyName, siteConfig, socialLinks: configuredSocialLinks } = useSiteConfig()

  const { data } = usePublicSiteData()

  const publicSite = computed(() => data.value ?? null)
  const company = computed(() => publicSite.value?.company)
  const seo = computed(() => publicSite.value?.seo)

  const brandName = computed(() => {
    const code = String(locale.value || '')
    const localized = company.value?.names?.[code]
    if (localized && localized.trim()) return localized.trim()
    return company.value?.name || companyName.value
  })
  /** Resolved by the web server from `TM_MEDIA_BASE_URL`; empty keeps the bundled logo. */
  const logoUrl = computed(() => company.value?.logoUrl || '')
  /** Locale override first, then the site-wide default image, then empty. */
  const seoImageUrl = computed(() => {
    const code = String(locale.value || '')
    const localized = seo.value?.defaultImageUrls?.[code]
    if (localized) return localized
    return seo.value?.defaultImageUrl || ''
  })
  const contactEmail = computed(() => company.value?.email || siteConfig.value.supportEmail || '')
  const contactPhone = computed(() => company.value?.phone || siteConfig.value.supportPhone || '')
  const contactAddress = computed(() => company.value?.address || siteConfig.value.address || '')

  /** Footer text, copyright and social profiles the customer saved in the CMS. */
  const siteInfo = computed(() => publicSite.value?.site ?? null)
  /** `offset` means numbered pages, `cursor` means a load-more button. */
  const paginationType = computed(() => siteInfo.value?.paginationType ?? 'cursor')
  const footerText = computed(() => siteInfo.value?.footerText || siteInfo.value?.copyright || '')
  const openingHours = computed(() => {
    const code = String(locale.value || '')
    return siteInfo.value?.openingHours?.[code] || siteInfo.value?.openingHours?.vi || ''
  })
  // The CMS list wins when it has rows; a site that never saved one keeps the
  // customer-layer links the build already shipped.
  const socialLinks = computed<Array<[string, string]>>(() => {
    const rows = siteInfo.value?.social ?? []
    if (!rows.length) return configuredSocialLinks.value as Array<[string, string]>
    return rows.map(row => [row.label || row.code, row.url] as [string, string])
  })

  const menuLinks = (key: string): PublicSiteLink[] | null => {
    const menu = findPublicMenu(publicSite.value?.menus ?? [], key)
    if (!menu?.items.length) return null
    return menu.items
      .map(item => ({
        label: publicMenuLabel(item.label, locale.value),
        to: item.href,
        children: item.children
          .map(child => ({
            label: publicMenuLabel(child.label, locale.value),
            to: child.href,
            // A mega-menu column heading owns its own links; a plain child row
            // has none and renders as one link.
            children: (child.children ?? [])
              .map(grandChild => ({ label: publicMenuLabel(grandChild.label, locale.value), to: grandChild.href }))
              .filter(grandChild => grandChild.label),
          }))
          .filter(child => child.label),
      }))
      .filter(link => link.label)
  }

  const fallbackHeaderLinks = computed<PublicSiteLink[]>(() => [
    { label: t('nav.home'), to: '/' },
    { label: t('nav.products'), to: '/products' },
    { label: t('nav.categories'), to: '/categories' },
    {
      label: t('nav.posts'),
      to: '/bai-viet',
      children: [{ label: t('nav.postCategories'), to: '/danh-muc' }],
    },
    { label: t('nav.about'), to: '/about' },
    { label: t('nav.contact'), to: '/contact' },
    { label: t('nav.search'), to: '/tim-kiem' },
  ])

  const fallbackFooterLinks = computed<PublicSiteLink[]>(() => [
    { label: t('nav.products'), to: '/products' },
    { label: t('nav.categories'), to: '/categories' },
    { label: t('nav.posts'), to: '/bai-viet' },
    { label: t('nav.postCategories'), to: '/danh-muc' },
    { label: t('nav.about'), to: '/about' },
    { label: t('nav.contact'), to: '/contact' },
  ])

  const headerLinks = computed(() => menuLinks(PUBLIC_MENU_HEADER) ?? fallbackHeaderLinks.value)
  /** The footer is a flat column, so every nested row follows its parent. */
  const flattenLinks = (links: PublicSiteLink[]): PublicSiteLink[] => links.flatMap(link => [
    link,
    ...flattenLinks(link.children ?? []),
  ])

  const footerLinks = computed<PublicSiteLink[]>(() =>
    flattenLinks(menuLinks(PUBLIC_MENU_FOOTER) ?? fallbackFooterLinks.value))

  return {
    publicSite,
    company,
    seo,
    brandName,
    logoUrl,
    seoImageUrl,
    contactEmail,
    contactPhone,
    contactAddress,
    siteInfo,
    paginationType,
    footerText,
    openingHours,
    socialLinks,
    headerLinks,
    footerLinks,
  }
}
