import type { AdminAuditList, AdminAuditQuery } from '@tm/flow-contracts/audit-admin'

/**
 * Client for the site's own business audit trail. Filters travel as query
 * params; the cursor is the last `_id` the server returned, so loading more
 * never re-reads a row.
 */
export const useAuditAdmin = () => {
  const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

  const list = async (query: AdminAuditQuery): Promise<AdminAuditList> => {
    const payload = await plainFetch('/api/v1/admin/audit', { query }) as AdminAuditList & { success: boolean }
    return {
      data: payload.data,
      nextCursor: payload.nextCursor,
      hasMore: payload.hasMore,
      total: payload.total,
    }
  }

  const describeError = (error: unknown): string => {
    const status = (error as { statusCode?: number })?.statusCode
    if (status === 403) return 'forbidden'
    if (status === 422) return 'invalid'
    return 'unavailable'
  }

  return { list, describeError }
}
