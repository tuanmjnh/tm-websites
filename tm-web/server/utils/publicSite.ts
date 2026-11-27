import type { H3Event } from 'h3'
import type { PublicSite } from '@tm/flow-contracts/site-public'
import { buildPublicSite } from '@tm/flow-contracts/site-public'
import {
  DEFAULT_PUBLIC_CONTENT_LOCALE,
  normalizePublicLocale,
} from '@tm/flow-contracts/content-public'
import {
  PUBLIC_MEDIA_PROJECTION,
  PUBLIC_MENU_PROJECTION,
  PUBLIC_SETTINGS_PROJECTION,
  PublicCatalogCategoryModel,
  PublicMediaModel,
  PublicSettingsModel,
  PublicSiteMenuModel,
  buildCatalogCategorySlugMap,
  buildCategorySlugMap,
  buildMediaUrlMap,
  isMediaId,
} from '#server/models/sitePublic'
import { PublicCategoryModel } from '#server/models/contentCategoryPublic'
import type { CatalogCategorySlugDoc, CategorySlugDoc, MediaUrlDoc } from '#server/models/sitePublic'
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

/**
 * The settings store media ids, not URLs. Files live in the CMS media store and
 * are served by its origin (`/media/<storage key>`), so an id is only resolvable
 * when `TM_MEDIA_BASE_URL` names that public origin. Without it the projection
 * keeps the ids and every URL stays empty, which is what the storefront did
 * before; a broken guess at an origin would be worse than the bundled fallback.
 */
async function readMediaUrls(
  event: H3Event,
  settings: Record<string, unknown> | null,
): Promise<Map<string, string>> {
  if (!settings) return new Map()
  const mediaBaseUrl = String(useRuntimeConfig(event).mediaBaseUrl || '')
  if (!mediaBaseUrl.trim()) return new Map()

  const company = settings.company as Record<string, unknown> | undefined
  const seo = settings.seo as Record<string, unknown> | undefined
  const ids = new Set<string>()
  const add = (value: unknown) => {
    if (isMediaId(value)) ids.add(value)
  }
  add(company?.logoMediaId)
  add(seo?.defaultImageMediaId)
  const localized = seo?.defaultImageMediaIds
  if (localized && typeof localized === 'object') {
    for (const value of Object.values(localized as Record<string, unknown>)) add(value)
  }
  if (!ids.size) return new Map()

  const docs = await PublicMediaModel
    .find({ _id: { $in: [...ids] }, kind: 'image' })
    .select(PUBLIC_MEDIA_PROJECTION)
    .lean<MediaUrlDoc[]>()
  return buildMediaUrlMap(docs, mediaBaseUrl)
}

export async function readPublicSite(event: H3Event, locale: string): Promise<PublicSite> {
  return withSiteDb(event, async () => {
    const [settings, menuDocs] = await Promise.all([
      PublicSettingsModel.findOne({}).select(PUBLIC_SETTINGS_PROJECTION).lean<Record<string, unknown> | null>(),
      PublicSiteMenuModel.find({}).select(PUBLIC_MENU_PROJECTION).sort({ key: 1 }).lean<Record<string, unknown>[]>(),
    ])
    const mediaUrls = await readMediaUrls(event, settings)

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
      mediaUrls,
    })
  })
}
