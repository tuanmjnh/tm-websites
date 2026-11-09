import { z } from 'zod'

/**
 * Site menus: the navigation a customer owns, edited in the CMS and rendered by
 * the storefront later.
 *
 * A menu is an immutable `key` (`main`, `footer`) plus an ordered list of items.
 * An item carries a per-locale label and one link target: a content key, a
 * category key, or a path/URL the editor typed. Only ids and keys are stored, so
 * a renamed record changes its own title without rewriting every menu.
 */

export const MENU_LOCALES = ['vi', 'en'] as const
export type MenuLocale = (typeof MENU_LOCALES)[number]

export const MENU_LINK_TYPES = ['content', 'category', 'url'] as const
export type MenuLinkType = (typeof MENU_LINK_TYPES)[number]

/** A navigation block is small; the cap keeps one document bounded. */
export const MENU_MAX_ITEMS = 30
export const MENU_LABEL_MAX = 80
export const MENU_TARGET_MAX = 300

const LabelSchema = z.object({
  vi: z.string().trim().max(MENU_LABEL_MAX),
  en: z.string().trim().max(MENU_LABEL_MAX),
})

export const AdminMenuItemSchema = z.object({
  label: LabelSchema,
  link: z.object({
    type: z.enum(MENU_LINK_TYPES),
    target: z.string().trim().max(MENU_TARGET_MAX),
  }),
})

export type AdminMenuItem = z.infer<typeof AdminMenuItemSchema>

export const AdminMenuSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  key: z.string(),
  name: z.string(),
  revision: z.number().int().nonnegative(),
  items: z.array(AdminMenuItemSchema),
  itemCount: z.number().int().nonnegative(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export type AdminMenu = z.infer<typeof AdminMenuSchema>

/** The list view needs the key, the name and how full the menu is — not items. */
export const AdminMenuSummarySchema = AdminMenuSchema.pick({
  id: true,
  siteId: true,
  key: true,
  name: true,
  revision: true,
  itemCount: true,
  updatedAt: true,
})

export type AdminMenuSummary = z.infer<typeof AdminMenuSummarySchema>

export const AdminMenuCreateSchema = z.object({
  key: trimmed(60),
  name: trimmed(120),
})

export type AdminMenuCreate = z.infer<typeof AdminMenuCreateSchema>

/** `revision` is the lock the editor loaded; everything else is optional. */
export const AdminMenuPatchSchema = z.object({
  revision: z.number().int().min(1),
  name: trimmed(120).optional(),
  items: z.array(AdminMenuItemSchema).max(MENU_MAX_ITEMS).optional(),
  key: z.string().optional(),
})

export type AdminMenuPatch = z.infer<typeof AdminMenuPatchSchema>

function trimmed(max: number) {
  return z.string().trim().max(max)
}

export function emptyMenuItem(): AdminMenuItem {
  return { label: { vi: '', en: '' }, link: { type: 'url', target: '/' } }
}

/**
 * What the item dialog can offer instead of a typed key: the pages and categories
 * this site actually has. A label is the `vi` title/name, then `en`, then the key,
 * so an untranslated record still appears. The cap keeps one response small; the
 * list is sorted by key for a stable order between opens.
 */
export const MENU_LINK_OPTIONS_LIMIT = 200

export const MenuLinkOptionSchema = z.object({
  key: z.string(),
  label: z.string(),
})

export type MenuLinkOption = z.infer<typeof MenuLinkOptionSchema>

export const MenuLinkOptionsSchema = z.object({
  content: z.array(MenuLinkOptionSchema),
  category: z.array(MenuLinkOptionSchema),
})

export type MenuLinkOptions = z.infer<typeof MenuLinkOptionsSchema>
