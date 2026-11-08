import { z } from 'zod'

/**
 * Admin DTO for the local media library. Binaries live in the storage adapter
 * (local disk today); MongoDB keeps the metadata an editor needs to find, label
 * and safely serve a file. Only allowlisted types are accepted, because the
 * public route serves exactly what this list permits.
 */

export const MEDIA_KINDS = ['image', 'document'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

export const MEDIA_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
  'application/pdf',
] as const
export type MediaMimeType = (typeof MEDIA_MIME_TYPES)[number]

/** Extension is derived from the accepted type, never from the upload name. */
export const MEDIA_EXTENSIONS: Record<MediaMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}

export const MEDIA_MAX_BYTES = 5 * 1024 * 1024
export const MEDIA_MAX_TITLE_LENGTH = 200
export const MEDIA_MAX_ALT_LENGTH = 300
export const MEDIA_MAX_FOLDER_LENGTH = 120

export function mediaKindOf(mimeType: string): MediaKind {
  return mimeType.startsWith('image/') ? 'image' : 'document'
}

export const AdminMediaSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  folder: z.string(),
  title: z.string(),
  alt: z.string(),
  kind: z.enum(MEDIA_KINDS),
  mimeType: z.string(),
  size: z.number(),
  originalName: z.string(),
  url: z.string(),
  revision: z.number(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export type AdminMedia = z.infer<typeof AdminMediaSchema>

export const AdminMediaListSchema = z.object({
  data: z.array(AdminMediaSchema),
  nextCursor: z.string().nullable(),
  counts: z.object({ all: z.number(), image: z.number(), document: z.number() }),
  folders: z.array(z.string()),
})

export type AdminMediaList = z.infer<typeof AdminMediaListSchema>

export const MediaUpdateSchema = z.object({
  title: z.string().trim().max(MEDIA_MAX_TITLE_LENGTH).optional(),
  alt: z.string().trim().max(MEDIA_MAX_ALT_LENGTH).optional(),
  folder: z.string().max(MEDIA_MAX_FOLDER_LENGTH).optional(),
})

export type MediaUpdate = z.infer<typeof MediaUpdateSchema>

/**
 * Bulk media actions. Moving changes only the folder, so the per-row rules of
 * `updateMedia` (revision lock, normalized folder, audit entry) still apply;
 * deleting still refuses a file a live content record references.
 */
export const ADMIN_MEDIA_BULK_ACTIONS = ['move', 'delete'] as const
export type AdminMediaBulkAction = (typeof ADMIN_MEDIA_BULK_ACTIONS)[number]

/** One request is capped at 50 files, matching the content bulk cap. */
export const ADMIN_MEDIA_BULK_LIMIT = 50

export const AdminMediaBulkItemSchema = z.object({
  id: z.string().trim().min(1),
  revision: z.number().int().min(1),
})

export type AdminMediaBulkItem = z.infer<typeof AdminMediaBulkItemSchema>

export const AdminMediaBulkRequestSchema = z.object({
  action: z.enum(ADMIN_MEDIA_BULK_ACTIONS),
  items: z.array(AdminMediaBulkItemSchema).min(1).max(ADMIN_MEDIA_BULK_LIMIT),
  /** Destination folder for `move`; ignored by `delete`. */
  folder: z.string().max(MEDIA_MAX_FOLDER_LENGTH).optional(),
})

export type AdminMediaBulkRequest = z.infer<typeof AdminMediaBulkRequestSchema>

export const AdminMediaBulkRowSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  revision: z.number().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
})

export type AdminMediaBulkRow = z.infer<typeof AdminMediaBulkRowSchema>

export const AdminMediaBulkResultSchema = z.object({
  action: z.enum(ADMIN_MEDIA_BULK_ACTIONS),
  /** Normalized destination for `move`, `null` for `delete`. */
  folder: z.string().nullable(),
  results: z.array(AdminMediaBulkRowSchema),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
})

export type AdminMediaBulkResult = z.infer<typeof AdminMediaBulkResultSchema>
