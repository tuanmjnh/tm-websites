import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type {
  AdminMedia,
  AdminMediaBulkRequest,
  AdminMediaBulkResult,
  AdminMediaBulkRow,
  AdminMediaList,
  MediaKind,
  MediaUpdate,
} from '@tm/flow-contracts/media-admin'
import {
  MEDIA_MAX_ALT_LENGTH,
  MEDIA_MAX_TITLE_LENGTH,
  mediaKindOf,
} from '@tm/flow-contracts/media-admin'
import type { ContentDocument } from '../models/content'
import {
  MediaInvariantError,
  assertUploadAllowed,
  mediaExtensionFor,
  mediaStorageKey,
  normalizeFolder,
  sanitizeOriginalName,
  type MediaDocument,
  type MediaUploader,
} from '../models/media'
import type { ContentAuditMeta } from './contentAudit'
import { recordContentAudit } from './contentAudit'
import { checksumOf, putMediaObject, removeMediaObject } from '../utils/mediaStorage'

/**
 * Media library commands and queries. The service stays H3-free: the API layer
 * resolves the site, the actor and the request origin, and tests drive the same
 * functions against a disposable database and a temporary media directory.
 */

export class MediaServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'MediaServiceError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }
}

export type MediaRecord = MediaDocument & { _id: Types.ObjectId }

export interface MediaListParams {
  folder?: string
  kind?: MediaKind
  q?: string
  cursor?: string
  limit?: number
}

export interface MediaListResult extends AdminMediaList {
  hasMore: boolean
}

export interface UploadMediaInput {
  body: Buffer
  mimeType?: unknown
  originalName?: unknown
  title?: unknown
  alt?: unknown
  folder?: unknown
  uploader: MediaUploader
}

export interface MediaRemoveResult {
  id: string
  key: string
  originalName: string
}

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100
const SEARCH_MAX_LENGTH = 80

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new MediaServiceError(422, code, 'Media id is not valid')
  }
  return new Types.ObjectId(value)
}

function text(value: unknown, max: number, code: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed.length > max) {
    throw new MediaServiceError(422, code, `Text is longer than ${max} characters`)
  }
  return trimmed
}

function translateInvariant(error: unknown): never {
  if (error instanceof MediaInvariantError) {
    throw new MediaServiceError(422, error.code, error.message)
  }
  throw error
}

/**
 * Public URL of a stored object. It is derived from the request origin instead
 * of being stored, so the same row works behind a different CMS host.
 */
export function toAdminMedia(record: MediaRecord, origin: string): AdminMedia {
  const base = origin.replace(/\/+$/, '')
  return {
    id: String(record._id),
    siteId: record.siteId,
    folder: record.folder ?? '',
    title: record.title ?? '',
    alt: record.alt ?? '',
    kind: (record.kind ?? mediaKindOf(record.mimeType)) as MediaKind,
    mimeType: record.mimeType,
    size: record.size,
    originalName: record.originalName,
    url: `${base}/media/${record.storage.key}`,
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

export async function getMedia(
  model: Model<MediaDocument>,
  siteId: string,
  origin: string,
  id: string,
): Promise<AdminMedia> {
  const record = await model
    .findOne({ _id: objectId(id, 'MEDIA_ID_INVALID'), siteId })
    .lean<MediaRecord | null>()
  if (!record) {
    throw new MediaServiceError(404, 'MEDIA_NOT_FOUND', 'Media not found')
  }
  return toAdminMedia(record, origin)
}

export async function listMedia(
  model: Model<MediaDocument>,
  siteId: string,
  origin: string,
  params: MediaListParams = {},
): Promise<MediaListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }

  if (params.folder !== undefined) {
    filter.folder = normalizeFolder(params.folder === 'root' ? '' : params.folder)
  }
  if (params.kind) {
    filter.kind = params.kind
  }

  const search = (params.q ?? '').trim().slice(0, SEARCH_MAX_LENGTH)
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i')
    filter.$or = [{ originalName: pattern }, { title: pattern }, { alt: pattern }, { folder: pattern }]
  }

  if (params.cursor) {
    filter._id = { $lt: objectId(params.cursor, 'MEDIA_CURSOR_INVALID') }
  }

  const records = await model
    .find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean<MediaRecord[]>()

  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  const grouped = await model.aggregate<{ _id: string, count: number }>([
    { $match: { siteId } },
    { $group: { _id: '$kind', count: { $sum: 1 } } },
  ])

  const counts = { all: 0, image: 0, document: 0 }
  for (const entry of grouped) {
    if (entry._id === 'image' || entry._id === 'document') {
      counts[entry._id] = entry.count
      counts.all += entry.count
    }
  }

  const folders = await model.distinct('folder', { siteId, folder: { $ne: '' } })

  return {
    data: page.map(record => toAdminMedia(record, origin)),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    counts,
    folders: (folders as unknown[])
      .filter((value): value is string => typeof value === 'string' && value !== '')
      .sort((left, right) => left.localeCompare(right)),
    hasMore,
  }
}

