import { z } from 'zod'

/**
 * Public site projection: what the storefront may know about a site.
 *
 * The CMS owns `settings` and `site_menus`; the storefront reads them directly
 * and only ever receives this allowlist. Nothing here is a secret: Hub keeps
 * endpoints and credentials, and the CMS admin fields (revisions, actors, module
 * switches) stay private.
 */

export const PUBLIC_MENU_LOCALES = ['vi', 'en'] as const
export type PublicMenuLocale = (typeof PUBLIC_MENU_LOCALES)[number]

/** Header and footer are the two blocks the storefront renders today. */
export const PUBLIC_MENU_HEADER = 'main'
export const PUBLIC_MENU_FOOTER = 'footer'

export const PublicMenuLeafSchema = z.object({
  /** Both labels are kept so the client can fall back without a second call. */
  label: z.object({ vi: z.string(), en: z.string() }),
  /** Already resolved: a URL path or an absolute link, safe to pass to NuxtLink. */
  href: z.string(),
})

export type PublicMenuLeaf = z.infer<typeof PublicMenuLeafSchema>

/** A header row may own a dropdown; those rows are leaves. */
export const PublicMenuItemSchema = PublicMenuLeafSchema.extend({
  children: z.array(PublicMenuLeafSchema).default([]),
})

export type PublicMenuItem = z.infer<typeof PublicMenuItemSchema>

export const PublicMenuSchema = z.object({
  key: z.string(),
  items: z.array(PublicMenuItemSchema),
})

export type PublicMenu = z.infer<typeof PublicMenuSchema>

export const PublicSiteSchema = z.object({
  company: z.object({
    name: z.string(),
    email: z.string(),
    phone: z.string(),
    address: z.string(),
    logoMediaId: z.string(),
  }),
  seo: z.object({
    titleTemplate: z.string(),
    defaultDescription: z.string(),
    defaultImageMediaId: z.string(),
  }),
  locales: z.object({
    default: z.string(),
    enabled: z.array(z.string()),
  }),
  menus: z.array(PublicMenuSchema),
})

export type PublicSite = z.infer<typeof PublicSiteSchema>

export function emptyPublicSite(): PublicSite {
  return {
    company: { name: '', email: '', phone: '', address: '', logoMediaId: '' },
    seo: { titleTemplate: '%s', defaultDescription: '', defaultImageMediaId: '' },
    locales: { default: 'vi', enabled: ['vi'] },
    menus: [],
  }
}

/** The menu with this key, or `null` when the site never created one. */
export function findPublicMenu(menus: readonly PublicMenu[], key: string): PublicMenu | null {
  return menus.find(menu => menu.key === key) ?? null
}

/**
 * Label for the requested locale, then Vietnamese, then English. Returns an
 * empty string when the item has no label at all, so the caller decides whether
 * to hide the row instead of printing an empty link.
 */
export function publicMenuLabel(
  label: { vi: string, en: string },
  locale: string,
): string {
  const wanted = locale.toLowerCase().split('-')[0]
  const direct = wanted === 'en' ? label.en : wanted === 'vi' ? label.vi : ''
  return direct || label.vi || label.en || ''
}

/**
 * A menu target is never trusted as a URL. `url` targets were validated by the
 * CMS (rooted path or absolute http(s)); a content key becomes the catch-all
 * path the storefront serves, and a category key becomes its landing page.
 */
export function publicMenuHref(link: { type: string, target: string }, categorySlug?: string | null): string | null {
  const target = link.target.trim()
  if (!target) return null

  if (link.type === 'content') {
    const parts = target.split('/').filter(Boolean)
    const last = parts[parts.length - 1]
    return last ? `/${encodeURIComponent(last)}` : null
  }

  if (link.type === 'category') {
    const slug = (categorySlug || target.split('/').filter(Boolean).pop() || '').trim()
    return slug ? `/danh-muc/${encodeURIComponent(slug)}` : null
  }

  if (link.type === 'url') {
    const absolute = /^https?:\/\/[^\s]+$/.test(target)
    const rooted = target.startsWith('/') && !target.startsWith('//')
    return absolute || rooted ? target : null
  }

  return null
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/**
 * Maps one stored menu document (as read from `site_menus`) to the public
 * projection. An item whose target cannot be resolved is dropped rather than
 * rendered as a dead link; an empty menu is kept so the storefront can tell
 * "no menu" from "menu with nothing usable".
 */
export function toPublicMenu(
  doc: Record<string, unknown>,
  resolveCategorySlug: (key: string) => string | undefined = () => undefined,
): PublicMenu | null {
  const key = readString(doc.key)
  if (!key) return null

  const toLeaf = (raw: unknown): PublicMenuLeaf | null => {
    const item = readRecord(raw)
    const label = readRecord(item.label)
    const link = readRecord(item.link)

    const type = readString(link.type)
    const target = readString(link.target).trim()
    const href = publicMenuHref(
      { type, target },
      type === 'category' ? resolveCategorySlug(target) ?? null : null,
    )
    if (!href) return null

    const vi = readString(label.vi)
    const en = readString(label.en)
    if (!vi && !en) return null

    return { label: { vi, en }, href }
  }

  const rawItems = Array.isArray(doc.items) ? doc.items : []
  const items: PublicMenuItem[] = []

  for (const raw of rawItems) {
    const leaf = toLeaf(raw)
    if (!leaf) continue

    const rawChildren = Array.isArray(readRecord(raw).children) ? (readRecord(raw).children as unknown[]) : []
    const children = rawChildren
      .map(child => toLeaf(child))
      .filter((child): child is PublicMenuLeaf => child !== null)

    items.push({ ...leaf, children })
  }

  return { key, items }
}

/**
 * Builds the whole projection from already-read documents, so the mapping is
 * testable without a database connection. `categorySlugs` maps a category key
 * to the slug the storefront serves for the requested locale.
 */
export function buildPublicSite(input: {
  settings: Record<string, unknown> | null
  menus: readonly Record<string, unknown>[]
  categorySlugs?: ReadonlyMap<string, string> | Record<string, string>
}): PublicSite {
  const settings = input.settings ?? {}
  const company = readRecord(settings.company)
  const seo = readRecord(settings.seo)
  const locales = readRecord(settings.locales)

  const slugOf = (key: string): string | undefined => {
    const map = input.categorySlugs
    if (!map) return undefined
    // A Map from the reader, or a plain lookup object from a caller/test.
    if (typeof (map as Map<string, string>).get === 'function') {
      return (map as Map<string, string>).get(key)
    }
    return (map as Record<string, string>)[key]
  }

  const menus = input.menus
    .map(doc => toPublicMenu(doc, slugOf))
    .filter((menu): menu is PublicMenu => menu !== null)
    .sort((left, right) => left.key.localeCompare(right.key))

  const enabled = Array.isArray(locales.enabled)
    ? locales.enabled.filter((entry): entry is string => typeof entry === 'string')
    : []

  return {
    company: {
      name: readString(company.name),
      email: readString(company.email),
      phone: readString(company.phone),
      address: readString(company.address),
      logoMediaId: readString(company.logoMediaId),
    },
    seo: {
      titleTemplate: readString(seo.titleTemplate, '%s'),
      defaultDescription: readString(seo.defaultDescription),
      defaultImageMediaId: readString(seo.defaultImageMediaId),
    },
    locales: {
      default: readString(locales.default, 'vi'),
      enabled: enabled.length ? enabled : ['vi'],
    },
    menus,
  }
}
