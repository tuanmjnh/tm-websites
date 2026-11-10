import type { Model, Types } from 'mongoose'
import type { AdminContentAudit } from '@tm/flow-contracts/content-admin'
import type { AuditAction, AuditActor, AuditEntryDocument, AuditResourceType } from '../models/audit'
import { SYSTEM_AUDIT_ACTOR } from '../models/audit'
import type { ContentDraft } from '../models/content'

/**
 * Audit writes for content commands. The service functions stay H3-free: the API
 * layer resolves the actor from the verified session and hands it in, tests pass
 * a fixed actor or none at all.
 */

export type AuditEntryRecord = AuditEntryDocument & { _id: Types.ObjectId }

export interface ContentAuditMeta {
  model: Model<AuditEntryDocument>
  actor?: AuditActor
  requestId?: string | null
}

export interface RecordAuditInput {
  siteId: string
  /** Defaults to `content`; the category tree records into the same collection. */
  resourceType?: AuditResourceType
  resourceId: string
  resourceKey: string
  action: AuditAction
  revision: number
  fromStatus: string | null
  toStatus: string | null
  changedFields: string[]
}

/** Fields compared to report what an update actually touched. */
function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function different(before: unknown, after: unknown): boolean {
  return JSON.stringify(before) !== JSON.stringify(after)
}

/**
 * Stable snapshot of the editable fields, so a diff never depends on mongoose
 * document internals or field order in the submitted payload.
 */
export function contentFields(draft: ContentDraft | Record<string, unknown>): Record<string, unknown> {
  const value = draft as Record<string, unknown>
  const locales = Array.isArray(value.locales) ? value.locales : []
  return {
    type: value.type,
    locales: locales.map((entry) => {
      const locale = entry as Record<string, unknown>
      const seo = (locale.seo ?? {}) as Record<string, unknown>
      return {
        locale: locale.locale,
        slug: locale.slug,
        title: locale.title,
        excerpt: locale.excerpt ?? '',
        body: locale.body ?? '',
        format: locale.format ?? 'markdown',
        keywords: Array.isArray(locale.keywords) ? locale.keywords : [],
        seo: { title: seo.title ?? '', description: seo.description ?? '', image: seo.image ?? '' },
      }
    }),
    categories: value.categories ?? [],
    tags: value.tags ?? [],
    media: value.media ?? [],
    attributes: value.attributes ?? {},
    publishAt: iso(value.publishAt as Date | null | undefined),
    unpublishAt: iso(value.unpublishAt as Date | null | undefined),
  }
}

/** Top-level field names that differ between two snapshots, in a fixed order. */
export function diffContentFields(before: unknown, after: unknown): string[] {
  const left = contentFields(before as Record<string, unknown>)
  const right = contentFields(after as Record<string, unknown>)
  return Object.keys(right).filter(field => different(left[field], right[field]))
}

/**
 * Shallow diff for domains that store their whole payload in top-level fields
 * (the catalog does): reports which submitted keys actually changed.
 */
export function diffFields(before: unknown, after: unknown): string[] {
  const left = (before ?? {}) as Record<string, unknown>
  const right = (after ?? {}) as Record<string, unknown>
  const ignore = new Set(['revision', 'siteId', 'status', 'createdAt', 'updatedAt', '_id'])
  return Object.keys(right).filter(field => !ignore.has(field) && different(left[field], right[field]))
}

export async function recordContentAudit(
  meta: ContentAuditMeta | undefined,
  input: RecordAuditInput,
): Promise<void> {
  if (!meta) return

  await meta.model.create({
    siteId: input.siteId,
    resourceType: input.resourceType ?? 'content',
    resourceId: input.resourceId,
    resourceKey: input.resourceKey,
    action: input.action,
    revision: input.revision,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    changedFields: input.changedFields,
    actor: meta.actor ?? SYSTEM_AUDIT_ACTOR,
    requestId: meta.requestId ?? null,
  })
}

/**
 * Newest first, capped: the CMS shows activity, it does not paginate history yet.
 *
 * The type is part of the filter because ids come from different collections
 * and an audit row alone does not say which record it belongs to.
 */
export async function listRecordAudit(
  model: Model<AuditEntryDocument>,
  siteId: string,
  options: { resourceType: AuditResourceType, resourceId: string, limit?: number },
): Promise<AdminContentAudit[]> {
  const capped = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 50)

  const entries = await model
    .find({ siteId, resourceType: options.resourceType, resourceId: options.resourceId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(capped)
    .lean<AuditEntryRecord[]>()

  return entries.map(entry => toAdminAuditEntry(entry))
}

/** Content history keeps the record id and the `content` type as its defaults. */
export async function listContentAudit(
  model: Model<AuditEntryDocument>,
  siteId: string,
  resourceId: string,
  limit = 20,
): Promise<AdminContentAudit[]> {
  return listRecordAudit(model, siteId, { resourceType: 'content', resourceId, limit })
}

function toAdminAuditEntry(entry: AuditEntryRecord): AdminContentAudit {
  return {
    id: String(entry._id),
    action: entry.action,
    revision: entry.revision,
    fromStatus: (entry.fromStatus as AdminContentAudit['fromStatus']) ?? null,
    toStatus: (entry.toStatus as AdminContentAudit['toStatus']) ?? null,
    changedFields: entry.changedFields ?? [],
    actor: {
      id: entry.actor?.id ?? 'system',
      name: entry.actor?.name ?? '',
      email: entry.actor?.email ?? '',
    },
    requestId: entry.requestId ?? null,
    createdAt: new Date(entry.createdAt).toISOString(),
  }
}
