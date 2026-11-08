import type { Model } from 'mongoose'
import type { AdminSiteSettings, AdminSiteSettingsPatch } from '@tm/flow-contracts/settings-admin'
import {
  AdminSiteSettingsPatchSchema,
  SETTINGS_LOCALES,
  SITE_MODULES,
  defaultSiteSettings,
} from '@tm/flow-contracts/settings-admin'
import type { AuditActor, AuditEntryDocument } from '../models/audit'
import type { SiteSettingsDocument } from '../models/settings'
import { recordContentAudit } from './contentAudit'

/**
 * Site settings commands. One document per site, protected by the same monotonic
 * `revision` as content: an editor saves against the revision it loaded, and a
 * stale save is refused instead of silently overwriting a colleague.
 */

export class SettingsServiceError extends Error {
  statusCode: number
  code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = 'SettingsServiceError'
    this.statusCode = statusCode
    this.code = code
  }
}

export interface SettingsWriteMeta {
  audit: { model: Model<AuditEntryDocument>, actor?: AuditActor, requestId?: string | null }
}

type SettingsRecord = SiteSettingsDocument & { _id: unknown }

function toAdminSettings(record: SettingsRecord): AdminSiteSettings {
  return {
    siteId: record.siteId,
    revision: record.revision,
    company: {
      name: record.company?.name ?? '',
      legalName: record.company?.legalName ?? '',
      taxId: record.company?.taxId ?? '',
      email: record.company?.email ?? '',
      phone: record.company?.phone ?? '',
      address: record.company?.address ?? '',
      logoMediaId: record.company?.logoMediaId ?? '',
    },
    seo: {
      titleTemplate: record.seo?.titleTemplate ?? '%s',
      defaultDescription: record.seo?.defaultDescription ?? '',
      defaultImageMediaId: record.seo?.defaultImageMediaId ?? '',
    },
    locales: {
      default: (record.locales?.default ?? 'vi') as AdminSiteSettings['locales']['default'],
      enabled: [...(record.locales?.enabled ?? ['vi'])] as AdminSiteSettings['locales']['enabled'],
    },
    modules: Object.fromEntries(
      SITE_MODULES.map(module => [module, record.modules?.[module] ?? module === 'content']),
    ) as AdminSiteSettings['modules'],
    updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : null,
    updatedBy: record.updatedBy
      ? { id: record.updatedBy.id, name: record.updatedBy.name ?? '', email: record.updatedBy.email ?? '' }
      : null,
  }
}

export async function getSiteSettings(
  model: Model<SiteSettingsDocument>,
  siteId: string,
): Promise<AdminSiteSettings> {
  const record = await model.findOne({ siteId }).lean<SettingsRecord | null>()
  return record ? toAdminSettings(record) : defaultSiteSettings(siteId)
}

function normalizeLocales(
  input: AdminSiteSettings['locales'],
): AdminSiteSettings['locales'] {
  const enabled = SETTINGS_LOCALES.filter(locale => input.enabled.includes(locale))
  if (enabled.length === 0) {
    throw new SettingsServiceError(422, 'SETTINGS_LOCALES_INVALID', 'At least one locale must stay enabled')
  }
  if (!enabled.includes(input.default)) {
    throw new SettingsServiceError(422, 'SETTINGS_LOCALES_INVALID', 'The default locale must be one of the enabled locales')
  }
  return { default: input.default, enabled: [...enabled] }
}

function sameSection<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export async function updateSiteSettings(
  model: Model<SiteSettingsDocument>,
  siteId: string,
  input: unknown,
  meta?: SettingsWriteMeta,
): Promise<AdminSiteSettings> {
  const parsed = AdminSiteSettingsPatchSchema.safeParse(input)
  if (!parsed.success) {
    throw new SettingsServiceError(422, 'SETTINGS_PAYLOAD_INVALID', 'Dữ liệu cấu hình không hợp lệ')
  }
  const patch: AdminSiteSettingsPatch = parsed.data

  const current = await getSiteSettings(model, siteId)
  if (patch.revision !== current.revision) {
    throw new SettingsServiceError(409, 'SETTINGS_REVISION_CONFLICT', 'Cấu hình đã được người khác sửa, hãy tải lại')
  }

  const merged: AdminSiteSettings = {
    ...current,
    company: { ...current.company, ...(patch.company ?? {}) },
    seo: { ...current.seo, ...(patch.seo ?? {}) },
    locales: normalizeLocales({ ...current.locales, ...(patch.locales ?? {}) }),
    modules: { ...current.modules, ...(patch.modules ?? {}) },
  }

  const changedFields = (['company', 'seo', 'locales', 'modules'] as const)
    .filter(field => !sameSection(current[field], merged[field]))

  if (changedFields.length === 0) {
    throw new SettingsServiceError(422, 'SETTINGS_UPDATE_UNCHANGED', 'Không có thay đổi nào để lưu')
  }

  const actor = meta ? (meta.audit.actor ?? null) : null
  const nextRevision = current.revision + 1

  let updated: SettingsRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { siteId, revision: current.revision },
      {
        $set: {
          company: merged.company,
          seo: merged.seo,
          locales: merged.locales,
          modules: merged.modules,
          revision: nextRevision,
          updatedBy: actor,
        },
        $setOnInsert: { siteId },
      },
      { returnDocument: 'after', upsert: current.revision === 0 },
    ).lean<SettingsRecord | null>()
  } catch (error) {
    // The unique (siteId) index decides a concurrent first save; the loser is a
    // stale write, not a server error.
    if ((error as { code?: number }).code === 11000) {
      throw new SettingsServiceError(409, 'SETTINGS_REVISION_CONFLICT', 'Cấu hình đã được người khác sửa, hãy tải lại')
    }
    throw error
  }

  if (!updated) {
    throw new SettingsServiceError(409, 'SETTINGS_REVISION_CONFLICT', 'Cấu hình đã được người khác sửa, hãy tải lại')
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'settings',
    resourceId: siteId,
    resourceKey: 'site-settings',
    action: 'update',
    revision: nextRevision,
    fromStatus: null,
    toStatus: null,
    changedFields: [...changedFields],
  })

  return toAdminSettings(updated)
}
