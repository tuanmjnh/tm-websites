import { z } from 'zod'

/**
 * Site settings: the company, locale and module switches a customer owns.
 *
 * One document per site, editable from the CMS and readable by the storefront
 * later. Hub keeps the connection registry (credentials, endpoints); nothing
 * here stores a secret, a token or an endpoint, so the whole document is safe to
 * serve to an authenticated admin.
 */

export const SETTINGS_LOCALES = ['vi', 'en'] as const
export type SettingsLocale = (typeof SETTINGS_LOCALES)[number]

export const SITE_MODULES = ['content', 'catalog', 'orders', 'inventory'] as const
export type SiteModule = (typeof SITE_MODULES)[number]

const trimmed = (max: number) => z.string().trim().max(max)

const CompanySchema = z.object({
  name: trimmed(120),
  legalName: trimmed(160),
  taxId: trimmed(40),
  email: z.union([z.literal(''), z.string().trim().email().max(160)]),
  phone: trimmed(40),
  address: trimmed(200),
  logoMediaId: trimmed(64),
})

const SeoSchema = z.object({
  titleTemplate: trimmed(160),
  /**
   * Optional per-locale override. A locale with no entry (or an empty one) keeps
   * using `titleTemplate`, so a single-language site never has to think about it.
   */
  titleTemplates: z.object({
    vi: trimmed(160),
    en: trimmed(160),
  }).partial(),
  defaultDescription: trimmed(300),
  defaultImageMediaId: trimmed(64),
})

const LocalesSchema = z.object({
  default: z.enum(SETTINGS_LOCALES),
  enabled: z.array(z.enum(SETTINGS_LOCALES)).min(1).max(SETTINGS_LOCALES.length),
})

const ModulesSchema = z.object(
  Object.fromEntries(SITE_MODULES.map(module => [module, z.boolean()])) as Record<SiteModule, z.ZodBoolean>,
)

export const AdminSiteSettingsSchema = z.object({
  siteId: z.string(),
  /** `0` means the site still runs on defaults and was never saved. */
  revision: z.number().int().nonnegative(),
  company: CompanySchema,
  seo: SeoSchema,
  locales: LocalesSchema,
  modules: ModulesSchema,
  updatedAt: z.string().nullable(),
  updatedBy: z
    .object({ id: z.string(), name: z.string(), email: z.string() })
    .nullable(),
})

export type AdminSiteSettings = z.infer<typeof AdminSiteSettingsSchema>

/** Every section is optional; `revision` is the lock the editor loaded. */
export const AdminSiteSettingsPatchSchema = z.object({
  revision: z.number().int().nonnegative(),
  company: CompanySchema.partial().optional(),
  seo: SeoSchema.partial().optional(),
  locales: LocalesSchema.partial().optional(),
  modules: ModulesSchema.partial().optional(),
})

export type AdminSiteSettingsPatch = z.infer<typeof AdminSiteSettingsPatchSchema>

export function defaultSiteSettings(siteId: string): AdminSiteSettings {
  return {
    siteId,
    revision: 0,
    company: {
      name: '',
      legalName: '',
      taxId: '',
      email: '',
      phone: '',
      address: '',
      logoMediaId: '',
    },
    seo: {
      titleTemplate: '%s',
      titleTemplates: {},
      defaultDescription: '',
      defaultImageMediaId: '',
    },
    locales: { default: 'vi', enabled: ['vi'] },
    modules: { content: true, catalog: false, orders: false, inventory: false },
    updatedAt: null,
    updatedBy: null,
  }
}
