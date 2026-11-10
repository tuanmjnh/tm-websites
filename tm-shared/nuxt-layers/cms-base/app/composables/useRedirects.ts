import type { AdminRedirect, AdminRedirectDraft } from '@tm/flow-contracts/redirect-admin'

/**
 * CMS redirect map client. Rows belong to the deployment's site, so requests
 * carry no site id; the server resolves it from the tenant binding.
 */

interface ApiErrorBody {
  data?: { error?: { code?: string }, data?: { error?: { code?: string } } }
  error?: { code?: string }
}

export const useRedirects = () => {
  const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

  const list = async (q?: string): Promise<{ data: AdminRedirect[], total: number }> => {
    const payload = await plainFetch('/api/v1/admin/redirects', {
      query: q?.trim() ? { q: q.trim() } : undefined,
    }) as { success: boolean, data: AdminRedirect[], total: number }
    return { data: payload.data, total: payload.total }
  }

  const create = async (draft: AdminRedirectDraft): Promise<AdminRedirect> => {
    const payload = await plainFetch('/api/v1/admin/redirects', { method: 'POST', body: draft }) as { data: AdminRedirect }
    return payload.data
  }

  const update = async (id: string, draft: AdminRedirectDraft & { revision: number }): Promise<AdminRedirect> => {
    const payload = await plainFetch(`/api/v1/admin/redirects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: draft,
    }) as { data: AdminRedirect }
    return payload.data
  }

  const remove = async (id: string, revision: number): Promise<void> => {
    await plainFetch(`/api/v1/admin/redirects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      query: { revision },
    })
  }

  const errorCode = (error: unknown): string | null => {
    const body = (error as ApiErrorBody)?.data
    return body?.data?.error?.code || body?.error?.code || null
  }

  return { list, create, update, remove, errorCode }
}
