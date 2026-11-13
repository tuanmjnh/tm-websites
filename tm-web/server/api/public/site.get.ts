import { PublicSiteSchema } from '@tm/flow-contracts/site-public'
import { siteCacheKey } from '#server/utils/catalogCache'
import { getSiteLocale, readPublicSite } from '#server/utils/publicSite'

/**
 * `GET /api/public/site` is the storefront's view of this site: company
 * identity, SEO defaults, enabled locales and the resolved header/footer menus.
 *
 * The document is read from the customer database (never from Hub, never from a
 * session), cached per locale, and contains no admin field: revisions, actors and
 * module switches stay private.
 */
export default defineCachedEventHandler(async (event) => {
  const locale = getSiteLocale(event)
  const site = await readPublicSite(event, locale)

  return {
    success: true,
    data: PublicSiteSchema.parse(site),
  }
}, {
  maxAge: 60,
  staleMaxAge: 300,
  swr: true,
  // Tenant first: two customers can share one Nitro cache in preview or local
  // multi-customer development, and this key used to carry the locale only.
  getKey: (event) => siteCacheKey(event, `public-site:${getSiteLocale(event)}`),
})
