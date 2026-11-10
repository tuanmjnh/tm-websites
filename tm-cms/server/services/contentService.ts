import { Types } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import type { AdminContent } from '@tm/flow-contracts/content-admin'
import type { MenuReference } from '@tm/flow-contracts/menu-admin'
import type {
  ContentDocument,
  ContentEvent,
  ContentStatus,
  ContentType,
  PublicContentProjection,
} from '../models/content'
import type { MenuDocument } from '../models/menu'
import {
  ContentInvariantError,
  applyContentTransition,
  contentModel,
  isPubliclyVisible,
  normalizeContentInput,
  toPublicContent,
} from '../models/content'
import {
  diffContentFields,
  recordContentAudit,
  type ContentAuditMeta,
} from './contentAudit'
import { findMenuReferences } from './menuReferences'
import {
  captureContentRevision,
  getContentRevision,
  revisionSnapshotOf,
  type ContentRevisionMeta,
} from './contentRevisions'
import type { ContentRevisionDocument } from '../models/revision'

/**
 * Content commands and admin queries. Nothing here touches H3: the API layer
 * supplies a verified site id and a prepared model, tests supply a disposable
 * database. That keeps tenant scoping explicit on every query.
 */

export class ContentServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ContentServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type ContentRecord = ContentDocument & { _id: Types.ObjectId }

// The admin DTO is shared with the CMS UI so both sides cannot drift.
export type { AdminContent }

export type ContentStatusFilter = 'all' | ContentStatus

export interface ContentListParams {
  status?: ContentStatusFilter
  type?: ContentType
  q?: string
  /** Exact tag match. Tags are stored normalized, so no pattern matching is needed. */
  tag?: string
  cursor?: string
  limit?: number
}

export interface ContentListResult {
  data: AdminContent[]
  nextCursor: string | null
  counts: Record<ContentStatusFilter, number>
  hasMore: boolean
}

export interface ContentEventInput {
  event: ContentEvent
  revision: number
  publishAt?: string | Date | null
}

/**
 * Everything a mutation needs beyond the record itself: the audit trail and the
 * revision snapshot. Both are optional so command paths without a request (or
 * tests that only assert storage) stay usable, but the API always supplies them.
 */
export interface ContentWriteMeta {
  audit?: ContentAuditMeta
  revision?: ContentRevisionMeta
  /**
   * Menus of this site. A write that would break a saved navigation link (a
   * delete of a referenced page) uses it to refuse instead of leaving a menu
   * item that points at nothing.
   */
  menus?: Model<MenuDocument>
}

const CONTENT_STATUSES: ContentStatus[] = ['draft', 'scheduled', 'published', 'archived', 'deleted']
const SEARCH_MAX_LENGTH = 80
/** Matches the per-tag limit on the content model, so a truncated filter never silently misses. */
const TAG_MAX_LENGTH = 60
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

export function toAdminContent(record: ContentRecord): AdminContent {
  return {
    id: String(record._id),
    siteId: record.siteId,
    type: record.type,
    key: record.key,
    status: record.status,
    locales: record.locales.map(entry => ({
      locale: entry.locale,
      slug: entry.slug,
      title: entry.title,
      excerpt: entry.excerpt ?? '',
      body: entry.body ?? '',
      format: entry.format ?? 'markdown',
      keywords: entry.keywords ?? [],
      seo: {
        title: entry.seo?.title ?? '',
        description: entry.seo?.description ?? '',
        image: entry.seo?.image ?? '',
      },
    })),
    categories: record.categories ?? [],
    tags: record.tags ?? [],
    media: record.media ?? [],
    attributes: record.attributes ?? {},
    publishAt: iso(record.publishAt),
    unpublishAt: iso(record.unpublishAt),
    publishedAt: iso(record.publishedAt),
    deletedAt: iso(record.deletedAt),
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new ContentServiceError(422, code, 'Content id is not valid')
  }
  return new Types.ObjectId(value)
}

/** Maps model-level invariant failures to a 422 the editor can act on. */
function translateInvariant(error: unknown): never {
  if (error instanceof ContentInvariantError) {
    throw new ContentServiceError(422, error.code, error.message)
  }
  if (error instanceof Error && error.name === 'ZodError') {
    throw new ContentServiceError(422, 'CONTENT_PAYLOAD_INVALID', 'Content payload is invalid', error)
  }
  throw error
}

