import type { AdminCategory, AdminCategoryDraft, AdminCategoryNode } from '@tm/flow-contracts/category-admin'

/**
 * CMS category tree client. Categories belong to the deployment's site, so the
 * request never carries a tenant id.
 */

interface CategoryListResponse {
  success: boolean
  data: AdminCategory[]
  tree: AdminCategoryNode[]
}

interface CategoryDetailResponse {
  success: boolean
  data: AdminCategory
  message?: string
}

interface ApiErrorBody {
  data?: { error?: { code?: string }, data?: { error?: { code?: string } } }
  error?: { code?: string }
}

export const useCategoryAdmin = () => {
  const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

  const list = async (): Promise<CategoryListResponse> => {
    return await plainFetch('/api/v1/admin/categories') as CategoryListResponse
  }

  const create = async (draft: AdminCategoryDraft): Promise<AdminCategory> => {
    const payload = await plainFetch('/api/v1/admin/categories', { method: 'POST', body: draft }) as CategoryDetailResponse
    return payload.data
  }

  const update = async (id: string, draft: AdminCategoryDraft & { revision: number }): Promise<AdminCategory> => {
    const payload = await plainFetch(`/api/v1/admin/categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: draft,
    }) as CategoryDetailResponse
    return payload.data
  }

  const remove = async (id: string, revision: number): Promise<{ id: string, key: string }> => {
    const payload = await plainFetch(`/api/v1/admin/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      query: { revision },
    }) as { success: boolean, data: { id: string, key: string } }
    return payload.data
  }

  const errorCode = (error: unknown): string | null => {
    const body = (error as ApiErrorBody)?.data
    return body?.data?.error?.code || body?.error?.code || null
  }

  return { list, create, update, remove, errorCode }
}
