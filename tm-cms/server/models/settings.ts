import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import type { AuditActor } from './audit'

/**
 * One settings document per site.
 *
 * Hub owns the connection registry (endpoints, credentials); this collection is
 * business configuration the customer edits: company identity, SEO defaults,
 * enabled locales and which modules the site runs. Nothing secret belongs here,
 * which is why the document can be returned in full to an authenticated admin.
 */

export const SETTINGS_LOCALES = ['vi', 'en'] as const
export const SITE_MODULES = ['content', 'catalog', 'orders', 'inventory'] as const

export interface SiteSettingsCompany {
  name: string
  legalName: string
  taxId: string
  email: string
  phone: string
  address: string
  logoMediaId: string
}

export interface SiteSettingsSeo {
  titleTemplate: string
  defaultDescription: string
  defaultImageMediaId: string
}

export interface SiteSettingsLocales {
  default: string
  enabled: string[]
}

export type SiteSettingsModules = Record<string, boolean>

export interface SiteSettingsDocument {
  siteId: string
  revision: number
  company: SiteSettingsCompany
  seo: SiteSettingsSeo
  locales: SiteSettingsLocales
  modules: SiteSettingsModules
  updatedBy: AuditActor | null
  createdAt: Date
  updatedAt: Date
}

const CompanySchema = new Schema<SiteSettingsCompany>(
  {
    name: { type: String, default: '' },
    legalName: { type: String, default: '' },
    taxId: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    address: { type: String, default: '' },
    logoMediaId: { type: String, default: '' },
  },
  { _id: false },
)

const SeoSchema = new Schema<SiteSettingsSeo>(
  {
    titleTemplate: { type: String, default: '%s' },
    defaultDescription: { type: String, default: '' },
    defaultImageMediaId: { type: String, default: '' },
  },
  { _id: false },
)

const LocalesSchema = new Schema<SiteSettingsLocales>(
  {
    default: { type: String, enum: SETTINGS_LOCALES, default: 'vi' },
    enabled: { type: [String], default: () => ['vi'] },
  },
  { _id: false },
)

const ModulesSchema = new Schema<SiteSettingsModules>(
  Object.fromEntries(SITE_MODULES.map(module => [module, { type: Boolean, default: module === 'content' }])),
  { _id: false },
)

const ActorSchema = new Schema<AuditActor>(
  {
    id: { type: String, required: true },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
  },
  { _id: false },
)

export const settingsSchema = new Schema<SiteSettingsDocument>(
  {
    siteId: { type: String, required: true },
    revision: { type: Number, required: true, default: 0 },
    company: { type: CompanySchema, default: () => ({}) },
    seo: { type: SeoSchema, default: () => ({}) },
    locales: { type: LocalesSchema, default: () => ({}) },
    modules: { type: ModulesSchema, default: () => ({}) },
    updatedBy: { type: ActorSchema, default: null },
  },
  {
    collection: 'settings',
    timestamps: true,
    versionKey: false,
  },
)

/** One document per site; the unique index is what makes the upsert safe. */
settingsSchema.index({ siteId: 1 }, { name: 'settings_site_unique', unique: true })

export function siteSettingsModel(connection: Connection): Model<SiteSettingsDocument> {
  const registered = connection.models.SiteSettings as Model<SiteSettingsDocument> | undefined
  if (registered) return registered
  return connection.model<SiteSettingsDocument>('SiteSettings', settingsSchema, 'settings')
}

export async function syncSettingsIndexes(connection: Connection): Promise<void> {
  await siteSettingsModel(connection).createIndexes()
}