function normalizeOrThrow(input: unknown) {
  try {
    return normalizeContentInput(input)
  } catch (error) {
    return translateInvariant(error)
  }
}

/** A unique-index violation is a user-facing conflict, never a 500. */
function translateWriteError(error: unknown): never {
  const duplicate = error as { code?: number, keyPattern?: Record<string, unknown> }
  if (duplicate?.code === 11000) {
    const isSlug = Object.keys(duplicate.keyPattern ?? {}).includes('locales.slug')
    throw new ContentServiceError(
      409,
      isSlug ? 'CONTENT_SLUG_EXISTS' : 'CONTENT_KEY_EXISTS',
      isSlug ? 'Another record already uses this locale slug' : 'Another record already uses this content key',
    )
  }
  throw error
}

export async function listContent(
  model: Model<ContentDocument>,
  siteId: string,
  params: ContentListParams = {},
): Promise<ContentListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }

  if (params.status && params.status !== 'all') {
    filter.status = params.status
  }
  if (params.type) {
    filter.type = params.type
  }

  const tag = (params.tag ?? '').trim().slice(0, TAG_MAX_LENGTH)
  if (tag) {
    filter.tags = tag
  }

  const search = (params.q ?? '').trim().slice(0, SEARCH_MAX_LENGTH)
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i')
    filter.$or = [{ key: pattern }, { 'locales.title': pattern }, { 'locales.slug': pattern }]
  }

  if (params.cursor) {
    filter._id = { $lt: objectId(params.cursor, 'CONTENT_CURSOR_INVALID') }
  }

  const records = await model
    .find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean<ContentRecord[]>()

  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  const grouped = await model.aggregate<{ _id: ContentStatus, count: number }>([
    { $match: { siteId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])

  const counts: Record<ContentStatusFilter, number> = {
    all: 0,
    draft: 0,
    scheduled: 0,
    published: 0,
    archived: 0,
    deleted: 0,
  }
  for (const entry of grouped) {
    if (CONTENT_STATUSES.includes(entry._id)) {
      counts[entry._id] = entry.count
      counts.all += entry.count
    }
  }

  return {
    data: page.map(toAdminContent),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    counts,
    hasMore,
  }
}

export async function createContent(
  model: Model<ContentDocument>,
  siteId: string,
  input: unknown,
  meta?: ContentWriteMeta,
): Promise<AdminContent> {
  const draft = normalizeOrThrow({ ...(input as Record<string, unknown>), siteId })

  let created
  try {
    created = await model.create({
      ...draft,
      siteId,
      status: 'draft',
      publishedAt: null,
      deletedAt: null,
      revision: 1,
    })
  } catch (error) {
    return translateWriteError(error)
  }

  const record = created.toObject() as ContentRecord
  const changedFields = diffContentFields({ locales: [] }, draft)

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceId: String(record._id),
    resourceKey: record.key,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: record.status,
    changedFields,
  })

  await captureContentRevision(meta?.revision, {
    siteId,
    contentId: String(record._id),
    revision: record.revision,
    status: record.status,
    action: 'create',
    changedFields,
    snapshot: revisionSnapshotOf(draft),
  })

  return toAdminContent(record)
}

/**
 * Menus that link to one page, for the detail view. The record is resolved first
 * so another site's id is a 404 rather than an empty list.
 */
export async function listContentMenuReferences(
  model: Model<ContentDocument>,
  menuModel: Model<MenuDocument>,
  siteId: string,
  id: string,
): Promise<MenuReference[]> {
  const record = await model.findOne({ _id: objectId(id, 'CONTENT_ID_INVALID'), siteId }).lean<ContentRecord | null>()
  if (!record) {
    throw new ContentServiceError(404, 'CONTENT_NOT_FOUND', 'Content record not found')
  }
  return findMenuReferences(menuModel, siteId, 'content', record.key)
}

export async function getContent(
  model: Model<ContentDocument>,
  siteId: string,
  id: string,
): Promise<AdminContent> {
  const record = await model.findOne({ _id: objectId(id, 'CONTENT_ID_INVALID'), siteId }).lean<ContentRecord>()
  if (!record) {
    throw new ContentServiceError(404, 'CONTENT_NOT_FOUND', 'Content record not found')
  }
  return toAdminContent(record)
}

