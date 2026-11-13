import type {
  AdminMedia,
  AdminMediaBulkRequest,
  AdminMediaBulkResult,
  MediaKind,
} from '@tm/flow-contracts/media-admin'

/**
 * CMS media client for the local library. Files belong to the deployment's
 * site, so requests never carry a tenant id; the upload is multipart because the
 * binary never travels as JSON.
 */

export interface MediaListQuery {
  folder?: string
  kind?: MediaKind
  q?: string
  cursor?: string
  limit?: number
}

export interface MediaListMeta {
  nextCursor?: string
  hasMore?: boolean
  counts?: Record<string, number>
  folders?: string[]
}

interface MediaListResponse {
  success: boolean
  data: AdminMedia[]
  meta?: MediaListMeta
}

interface MediaDetailResponse {
  success: boolean
  data: AdminMedia
  message?: string
}

interface ApiErrorBody {
  data?: { error?: { code?: string }, data?: { error?: { code?: string } } }
  error?: { code?: string }
}

export interface MediaUploadInput {
  file: File
  title?: string
  alt?: string
  folder?: string
}

export const useMediaAdmin = () => {
  const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

  const list = async (query: MediaListQuery = {}): Promise<MediaListResponse> => {
    return await plainFetch('/api/v1/admin/media', { query }) as MediaListResponse
  }

  const upload = async (input: MediaUploadInput, reason?: string): Promise<AdminMedia> => {
    const body = new FormData()
    body.append('file', input.file, input.file.name)
    if (input.title) body.append('title', input.title)
    if (input.alt) body.append('alt', input.alt)
    if (input.folder) body.append('folder', input.folder)

    const payload = await plainFetch('/api/v1/admin/media', {
      method: 'POST',
      body,
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as MediaDetailResponse
    return payload.data
  }

  const update = async (
    id: string,
    patch: { title?: string, alt?: string, folder?: string, revision: number },
    reason?: string,
  ): Promise<AdminMedia> => {
    const payload = await plainFetch(`/api/v1/admin/media/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as MediaDetailResponse
    return payload.data
  }

  const remove = async (id: string, revision: number, reason?: string): Promise<{ id: string, originalName: string }> => {
    const payload = await plainFetch(`/api/v1/admin/media/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      query: { revision },
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { success: boolean, data: { id: string, originalName: string } }
    return payload.data
  }

  /** Move or delete a bounded batch; the response reports one row per file. */
  const bulk = async (input: AdminMediaBulkRequest, reason?: string): Promise<AdminMediaBulkResult> => {
    const payload = await plainFetch('/api/v1/admin/media/bulk', {
      method: 'POST',
      body: input,
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { success: boolean, data: AdminMediaBulkResult }
    return payload.data
  }

  const errorCode = (error: unknown): string | null => {
    const body = (error as ApiErrorBody)?.data
    return body?.data?.error?.code || body?.error?.code || null
  }

  const errorStatus = (error: unknown): number | null => {
    const status = (error as { statusCode?: number, status?: number })?.statusCode
      ?? (error as { status?: number })?.status
    return typeof status === 'number' ? status : null
  }

  return { list, upload, update, remove, bulk, errorCode, errorStatus }
}
