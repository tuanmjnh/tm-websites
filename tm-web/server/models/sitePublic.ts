import mongoose, { type Model } from 'mongoose'
import { DEFAULT_PUBLIC_CONTENT_LOCALE } from '@tm/flow-contracts/content-public'

/**
 * Read-only views of the CMS-owned `settings` and `site_menus` collections.
 *
 * The storefront needs the public half of each document only: company identity,
 * SEO defaults, enabled locales and the ordered menus. Revisions, actors, module
 * switches and the per-locale labels of unpublished choices stay in the database;
 * the storefront never writes these collections.
 */

export type PublicSettingsDoc = Record<string, unknown>
export type PublicMenuDoc = Record<string, unknown>

const settingsSchema = new mongoose.Schema<PublicSettingsDoc>(
  {
    siteId: String,
    company: { type: mongoose.Schema.Types.Mixed },
    seo: { type: mongoose.Schema.Types.Mixed },
    locales: { type: mongoose.Schema.Types.Mixed },
  },
  { strict: false, versionKey: false, timestamps: false, collection: 'settings' },
)

const menuSchema = new mongoose.Schema<PublicMenuDoc>(
  {
    siteId: String,
    key: String,
    name: String,
    revision: Number,
    items: { type: mongoose.Schema.Types.Mixed },
  },
  { strict: false, versionKey: false, timestamps: false, collection: 'site_menus' },
)

export const PublicSettingsModel: Model<PublicSettingsDoc> =
  mongoose.models.PublicSiteSettings
  ?? mongoose.model<PublicSettingsDoc>('PublicSiteSettings', settingsSchema)

export const PublicSiteMenuModel: Model<PublicMenuDoc> =
  mongoose.models.PublicSiteMenu
  ?? mongoose.model<PublicMenuDoc>('PublicSiteMenu', menuSchema)

export const PUBLIC_SETTINGS_PROJECTION = 'company seo locales'
export const PUBLIC_MENU_PROJECTION = 'key items'

export interface CategorySlugDoc {
  key?: unknown
  locales?: unknown
}

/**
 * Key to landing-page slug for the categories a menu links to. A category
 * without a slug for the requested locale falls back to the storefront default
 * locale, then to the key itself, so a menu never renders a dead link on a
 * partly translated site.
 */
export function buildCategorySlugMap(
  docs: readonly CategorySlugDoc[],
  locale: string,
): Map<string, string> {
  const wanted = locale.toLowerCase().split('-')[0] ?? ''
  const fallback = DEFAULT_PUBLIC_CONTENT_LOCALE
  const map = new Map<string, string>()

  for (const doc of docs) {
    const key = typeof doc.key === 'string' ? doc.key : ''
    if (!key) continue

    const entries = Array.isArray(doc.locales) ? doc.locales : []
    const read = (code: string) => {
      for (const raw of entries) {
        const entry = raw as { locale?: unknown, slug?: unknown }
        if (typeof entry.locale !== 'string' || typeof entry.slug !== 'string') continue
        if (entry.locale.toLowerCase().split('-')[0] === code && entry.slug) return entry.slug
      }
      return ''
    }

    map.set(key, read(wanted) || read(fallback) || key)
  }

  return map
}