export async function createMedia(
  model: Model<MediaDocument>,
  siteId: string,
  origin: string,
  input: UploadMediaInput,
  meta?: ContentAuditMeta,
): Promise<AdminMedia> {
  if (!Buffer.isBuffer(input.body) || input.body.length === 0) {
    throw new MediaServiceError(422, 'MEDIA_EMPTY', 'No file was uploaded')
  }

  const mimeType = (() => {
    try {
      return assertUploadAllowed({ mimeType: input.mimeType, size: input.body.length })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  const folder = (() => {
    try {
      return normalizeFolder(input.folder)
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  const title = text(input.title, MEDIA_MAX_TITLE_LENGTH, 'MEDIA_TITLE_INVALID')
  const alt = text(input.alt, MEDIA_MAX_ALT_LENGTH, 'MEDIA_ALT_INVALID')
  const now = new Date()
  const key = mediaStorageKey(siteId, mimeType, now)
  const checksum = checksumOf(input.body)

  await putMediaObject(key, input.body)

  let created: MediaRecord
  try {
    created = await model.create({
      siteId,
      folder,
      title: title || sanitizeOriginalName(input.originalName),
      alt,
      originalName: sanitizeOriginalName(input.originalName),
      mimeType,
      ext: mediaExtensionFor(mimeType),
      kind: mediaKindOf(mimeType),
      size: input.body.length,
      checksum,
      storage: { provider: 'local', key },
      uploadedBy: input.uploader,
      revision: 1,
    }) as unknown as MediaRecord
  } catch (error) {
    // The bytes are already written: never leave an orphan when the metadata
    // insert fails, because nothing would ever point at or clean that file.
    await removeMediaObject(key).catch(() => undefined)
    const duplicate = error as { code?: number }
    if (duplicate?.code === 11000) {
      throw new MediaServiceError(409, 'MEDIA_OBJECT_EXISTS', 'This file is already registered')
    }
    throw error
  }

  await recordContentAudit(meta, {
    siteId,
    resourceType: 'media',
    resourceId: String(created._id),
    resourceKey: created.originalName,
    action: 'create',
    revision: created.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['originalName', 'mimeType', 'size', 'folder'],
  })

  return toAdminMedia(created, origin)
}

export async function updateMedia(
  model: Model<MediaDocument>,
  siteId: string,
  origin: string,
  id: string,
  patch: MediaUpdate & { revision?: number },
  meta?: ContentAuditMeta,
): Promise<AdminMedia> {
  const objectIdValue = objectId(id, 'MEDIA_ID_INVALID')
  if (!Number.isInteger(patch.revision) || (patch.revision ?? 0) < 1) {
    throw new MediaServiceError(422, 'MEDIA_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model.findOne({ _id: objectIdValue, siteId }).lean<MediaRecord | null>()
  if (!record) {
    throw new MediaServiceError(404, 'MEDIA_NOT_FOUND', 'Media not found')
  }
  if (record.revision !== patch.revision) {
    throw new MediaServiceError(409, 'MEDIA_REVISION_CONFLICT', 'This file was changed by another session')
  }

  const next: Partial<MediaDocument> = {}
  const changedFields: string[] = []

  if (patch.title !== undefined) {
    const title = text(patch.title, MEDIA_MAX_TITLE_LENGTH, 'MEDIA_TITLE_INVALID')
    if (title !== (record.title ?? '')) {
      next.title = title
      changedFields.push('title')
    }
  }
  if (patch.alt !== undefined) {
    const alt = text(patch.alt, MEDIA_MAX_ALT_LENGTH, 'MEDIA_ALT_INVALID')
    if (alt !== (record.alt ?? '')) {
      next.alt = alt
      changedFields.push('alt')
    }
  }
  if (patch.folder !== undefined) {
    const folder = (() => {
      try {
        return normalizeFolder(patch.folder)
      } catch (error) {
        return translateInvariant(error)
      }
    })()
    if (folder !== (record.folder ?? '')) {
      next.folder = folder
      changedFields.push('folder')
    }
  }

  if (changedFields.length === 0) {
    throw new MediaServiceError(422, 'MEDIA_UPDATE_UNCHANGED', 'Nothing to update')
  }

  const updated = await model
    .findOneAndUpdate(
      { _id: objectIdValue, siteId, revision: patch.revision },
      { $set: next, $inc: { revision: 1 } },
      { returnDocument: 'after' },
    )
    .lean<MediaRecord | null>()

  if (!updated) {
    throw new MediaServiceError(409, 'MEDIA_REVISION_CONFLICT', 'This file was changed by another session')
  }

  await recordContentAudit(meta, {
    siteId,
    resourceType: 'media',
    resourceId: String(updated._id),
    resourceKey: updated.originalName,
    action: 'update',
    revision: updated.revision,
    fromStatus: null,
    toStatus: null,
    changedFields,
  })

  return toAdminMedia(updated, origin)
}

/**
 * Deleting media is refused while a live content record still references it:
 * the library cannot silently break a published page. The file is removed after
 * the metadata row, so a failed unlink leaves a findable record, not a ghost.
 */
export async function deleteMedia(
  models: { media: Model<MediaDocument>, content: Model<ContentDocument> },
  siteId: string,
  id: string,
  revision: unknown,
  meta?: ContentAuditMeta,
): Promise<MediaRemoveResult> {
  const objectIdValue = objectId(id, 'MEDIA_ID_INVALID')
  const expected = typeof revision === 'number' ? revision : Number.NaN
  if (!Number.isInteger(expected) || expected < 1) {
    throw new MediaServiceError(422, 'MEDIA_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await models.media.findOne({ _id: objectIdValue, siteId }).lean<MediaRecord | null>()
  if (!record) {
    throw new MediaServiceError(404, 'MEDIA_NOT_FOUND', 'Media not found')
  }
  if (record.revision !== expected) {
    throw new MediaServiceError(409, 'MEDIA_REVISION_CONFLICT', 'This file was changed by another session')
  }

  const used = await models.content.countDocuments({
    siteId,
    media: String(record._id),
    status: { $ne: 'deleted' },
  })
  if (used > 0) {
    throw new MediaServiceError(
      422,
      'MEDIA_IN_USE',
      `This file is attached to ${used} content record(s); detach it first`,
    )
  }

  await models.media.deleteOne({ _id: objectIdValue, siteId, revision: expected })
  await removeMediaObject(record.storage.key)

  await recordContentAudit(meta, {
    siteId,
    resourceType: 'media',
    resourceId: String(record._id),
    resourceKey: record.originalName,
    action: 'delete',
    revision: record.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: [],
  })

  return { id: String(record._id), key: record.storage.key, originalName: record.originalName }
}

/** Site-scoped lookup used by the public file route (the key already carries the site). */
export async function findMediaByKey(
  model: Model<MediaDocument>,
  siteId: string,
  key: string,
): Promise<MediaRecord | null> {
  return model.findOne({ siteId, 'storage.key': key }).lean<MediaRecord | null>()
}

/**
 * Runs move/delete over a bounded batch.
 *
 * Each row reuses the single-file command, so the revision lock, folder
 * normalization, in-use guard and audit entry behave exactly as they do for one
 * file. A failed row is reported inside `results` and never rolls back or hides
 * the rows that succeeded; duplicate ids are reported instead of being applied
 * twice.
 */
export async function runBulkMediaCommand(
  models: { media: Model<MediaDocument>, content: Model<ContentDocument> },
  siteId: string,
  origin: string,
  request: AdminMediaBulkRequest,
  meta?: ContentAuditMeta,
): Promise<AdminMediaBulkResult> {
  const folder = request.action === 'move'
    ? (() => {
        try {
          return normalizeFolder(request.folder)
        } catch (error) {
          return translateInvariant(error)
        }
      })()
    : null

  const seen = new Set<string>()
  const results: AdminMediaBulkRow[] = []

  for (const item of request.items) {
    if (seen.has(item.id)) {
      results.push({
        id: item.id,
        ok: false,
        revision: null,
        error: { code: 'MEDIA_BULK_DUPLICATE', message: 'This file appears twice in the same batch' },
      })
      continue
    }
    seen.add(item.id)

    try {
      if (folder === null) {
        await deleteMedia(models, siteId, item.id, item.revision, meta)
        results.push({ id: item.id, ok: true, revision: null, error: null })
      } else {
        const updated = await updateMedia(models.media, siteId, origin, item.id, { folder, revision: item.revision }, meta)
        results.push({ id: item.id, ok: true, revision: updated.revision, error: null })
      }
    } catch (error) {
      if (!(error instanceof MediaServiceError)) throw error
      results.push({
        id: item.id,
        ok: false,
        revision: null,
        error: { code: error.code, message: error.message },
      })
    }
  }

  const succeeded = results.filter(row => row.ok).length
  return { action: request.action, folder, results, succeeded, failed: results.length - succeeded }
}
