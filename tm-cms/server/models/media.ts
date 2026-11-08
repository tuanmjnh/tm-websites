import { randomUUID } from 'node:crypto'
import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import {
  MEDIA_EXTENSIONS,
  MEDIA_MAX_ALT_LENGTH,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_FOLDER_LENGTH,
  MEDIA_MAX_TITLE_LENGTH,
  MEDIA_MIME_TYPES,
  type MediaKind,
  type MediaMimeType,
  mediaKindOf,
} from '@tm/flow-contracts/media-admin'

/**
 * Media metadata. The binary never enters MongoDB: this document describes a
 * file owned by a storage adapter (a local directory today) so a later object
 * store only needs a new adapter, not a new schema.
 */

export const MEDIA_SCHEMA_VERSION = 1

export const MEDIA_STORAGE_PROVIDERS = ['local'] as const
export type MediaStorageProvider = (typeof MEDIA_STORAGE_PROVIDERS)[number]

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const FOLDER_SEGMENT_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/
const STORAGE_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}\/\d{4}\/[a-f0-9-]{36}\.(png|jpg|webp|avif|gif|pdf)$/

export class MediaInvariantError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MediaInvariantError'
    this.code = code
  }
}

/**
 * Folders are display grouping, not a security boundary: they are normalized to
 * lowercase path segments so `Landing / Hero` and `landing/hero` are one folder.
 */
export function normalizeFolder(value: unknown): string {
  if (value === null || value === undefined) return ''
  const raw = typeof value === 'string' ? value : ''
  const segments = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .split('/')
    .map(segment => segment.replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').replace(/-+$/, ''))
    .filter(Boolean)

  const folder = segments.join('/')
  if (folder.length > MEDIA_MAX_FOLDER_LENGTH) {
    throw new MediaInvariantError('MEDIA_FOLDER_INVALID', 'Folder name is too long')
  }
  if (folder && !segments.every(segment => FOLDER_SEGMENT_PATTERN.test(segment))) {
    throw new MediaInvariantError('MEDIA_FOLDER_INVALID', 'Folder name is not valid')
  }
  return folder
}

/**
 * The upload name is metadata only: it is never used as a filesystem path. Only
 * the basename survives, control characters are dropped and the length is capped.
 */
export function sanitizeOriginalName(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  const base = raw.split(/[\\/]/).pop() ?? ''
  const cleaned = [...base]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0
      return code > 31 && code !== 127
    })
    .join('')
    .trim()
  return (cleaned || 'upload').slice(0, MEDIA_MAX_TITLE_LENGTH)
}

export function mediaExtensionFor(mimeType: string): string {
  return MEDIA_EXTENSIONS[mimeType as MediaMimeType] ?? 'bin'
}

/** Rejects anything the public route would not be allowed to serve. */
export function assertUploadAllowed(input: { mimeType?: unknown, size?: unknown }): MediaMimeType {
  const mimeType = typeof input.mimeType === 'string' ? input.mimeType.split(';')[0]!.trim().toLowerCase() : ''
  const size = typeof input.size === 'number' ? input.size : Number.NaN

  if (!MEDIA_MIME_TYPES.includes(mimeType as MediaMimeType)) {
    throw new MediaInvariantError(
      'MEDIA_TYPE_NOT_ALLOWED',
      `Unsupported file type. Allowed: ${MEDIA_MIME_TYPES.join(', ')}`,
    )
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new MediaInvariantError('MEDIA_EMPTY', 'The uploaded file is empty')
  }
  if (size > MEDIA_MAX_BYTES) {
    throw new MediaInvariantError(
      'MEDIA_SIZE_EXCEEDED',
      `Files larger than ${Math.round(MEDIA_MAX_BYTES / (1024 * 1024))} MB are not accepted`,
    )
  }
  return mimeType as MediaMimeType
}

/**
 * Storage key: site, year and a random name. It is stable for the life of the
 * file, which is why the public route can cache it as immutable.
 */
export function mediaStorageKey(siteId: string, mimeType: string, now: Date = new Date()): string {
  if (!SITE_ID_PATTERN.test(siteId)) {
    throw new MediaInvariantError('MEDIA_SITE_INVALID', 'Site id is not valid')
  }
  return `${siteId}/${now.getUTCFullYear()}/${randomUUID()}.${mediaExtensionFor(mimeType)}`
}

export function isSafeStorageKey(key: unknown): key is string {
  return typeof key === 'string' && STORAGE_KEY_PATTERN.test(key)
}

export interface MediaUploader {
  id: string
  name: string
  email: string
}

export interface MediaDocument {
  siteId: string
  folder: string
  title: string
  alt: string
  originalName: string
  mimeType: MediaMimeType
  ext: string
  kind: MediaKind
  size: number
  checksum: string
  storage: { provider: MediaStorageProvider, key: string }
  uploadedBy: MediaUploader
  revision: number
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

const UploaderSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
  },
  { _id: false },
)

const StorageSchema = new Schema(
  {
    provider: { type: String, enum: MEDIA_STORAGE_PROVIDERS, required: true },
    key: { type: String, required: true },
  },
  { _id: false },
)

export const mediaSchema = new Schema<MediaDocument>(
  {
    siteId: { type: String, required: true },
    folder: { type: String, default: '' },
    title: { type: String, default: '', maxlength: MEDIA_MAX_TITLE_LENGTH },
    alt: { type: String, default: '', maxlength: MEDIA_MAX_ALT_LENGTH },
    originalName: { type: String, required: true },
    mimeType: { type: String, enum: MEDIA_MIME_TYPES, required: true },
    ext: { type: String, required: true },
    kind: { type: String, enum: ['image', 'document'], required: true },
    size: { type: Number, required: true },
    checksum: { type: String, required: true },
    storage: { type: StorageSchema, required: true },
    uploadedBy: { type: UploaderSchema, required: true },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: MEDIA_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'media',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

// One document per stored object, so a retried upload cannot register the same
// file twice, and the library page reads newest-first within a folder.
mediaSchema.index({ 'storage.key': 1 }, { unique: true, name: 'media_storage_key' })
mediaSchema.index({ siteId: 1, folder: 1, createdAt: -1 }, { name: 'media_site_folder_created' })
mediaSchema.index({ siteId: 1, createdAt: -1 }, { name: 'media_site_created' })
mediaSchema.index({ siteId: 1, kind: 1 }, { name: 'media_site_kind' })

/** Model factory: one registration per connection, never a global model. */
export function mediaModel(connection: Connection): Model<MediaDocument> {
  const registered = connection.models.Media as Model<MediaDocument> | undefined
  if (registered) return registered
  return connection.model<MediaDocument>('Media', mediaSchema, 'media')
}

export async function syncMediaIndexes(connection: Connection): Promise<void> {
  await mediaModel(connection).createIndexes()
}

export function mediaKind(mimeType: string): MediaKind {
  return mediaKindOf(mimeType)
}
