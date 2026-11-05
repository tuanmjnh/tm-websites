import type { SiteConfig } from '@tm/flow-contracts'

/**
 * Reads the public site configuration (company identity, contact channels,
 * social links) from the BFF. The endpoint never throws: when the Hub is
 * unreachable or has no public values it answers with `source: 'fallback'`,
 * so the layout always has something safe to render.
 */
export const useSiteConfig = () => {
  const { customer } = useCustomerConfig()

  const { data } = useAsyncData<SiteConfig | null>(
    'public:site-config',
    async () => {
      try {
        const response = await $fetch<{ success: boolean, data: SiteConfig }>('/api/public/site-config')
        return response.data ?? null
      } catch {
        return null
      }
    },
    { default: () => null }
  )

  const siteConfig = computed<SiteConfig>(() => data.value ?? {
    source: 'fallback',
    companyName: customer.value?.companyName || 'TM Web',
    currency: 'VND',
    social: {},
  })

  const companyName = computed(() => siteConfig.value.companyName || customer.value?.companyName || 'TM Web')
  const currency = computed(() => siteConfig.value.currency || 'VND')
  const socialLinks = computed(() => Object.entries(siteConfig.value.social ?? {}).filter(([, url]) => Boolean(url)))

  return {
    siteConfig,
    companyName,
    currency,
    socialLinks,
  }
}
