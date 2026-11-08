import type { H3Event } from 'h3'
import type { PublicSite } from '@tm/flow-contracts/site-public'
import { buildPublicSite } from '@tm/flow-contracts/site-public'
import {
  DEFAULT_PUBLIC_CONTENT_LOCALE,
  normalizePublicLocale,
} from '@tm/flow-contracts/content-public'
import {
  PUBLIC_MENU_PROJECTION,
  PUBLIC_SETTINGS_PROJECTION,
  PublicSettingsModel,
  PublicSiteMenuModel,
  buildCategorySlugMap,
} from '#server/models/sitePublic'
import { PublicCategoryModel } from '#server/models/contentCategoryPublic'
import type { CategorySlugDoc } from '#server/models/sitePublic'
import { withSiteDb } from './mongo'

/**
 * Public site read path for the storefront.
 *
 * The CMS writes `settings` and `site_menus` into the customer database; the
 * storefront reads them directly with its own projection. Company identity, SEO
 * defaults and the enabled locales come from the settings document, and every
 * menu item is resolved to a path here — a content key becomes the catch-all
 * path, a category key becomes its landing page slug for the requested locale.
 */

export function getSiteLocale(event: H3Event): string {
  const requested = getQuery(event).locale
  return normalizePublicLocale(Array.isArray(requested) ? requested[0] : requested)
    ?? DEFAULT_PUBLIC_CONTENT_LOCALE
}

export async function readPublicSite(event: H3Event, locale: string): Promise<PublicSite> {
  return withSiteDb(event, async () => {
    const [settings, menuDocs] = await Promise.all([
      PublicSettingsModel.findOne({}).select(PUBLIC_SETTINGS_PROJECTION).lean<Record<string, unknown> | null>(),
      PublicSiteMenuModel.find({}).select(PUBLIC_MENU_PROJECTION).sort({ key: 1 }).lean<Record<string, unknown>[]>(),
    ])

    const categoryKeys = new Set<string>()
    for (const menu of menuDocs) {
      const items = Array.isArray(menu.items) ? menu.items : []
      for (const raw of items) {
        const link = (raw as { link?: { type?: unknown, target?: unknown } }).link
        if (link?.type !== 'category' || typeof link.target !== 'string') continue
        const key = link.target.trim()
        if (key) categoryKeys.add(key)
      }
    }

    const categoryDocs = categoryKeys.size
      ? await PublicCategoryModel
          .find({ key: { $in: [...categoryKeys] } })
          .select('key locales')
          .lean<CategorySlugDoc[]>()
      : []

    return buildPublicSite({
      settings,
      menus: menuDocs,
      categorySlugs: buildCategorySlugMap(categoryDocs, locale),
    })
  })
}
