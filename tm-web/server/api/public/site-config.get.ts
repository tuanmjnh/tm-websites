import { buildSiteConfig, SiteConfigSchema } from '@tm/flow-contracts'
import { withCatalogCacheHeaders } from '#server/utils/catalogCache'
import { eventCacheKey } from '#server/utils/publicCache'
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
  getKey: event => eventCacheKey(event, 'site', 'site-config'),
})

export default withCatalogCacheHeaders(defineEventHandler(async (event) => {
  const data = await cachedSiteConfig(event)
  return { success: true, data }
}))