export async function updateContent(
  model: Model<ContentDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: ContentWriteMeta,
): Promise<AdminContent> {
  const body = input as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new ContentServiceError(422, 'CONTENT_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model.findOne({ _id: objectId(id, 'CONTENT_ID_INVALID'), siteId }).lean<ContentRecord>()
  if (!record) {
    throw new ContentServiceError(404, 'CONTENT_NOT_FOUND', 'Content record not found')
  }

  if (typeof body.key === 'string' && body.key !== record.key) {
    throw new ContentServiceError(422, 'CONTENT_KEY_IMMUTABLE', 'Content key cannot change after creation')
  }

  // The key and site come from the stored record; everything else must pass the
  // same validation a create does, so an update cannot bypass an invariant.
  const draft = normalizeOrThrow({ ...body, siteId, key: record.key })

  let updated: ContentRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision },
      {
        $set: {
          type: draft.type,
          locales: draft.locales,
          categories: draft.categories,
          tags: draft.tags,
          media: draft.media,
          attributes: draft.attributes,
          publishAt: draft.publishAt,
          unpublishAt: draft.unpublishAt,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<ContentRecord>()
  } catch (error) {
    return translateWriteError(error)
  }

  if (!updated) {
    throw new ContentServiceError(
      409,
      'CONTENT_REVISION_CONFLICT',
      'Content was changed by someone else; reload before saving',
      { expected: revision },
    )
  }

  const changedFields = diffContentFields(record, draft)

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceId: String(updated._id),
    resourceKey: updated.key,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: updated.status,
    changedFields,
  })

  await captureContentRevision(meta?.revision, {
    siteId,
    contentId: String(updated._id),
    revision: updated.revision,
    status: updated.status,
    action: 'update',
    changedFields,
    snapshot: revisionSnapshotOf(updated),
  })

  return toAdminContent(updated)
}

export async function runContentEvent(
  model: Model<ContentDocument>,
  siteId: string,
  id: string,
  input: ContentEventInput,
  now: Date = new Date(),
  meta?: ContentWriteMeta,
): Promise<AdminContent> {
  if (!Number.isInteger(input.revision) || input.revision < 1) {
    throw new ContentServiceError(422, 'CONTENT_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model.findOne({ _id: objectId(id, 'CONTENT_ID_INVALID'), siteId }).lean<ContentRecord>()
  if (!record) {
    throw new ContentServiceError(404, 'CONTENT_NOT_FOUND', 'Content record not found')
  }

  if (input.event === 'delete' && !record.deletedAt && meta?.menus) {
    const menus = await findMenuReferences(meta.menus, siteId, 'content', record.key)
    if (menus.length > 0) {
      throw new ContentServiceError(
        409,
        'CONTENT_IN_MENU',
        'A menu links to this content; update the menu before deleting it',
        { menus },
      )
    }
  }

  let publishAt = record.publishAt ? new Date(record.publishAt) : null
  if (input.event === 'schedule') {
    if (input.publishAt === null || input.publishAt === undefined || input.publishAt === '') {
      throw new ContentServiceError(422, 'CONTENT_PUBLISH_AT_REQUIRED', 'Scheduling requires publishAt')
    }
    publishAt = new Date(input.publishAt)
    if (Number.isNaN(publishAt.getTime())) {
      throw new ContentServiceError(422, 'CONTENT_DATE_INVALID', 'publishAt is not a valid date')
    }
    if (publishAt.getTime() <= now.getTime()) {
      throw new ContentServiceError(422, 'CONTENT_PUBLISH_AT_PAST', 'Scheduled publish time must be in the future')
    }
  }

  let next
  try {
    next = applyContentTransition(
      {
        status: record.status,
        locales: record.locales,
        publishAt,
        unpublishAt: record.unpublishAt ? new Date(record.unpublishAt) : null,
        publishedAt: record.publishedAt ? new Date(record.publishedAt) : null,
        deletedAt: record.deletedAt ? new Date(record.deletedAt) : null,
        revision: record.revision,
      },
      input.event,
      now,
    )
  } catch (error) {
    return translateInvariant(error)
  }

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision: input.revision },
    {
      $set: {
        status: next.status,
        publishedAt: next.publishedAt,
        deletedAt: next.deletedAt,
        publishAt: next.publishAt,
      },
      $inc: { revision: 1 },
    },
    { returnDocument: 'after' },
  ).lean<ContentRecord>()

  if (!updated) {
    throw new ContentServiceError(
      409,
      'CONTENT_REVISION_CONFLICT',
      'Content was changed by someone else; reload before acting',
      { expected: input.revision },
    )
  }

  const changedFields = ['status']
  if (iso(record.publishAt) !== iso(updated.publishAt)) changedFields.push('publishAt')
  if (iso(record.publishedAt) !== iso(updated.publishedAt)) changedFields.push('publishedAt')
  if (iso(record.deletedAt) !== iso(updated.deletedAt)) changedFields.push('deletedAt')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceId: String(updated._id),
    resourceKey: updated.key,
    action: input.event,
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: updated.status,
    changedFields,
  })

  await captureContentRevision(meta?.revision, {
    siteId,
    contentId: String(updated._id),
    revision: updated.revision,
    status: updated.status,
    action: input.event,
    changedFields,
    snapshot: revisionSnapshotOf(updated),
  })

  return toAdminContent(updated)
}

