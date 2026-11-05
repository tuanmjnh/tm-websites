import { z } from 'zod'

export const UserRoleSchema = z.enum(['superadmin', 'admin', 'manager', 'editor', 'staff', 'viewer'])
export type UserRole = z.infer<typeof UserRoleSchema>

export const UserSessionSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  username: z.string().nullish(),
  avatar: z.string().url().optional(),
  tenantId: z.string().min(1),
  appId: z.string().min(1),
  roles: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  allowedRoutes: z.array(z.string()).default([]),
  totpEnabled: z.boolean().optional(),
})
export type UserSession = z.infer<typeof UserSessionSchema>

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})
export type LoginRequest = z.infer<typeof LoginRequestSchema>

export const AuthTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  tokenType: z.string().default('Bearer'),
  expiresIn: z.number().int().positive().optional(),
})
export type AuthTokens = z.infer<typeof AuthTokensSchema>

export const HubAuthResponseSchema = z.object({
  user: UserSessionSchema,
  tokens: AuthTokensSchema,
})
export type HubAuthResponse = z.infer<typeof HubAuthResponseSchema>

export const LoginResponseSchema = z.object({
  user: UserSessionSchema,
  token: z.string().optional(),
  expiresAt: z.string().optional(),
  tokens: AuthTokensSchema.optional(),
})
export type LoginResponse = z.infer<typeof LoginResponseSchema>

export const TenantStatusSchema = z.enum(['active', 'suspended', 'inactive'])
export type TenantStatus = z.infer<typeof TenantStatusSchema>

export const TenantSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  status: TenantStatusSchema.default('active'),
})
export type Tenant = z.infer<typeof TenantSchema>

export const AppCodeSchema = z.enum(['tm-cms', 'tm-web'])
export type AppCode = z.infer<typeof AppCodeSchema>

export const AppInstallationStatusSchema = z.enum(['active', 'suspended', 'uninstalled'])
export type AppInstallationStatus = z.infer<typeof AppInstallationStatusSchema>

export const AppInstallationSchema = z.object({
  appId: z.string().min(1),
  appCode: AppCodeSchema,
  tenantId: z.string().min(1),
  environment: z.enum(['production', 'staging', 'development']).default('production'),
  status: AppInstallationStatusSchema.default('active'),
})
export type AppInstallation = z.infer<typeof AppInstallationSchema>

export const SiteSchema = z.object({
  siteId: z.string().min(1),
  tenantId: z.string().min(1),
  appId: z.string().min(1),
  primaryDomain: z.string().min(1).optional(),
  status: z.enum(['active', 'inactive']).default('active'),
})
export type Site = z.infer<typeof SiteSchema>

