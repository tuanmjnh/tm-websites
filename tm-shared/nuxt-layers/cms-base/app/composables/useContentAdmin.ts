import type {
  AdminContent,
  AdminContentAudit,
  AdminContentBulkAction,
  AdminContentBulkItem,
  AdminContentBulkResult,
  AdminContentDraft,
  AdminContentEvent,
  AdminContentListMeta,
  AdminContentRevision,
  AdminContentRevisionDetail,
  AdminContentStatusFilter,
  AdminContentType,
} from '@tm/flow-contracts/content-admin'

/**
 * CMS content client for the local MongoDB-backed admin API. Records belong to
 * the deployment's site, so requests never carry a site or tenant id.
 */

interface AdminListResponse {
  success: boolean
  data: AdminContent[]
  meta?: AdminContentListMeta
}

interface AdminDetailResponse {
  success: boolean
  data: AdminContent
  message?: string
}

export interface ContentListQuery {
  status?: AdminContentStatusFilter
  type?: AdminContentType
  q?: string
  cursor?: string
  limit?: number
}

interface ApiErrorBody {
  data?: { error?: { code?: string }, data?: { error?: { code?: string } } }
  error?: { code?: string }
}

export const useContentAdmin = () => {
  const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

  const list = async (query: ContentListQuery = {}) => {
    const payload = await plainFetch('/api/v1/admin/content', { query }) as AdminListResponse
    return payload
  }

  const get = async (id: string): Promise<AdminContent> => {
    const payload = await plainFetch(`/api/v1/admin/content/${encodeURIComponent(id)}`) as AdminDetailResponse
    return payload.data
  }

  const create = async (draft: AdminContentDraft): Promise<AdminContent> => {
    const payload = await plainFetch('/api/v1/admin/content', { method: 'POST', body: draft }) as AdminDetailResponse
    return payload.data
  }

  const update = async (id: string, draft: AdminContentDraft & { revision: number }): Promise<AdminContent> => {
    const payload = await plainFetch(`/api/v1/admin/content/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: draft,
    }) as AdminDetailResponse
    return payload.data
  }

  const runEvent = async (
    id: string,
    event: AdminContentEvent,
    revision: number,
    publishAt?: string | null,
  ): Promise<AdminContent> => {
    const payload = await plainFetch(`/api/v1/admin/content/${encodeURIComponent(id)}/events`, {
      method: 'POST',
      body: { event, revision, publishAt: publishAt ?? null },
    }) as AdminDetailResponse
    return payload.data
  }

  /**
   * Publish/archive/delete many records in one request. Every row is answered
   * with its own outcome, so callers show per-record results instead of a
   * single success/failure.
   */
  const bulk = async (action: AdminContentBulkAction, items: AdminContentBulkItem[]): Promise<AdminContentBulkResult> => {
    const payload = await plainFetch('/api/v1/admin/content/bulk', {
      method: 'POST',
      body: { action, items },
    }) as { success: boolean, data: AdminContentBulkResult }
    return payload.data
  }

  /** Read-only activity trail for one record (newest first, capped by the API). */
  const history = async (id: string, limit = 20): Promise<AdminContentAudit[]> => {
    const payload = await plainFetch(`/api/v1/admin/content/${encodeURIComponent(id)}/history`, {
      query: { limit },
    }) as { success: boolean, data: AdminContentAudit[] }
    return payload.data
  }

  /** Stored snapshots for one record, newest revision first. */
  const revisions = async (id: string, limit = 30): Promise<AdminContentRevision[]> => {
    const payload = await plainFetch(`/api/v1/admin/content/${encodeURIComponent(id)}/revisions`, {
      query: { limit },
    }) as { success: boolean, data: AdminContentRevision[] }
    return payload.data
  }

  /** One snapshot plus its difference to the current record. */
  const revision = async (id: string, revisionNumber: number): Promise<AdminContentRevisionDetail> => {
    const payload = await plainFetch(
      `/api/v1/admin/content/${encodeURIComponent(id)}/revisions/${revisionNumber}`,
    ) as { success: boolean, data: AdminContentRevisionDetail }
    return payload.data
  }

  /** Restores a snapshot as a new revision; `current` guards a stale editor tab. */
  const restoreRevision = async (id: string, revisionNumber: number, current: number): Promise<AdminContent> => {
    const payload = await plainFetch(
      `/api/v1/admin/content/${encodeURIComponent(id)}/revisions/${revisionNumber}/restore`,
      { method: 'POST', body: { revision: current } },
    ) as AdminDetailResponse
    return payload.data
  }

  /** Stable code from the API envelope; the page turns it into a localized message. */
  const errorCode = (error: unknown): string | null => {
    const body = (error as ApiErrorBody)?.data
    return body?.data?.error?.code || body?.error?.code || null
  }

  const errorStatus = (error: unknown): number | null => {
    const status = (error as { statusCode?: number, status?: number })?.statusCode
      ?? (error as { status?: number })?.status
    return typeof status === 'number' ? status : null
  }

  return { list, get, create, update, runEvent, bulk, history, revisions, revision, restoreRevision, errorCode, errorStatus }
}
