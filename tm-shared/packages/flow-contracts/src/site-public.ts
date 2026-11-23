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

/** A row inside a dropdown: a column heading whose own rows are leaves. */
export const PublicMenuChildSchema = PublicMenuLeafSchema.extend({
  children: z.array(PublicMenuLeafSchema).default([]),
})

export type PublicMenuChild = z.infer<typeof PublicMenuChildSchema>

/** A header row owns a dropdown of children, each of which may own links. */
export const PublicMenuItemSchema = PublicMenuLeafSchema.extend({
  children: z.array(PublicMenuChildSchema).default([]),
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
    /** Per-locale display name; absent locale keeps `name`. */
    names: z.record(z.string(), z.string()),
    email: z.string(),
    phone: z.string(),
    address: z.string(),
    logoMediaId: z.string(),
  }),
  seo: z.object({
    titleTemplate: z.string(),
    /** Locale overrides; an absent locale keeps `titleTemplate`. */
    titleTemplates: z.record(z.string(), z.string()),
    /** Per-locale default description; absent locale keeps `defaultDescription`. */
    defaultDescriptions: z.record(z.string(), z.string()),
    /** Per-locale default OG image media id; absent locale keeps `defaultImageMediaId`. */
    defaultImageMediaIds: z.record(z.string(), z.string()),
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
    company: { name: '', names: {}, email: '', phone: '', address: '', logoMediaId: '' },
    seo: { titleTemplate: '%s', titleTemplates: {}, defaultDescriptions: {}, defaultImageMediaIds: {}, defaultDescription: '', defaultImageMediaId: '' },
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
 * path the storefront serves, a content-category key becomes `/danh-muc/<slug>`,
 * and a product-category key becomes `/categories/<slug>` — two different
 * landing pages, which is why they are two link types.
 */
export function publicMenuHref(
  link: { type: string, target: string },
  categorySlug?: string | null,
  productCategorySlug?: string | null,
): string | null {
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

  if (link.type === 'product-category') {
    const slug = (productCategorySlug || target.split('/').filter(Boolean).pop() || '').trim()
    return slug ? `/categories/${encodeURIComponent(slug)}` : null
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
  resolveProductCategorySlug: (key: string) => string | undefined = () => undefined,
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
      type === 'product-category' ? resolveProductCategorySlug(target) ?? null : null,
    )
    if (!href) return null

    const vi = readString(label.vi)
    const en = readString(label.en)
    if (!vi && !en) return null

    return { label: { vi, en }, href }
  }

  const childrenOfRaw = (raw: unknown): unknown[] => {
    const record = readRecord(raw)
    return Array.isArray(record.children) ? (record.children as unknown[]) : []
  }

  // Level 2: a row inside a dropdown, plus the links it owns at level 3.
  const toChild = (raw: unknown): PublicMenuChild | null => {
    const leaf = toLeaf(raw)
    if (!leaf) return null
    const children: PublicMenuLeaf[] = []
    for (const childRaw of childrenOfRaw(raw)) {
      const childLeaf = toLeaf(childRaw)
      if (childLeaf) children.push(childLeaf)
    }
    return { ...leaf, children }
  }

  // Level 1: a header row whose dropdown rows may each own links.
  const toItem = (raw: unknown): PublicMenuItem | null => {
    const leaf = toLeaf(raw)
    if (!leaf) return null
    const children: PublicMenuChild[] = []
    for (const childRaw of childrenOfRaw(raw)) {
      const child = toChild(childRaw)
      if (child) children.push(child)
    }
    return { ...leaf, children }
  }

  const rawItems = Array.isArray(doc.items) ? doc.items : []
  const items: PublicMenuItem[] = []

  for (const raw of rawItems) {
    const item = toItem(raw)
    if (!item) continue
    items.push(item)
  }

  return { key, items }
}

/**
 * Builds the whole projection from already-read documents, so the mapping is
 * testable without a database connection. `categorySlugs` maps a category key
 * to the slug the storefront serves for the requested locale.
 */
/**
 * Locale templates are advisory: only enabled locales with a non-empty string are
 * published, and the storefront falls back to `titleTemplate` for the rest.
 */
function readTitleTemplates(input: unknown, enabled: readonly string[]): Record<string, string> {
  if (!input || typeof input !== 'object') return {}
  const source = input as Record<string, unknown>
  const allowed = enabled.length ? enabled : ['vi']
  const result: Record<string, string> = {}
  for (const locale of allowed) {
    const value = source[locale]
    if (typeof value === 'string' && value.trim()) result[locale] = value.trim()
  }
  return result
}

/**
 * Locale company names are advisory: only enabled locales with a non-empty
 * string are published, and the storefront falls back to `name`.
 */
function readCompanyNames(input: unknown, enabled: readonly string[]): Record<string, string> {
  if (!input || typeof input !== 'object') return {}
  const source = input as Record<string, unknown>
  const allowed = enabled.length ? enabled : ['vi']
  const result: Record<string, string> = {}
  for (const locale of allowed) {
    const value = source[locale]
    if (typeof value === 'string' && value.trim()) result[locale] = value.trim()
  }
  return result
}

/**
 * Locale descriptions are advisory: only enabled locales with a non-empty string
 * are published, and the storefront falls back to `defaultDescription`.
 */
function readDefaultDescriptions(input: unknown, enabled: readonly string[]): Record<string, string> {
  if (!input || typeof input !== 'object') return {}
  const source = input as Record<string, unknown>
  const allowed = enabled.length ? enabled : ['vi']
  const result: Record<string, string> = {}
  for (const locale of allowed) {
    const value = source[locale]
    if (typeof value === 'string' && value.trim()) result[locale] = value.trim()
  }
  return result
}

/**
 * Locale OG image media ids are advisory: only enabled locales with a non-empty
 * string are published, and the storefront falls back to `defaultImageMediaId`.
 */
function readDefaultImageMediaIds(input: unknown, enabled: readonly string[]): Record<string, string> {
  if (!input || typeof input !== 'object') return {}
  const source = input as Record<string, unknown>
  const allowed = enabled.length ? enabled : ['vi']
  const result: Record<string, string> = {}
  for (const locale of allowed) {
    const value = source[locale]
    if (typeof value === 'string' && value.trim()) result[locale] = value.trim()
  }
  return result
}

export function buildPublicSite(input: {
  settings: Record<string, unknown> | null
  menus: readonly Record<string, unknown>[]
  categorySlugs?: ReadonlyMap<string, string> | Record<string, string>
  productCategorySlugs?: ReadonlyMap<string, string> | Record<string, string>
}): PublicSite {
  const settings = input.settings ?? {}
  const company = readRecord(settings.company)
  const seo = readRecord(settings.seo)
  const locales = readRecord(settings.locales)

  // A Map from the reader, or a plain lookup object from a caller/test.
  const readMap = (map: ReadonlyMap<string, string> | Record<string, string> | undefined, key: string): string | undefined => {
    if (!map) return undefined
    if (typeof (map as Map<string, string>).get === 'function') {
      return (map as Map<string, string>).get(key)
    }
    return (map as Record<string, string>)[key]
  }

  const menus = input.menus
    .map(doc => toPublicMenu(
      doc,
      key => readMap(input.categorySlugs, key),
      key => readMap(input.productCategorySlugs, key),
    ))
    .filter((menu): menu is PublicMenu => menu !== null)
    .sort((left, right) => left.key.localeCompare(right.key))

  const enabled = Array.isArray(locales.enabled)
    ? locales.enabled.filter((entry): entry is string => typeof entry === 'string')
    : []

  return {
    company: {
      name: readString(company.name),
      names: readCompanyNames(company.names, enabled),
      email: readString(company.email),
      phone: readString(company.phone),
      address: readString(company.address),
      logoMediaId: readString(company.logoMediaId),
    },
    seo: {
      titleTemplate: readString(seo.titleTemplate, '%s'),
      titleTemplates: readTitleTemplates(seo.titleTemplates, enabled),
      defaultDescriptions: readDefaultDescriptions(seo.defaultDescriptions, enabled),
      defaultImageMediaIds: readDefaultImageMediaIds(seo.defaultImageMediaIds, enabled),
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
