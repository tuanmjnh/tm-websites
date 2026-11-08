import type { Model, Types } from 'mongoose'
import type {
  AdminContentRevision,
  AdminContentRevisionDetail,
  AdminContentRevisionDiff,
} from '@tm/flow-contracts/content-admin'
import type { AuditActor } from '../models/audit'
import { SYSTEM_AUDIT_ACTOR } from '../models/audit'
import type { ContentLocale, ContentStatus, ContentType } from '../models/content'
import type {
  ContentRevisionAction,
  ContentRevisionDocument,
  ContentRevisionSnapshot,
} from '../models/revision'
import { contentFields } from './contentAudit'

/**
 * Revision snapshots for content. Capture happens inside the same request as the
 * mutation, so a stored revision always matches the record it describes. Reads
 * are site-scoped and read-only; restoring is a command in `contentService`.
 */

export type ContentRevisionRecord = ContentRevisionDocument & { _id: Types.ObjectId }

export interface ContentRevisionMeta {
  model: Model<ContentRevisionDocument>
  actor?: AuditActor
  requestId?: string | null
}

export interface CaptureRevisionInput {
  siteId: string
  contentId: string
  revision: number
  status: ContentStatus
  action: ContentRevisionAction
  changedFields: string[]
  snapshot: ContentRevisionSnapshot
}

/** Stable, JSON-safe snapshot of the editable fields of a record or draft. */
export function revisionSnapshotOf(source: unknown): ContentRevisionSnapshot {
  const fields = contentFields(source as Record<string, unknown>)
  const iso = (value: unknown) => (value ? new Date(String(value)) : null)
  return {
    type: fields.type as ContentType,
    locales: (fields.locales ?? []) as ContentLocale[],
    categories: (fields.categories ?? []) as string[],
    tags: (fields.tags ?? []) as string[],
    media: (fields.media ?? []) as string[],
    attributes: (fields.attributes ?? {}) as ContentRevisionSnapshot['attributes'],
    publishAt: iso(fields.publishAt),
    unpublishAt: iso(fields.unpublishAt),
  }
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function isDuplicateError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000
}

/**
 * Stores one snapshot per revision. A retried command may reach this twice; the
 * unique index makes the second write a no-op instead of forking the history.
 */
export async function captureContentRevision(
  meta: ContentRevisionMeta | undefined,
  input: CaptureRevisionInput,
): Promise<void> {
  if (!meta) return

  const actor = meta.actor ?? SYSTEM_AUDIT_ACTOR

  try {
    await meta.model.create({
      siteId: input.siteId,
      contentId: input.contentId,
      revision: input.revision,
      status: input.status,
      action: input.action,
      changedFields: input.changedFields,
      snapshot: input.snapshot,
      actor,
      requestId: meta.requestId ?? null,
    })
  } catch (error) {
    if (isDuplicateError(error)) return
    throw error
  }
}

function toRevisionDto(entry: ContentRevisionRecord): AdminContentRevision {
  return {
    id: String(entry._id),
    revision: entry.revision,
    status: entry.status,
    action: entry.action,
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

/** Newest first. The CMS lists revisions for one record, it does not paginate them. */
export async function listContentRevisions(
  model: Model<ContentRevisionDocument>,
  siteId: string,
  contentId: string,
  limit = 30,
): Promise<AdminContentRevision[]> {
  const capped = Math.min(Math.max(Math.trunc(limit), 1), 50)

  const entries = await model
    .find({ siteId, contentId })
    .sort({ revision: -1 })
    .limit(capped)
    .lean<ContentRevisionRecord[]>()

  return entries.map(toRevisionDto)
}

/** Display text for one field, so a diff is readable without shipping raw JSON. */
function describeValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return '—'

  if (field === 'locales' && Array.isArray(value)) {
    return (value as ContentLocale[])
      .map(entry => `${entry.locale}: ${entry.title} (/${entry.slug}, ${entry.format}, ${entry.body.length} ký tự)`)
      .join(' · ') || '—'
  }
  if (field === 'tags' || field === 'categories' || field === 'media') {
    return (value as string[]).join(', ') || '—'
  }
  if (field === 'attributes') {
    const entries = Object.entries(value as Record<string, unknown>)
    return entries.length ? entries.map(([key, item]) => `${key}=${String(item)}`).join(', ') : '—'
  }
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/**
 * Field-level difference between a snapshot (before) and the current record
 * content (after). `contentFields` normalizes both sides, so ordering in the
 * payload never produces a phantom diff.
 */
export function diffRevisionSnapshot(
  snapshot: ContentRevisionSnapshot,
  current: unknown,
): AdminContentRevisionDiff[] {
  const before = contentFields(snapshot as unknown as Record<string, unknown>)
  const after = contentFields(current as Record<string, unknown>)

  return Object.keys(after)
    .filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map(field => ({
      field,
      before: describeValue(field, before[field]),
      after: describeValue(field, after[field]),
    }))
}

export async function getContentRevision(
  model: Model<ContentRevisionDocument>,
  siteId: string,
  contentId: string,
  revision: number,
  current?: unknown,
): Promise<AdminContentRevisionDetail | null> {
  const entry = await model.findOne({ siteId, contentId, revision }).lean<ContentRevisionRecord | null>()
  if (!entry) return null

  const snapshot: ContentRevisionSnapshot = {
    type: entry.snapshot.type,
    locales: entry.snapshot.locales ?? [],
    categories: entry.snapshot.categories ?? [],
    tags: entry.snapshot.tags ?? [],
    media: entry.snapshot.media ?? [],
    attributes: entry.snapshot.attributes ?? {},
    publishAt: entry.snapshot.publishAt ? new Date(entry.snapshot.publishAt) : null,
    unpublishAt: entry.snapshot.unpublishAt ? new Date(entry.snapshot.unpublishAt) : null,
  }

  return {
    ...toRevisionDto(entry),
    snapshot: {
      type: snapshot.type,
      locales: snapshot.locales,
      categories: snapshot.categories,
      tags: snapshot.tags,
      media: snapshot.media,
      attributes: snapshot.attributes,
      publishAt: iso(snapshot.publishAt),
      unpublishAt: iso(snapshot.unpublishAt),
    },
    diff: current === undefined ? [] : diffRevisionSnapshot(snapshot, current),
  }
}