/**
 * Restores the editable fields of an earlier snapshot as a new revision. The
 * publication state is deliberately untouched: restoring wording never silently
 * republishes a page, and an audit entry records who reverted what.
 */
export async function restoreContentRevision(
  model: Model<ContentDocument>,
  revisionModel: Model<ContentRevisionDocument>,
  siteId: string,
  id: string,
  targetRevision: number,
  expectedRevision: number,
  meta?: ContentWriteMeta,
): Promise<AdminContent> {
  if (!Number.isInteger(targetRevision) || targetRevision < 1) {
    throw new ContentServiceError(422, 'CONTENT_REVISION_INVALID', 'Revision to restore is not valid')
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new ContentServiceError(422, 'CONTENT_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model.findOne({ _id: objectId(id, 'CONTENT_ID_INVALID'), siteId }).lean<ContentRecord>()
  if (!record) {
    throw new ContentServiceError(404, 'CONTENT_NOT_FOUND', 'Content record not found')
  }
  if (targetRevision === record.revision) {
    throw new ContentServiceError(422, 'CONTENT_REVISION_CURRENT', 'This revision is already the current one')
  }

  const detail = await getContentRevision(revisionModel, siteId, String(record._id), targetRevision, record)
  if (!detail) {
    throw new ContentServiceError(404, 'CONTENT_REVISION_NOT_FOUND', 'Content revision not found')
  }
  if (detail.diff.length === 0) {
    throw new ContentServiceError(422, 'CONTENT_REVISION_UNCHANGED', 'This snapshot is identical to the current content')
  }

  const draft = normalizeOrThrow({ ...detail.snapshot, siteId, key: record.key })

  let updated: ContentRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision: expectedRevision },
      {
        $set: {
          type: draft.type,
          locales: draft.locales,
          categories: draft.categories,
          tags: draft.tags,
          media: draft.media,
          attributes: draft.attributes,
          publishAt: draft.publishAt,
          unpublishAt: draft.unpublishAt,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<ContentRecord>()
  } catch (error) {
    return translateWriteError(error)
  }

  if (!updated) {
    throw new ContentServiceError(
      409,
      'CONTENT_REVISION_CONFLICT',
      'Content was changed by someone else; reload before restoring',
      { expected: expectedRevision },
    )
  }

  const changedFields = diffContentFields(record, draft)

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceId: String(updated._id),
    resourceKey: updated.key,
    action: 'revert',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: updated.status,
    changedFields,
  })

  await captureContentRevision(meta?.revision, {
    siteId,
    contentId: String(updated._id),
    revision: updated.revision,
    status: updated.status,
    action: 'revert',
    changedFields,
    snapshot: revisionSnapshotOf(updated),
  })

  return toAdminContent(updated)
}

/**
 * Public read used by the website host: published, inside its window, one
 * locale, allowlisted fields only.
 */
export async function findPublicContent(
  model: Model<ContentDocument>,
  siteId: string,
  key: string,
  locale: string,
  now: Date = new Date(),
): Promise<PublicContentProjection | null> {
  const record = await model.findOne({ siteId, key, status: 'published' }).lean<ContentRecord>()
  if (!record || !isPubliclyVisible(record, now)) return null
  return toPublicContent({ ...record, updatedAt: record.updatedAt }, locale, now)
}

/** Exported for tests and future command paths that prepare their own model. */
export function contentModelFor(connection: Connection): Model<ContentDocument> {
  return contentModel(connection)
}
