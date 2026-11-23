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
  PublicCatalogCategoryModel,
  PublicSettingsModel,
  PublicSiteMenuModel,
  buildCatalogCategorySlugMap,
  buildCategorySlugMap,
} from '#server/models/sitePublic'
import { PublicCategoryModel } from '#server/models/contentCategoryPublic'
import type { CatalogCategorySlugDoc, CategorySlugDoc } from '#server/models/sitePublic'
import { withSiteDb } from './mongo'

/**
 * Public site read path for the storefront.
 *
 * The CMS writes `settings` and `site_menus` into the customer database; the
 * storefront reads them directly with its own projection. Company identity, SEO
 * defaults and the enabled locales come from the settings document, and every
 * menu item is resolved to a path here — a content key becomes the catch-all
 * path, a content-category key becomes `/danh-muc/<slug>` for the requested
 * locale, and a product-category key becomes `/categories/<slug>`.
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

    // Children resolve to the same landing pages as their parent, so their
    // category keys have to be collected too or a dropdown link loses its slug.
    const categoryKeys = new Set<string>()
    const productCategoryKeys = new Set<string>()
    for (const menu of menuDocs) {
      const items = Array.isArray(menu.items) ? menu.items : []
      for (const raw of items) {
        const item = raw as {
          link?: { type?: unknown, target?: unknown }
          children?: Array<{ link?: { type?: unknown, target?: unknown }, children?: Array<{ link?: { type?: unknown, target?: unknown } }> }>
        }
        const children = Array.isArray(item.children) ? item.children : []
        const links = [
          item.link,
          ...children.map(child => child.link),
          ...children.flatMap(child => (Array.isArray(child.children) ? child.children.map(grandChild => grandChild.link) : [])),
        ]
        for (const link of links) {
          if (typeof link?.target !== 'string') continue
          const key = link.target.trim()
          if (!key) continue
          if (link.type === 'category') categoryKeys.add(key)
          if (link.type === 'product-category') productCategoryKeys.add(key)
        }
      }
    }

    const [categoryDocs, productCategoryDocs] = await Promise.all([
      categoryKeys.size
        ? PublicCategoryModel
            .find({ key: { $in: [...categoryKeys] } })
            .select('key locales')
            .lean<CategorySlugDoc[]>()
        : Promise.resolve<CategorySlugDoc[]>([]),
      productCategoryKeys.size
        ? PublicCatalogCategoryModel
            .find({ key: { $in: [...productCategoryKeys] }, isDeleted: { $ne: true } })
            .select('key slug')
            .lean<CatalogCategorySlugDoc[]>()
        : Promise.resolve<CatalogCategorySlugDoc[]>([]),
    ])

    return buildPublicSite({
      settings,
      menus: menuDocs,
      categorySlugs: buildCategorySlugMap(categoryDocs, locale),
      productCategorySlugs: buildCatalogCategorySlugMap(productCategoryDocs, locale),
    })
  })
}
