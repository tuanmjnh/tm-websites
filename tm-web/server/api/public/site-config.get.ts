import { buildSiteConfig, SiteConfigSchema } from '@tm/flow-contracts'
import { siteCacheKey, withCatalogCacheHeaders } from '#server/utils/catalogCache'
import { fetchHubPublicConfig } from '#server/utils/hubPublicConfig'

const cachedSiteConfig = cachedEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const appConfig = useAppConfig() as { customer?: { companyName?: string } }

  const { values } = await fetchHubPublicConfig(event)

  return SiteConfigSchema.parse(
    buildSiteConfig({
      values,
      companyName: String(appConfig.customer?.companyName || 'TM Web'),
      currency: String(config.public.currency || 'VND'),
    })
  )
}, {
  maxAge: 120,
  staleMaxAge: 600,
  swr: true,
  getKey: event => siteCacheKey(event, 'site-config'),
})

export default withCatalogCacheHeaders(defineEventHandler(async (event) => {
  const data = await cachedSiteConfig(event)
  return { success: true, data }
}))
