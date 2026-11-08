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
