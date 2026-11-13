import type { AdminTag, AdminTagRenameRequest, AdminTagRenameResult } from '@tm/flow-contracts/tag-admin'

/**
 * CMS tag client. Tags are a projection over the content records of this site,
 * so requests carry no site or tenant id.
 */

interface ApiErrorBody {
  data?: { error?: { code?: string }, data?: { error?: { code?: string } } }
  error?: { code?: string }
}

export const useTagAdmin = () => {
  const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

  const list = async (): Promise<AdminTag[]> => {
    const payload = await plainFetch('/api/v1/admin/tags') as { success: boolean, data: AdminTag[] }
    return payload.data
  }

  /** Renames a tag everywhere; `to: null` detaches it instead. */
  const rename = async (input: AdminTagRenameRequest, reason?: string): Promise<AdminTagRenameResult> => {
    const payload = await plainFetch('/api/v1/admin/tags/rename', {
      method: 'POST',
      body: input,
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { success: boolean, data: AdminTagRenameResult }
    return payload.data
  }

  const errorCode = (error: unknown): string | null => {
    const body = (error as ApiErrorBody)?.data
    return body?.data?.error?.code || body?.error?.code || null
  }

  return { list, rename, errorCode }
}
