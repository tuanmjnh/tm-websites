import { z } from 'zod'

export const BrandThemeSchema = z.object({
  primary: z.string().default('violet'),
  secondary: z.string().default('indigo'),
  neutral: z.string().default('zinc'),
  radius: z.enum(['2px', '4px', '6px', '8px', '10px']).default('6px'),
  logoUrl: z.string().optional(),
  faviconUrl: z.string().optional(),
})
export type BrandTheme = z.infer<typeof BrandThemeSchema>

export const ModuleEntitlementsSchema = z.object({
  catalog: z.boolean().default(true),
  orders: z.boolean().default(true),
  inventory: z.boolean().default(false),
  purchaseOrders: z.boolean().default(false),
  finance: z.boolean().default(false),
  hr: z.boolean().default(false),
  reports: z.boolean().default(true),
  media: z.boolean().default(true),
  aiWorkspace: z.boolean().default(false),
})
export type ModuleEntitlements = z.infer<typeof ModuleEntitlementsSchema>

export const CustomerConfigSchema = z
  .object({
    customerId: z.string().min(1),
    tenantId: z.string().min(1),
    cmsAppId: z.string().min(1).optional(),
    webAppId: z.string().min(1).optional(),
    companyName: z.string().min(1),
    domains: z.array(z.string()).default([]),
    defaultLocale: z.string().default('vi'),
    supportedLocales: z.array(z.string()).default(['vi', 'en']),
    theme: BrandThemeSchema.prefault({}),
    entitlements: ModuleEntitlementsSchema.prefault({}),
  })
  .refine((config) => Boolean(config.cmsAppId || config.webAppId), {
    message: 'Customer config must declare cmsAppId, webAppId, or both',
    path: ['cmsAppId'],
  })
export type CustomerConfig = z.infer<typeof CustomerConfigSchema>

export function parseCustomerConfig(raw: unknown): CustomerConfig {
  return CustomerConfigSchema.parse(raw)
}

