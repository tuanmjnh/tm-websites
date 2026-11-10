import type {
  AdminCatalogCategory,
  AdminCatalogBulkPatch,
  AdminCatalogBulkResult,
  AdminCatalogCategoryDraft,
  AdminCatalogEvent,
  AdminCatalogItem,
  AdminCatalogItemDraft,
  AdminCatalogListMeta,
  AdminCatalogStatusFilter,
  AdminCatalogItemType,
} from '@tm/flow-contracts/catalog-admin'

/**
 * CMS catalog client. Records belong to the deployment's site, so requests carry
 * no site id; the server resolves it from the tenant binding.
 */

export interface CatalogListQuery {
  status?: AdminCatalogStatusFilter
  type?: AdminCatalogItemType
  q?: string
  tag?: string
  category?: string
  cursor?: string
  limit?: number
}

interface ApiErrorBody {
  data?: { error?: { code?: string }, data?: { error?: { code?: string } } }
  error?: { code?: string }
}

export const useCatalogAdmin = () => {
  const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

  const list = async (query: CatalogListQuery = {}) => {
    return await plainFetch('/api/v1/admin/catalog/items', { query }) as {
      success: boolean
      data: AdminCatalogItem[]
      meta?: AdminCatalogListMeta
    }
  }

  const get = async (id: string): Promise<AdminCatalogItem> => {
    const payload = await plainFetch(`/api/v1/admin/catalog/items/${encodeURIComponent(id)}`) as { data: AdminCatalogItem }
    return payload.data
  }

  const create = async (draft: AdminCatalogItemDraft): Promise<AdminCatalogItem> => {
    const payload = await plainFetch('/api/v1/admin/catalog/items', { method: 'POST', body: draft }) as { data: AdminCatalogItem }
    return payload.data
  }

  const update = async (id: string, draft: AdminCatalogItemDraft & { revision: number }): Promise<AdminCatalogItem> => {
    const payload = await plainFetch(`/api/v1/admin/catalog/items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: draft,
    }) as { data: AdminCatalogItem }
    return payload.data
  }

  const runEvent = async (id: string, event: AdminCatalogEvent, revision: number): Promise<AdminCatalogItem> => {
    const payload = await plainFetch(`/api/v1/admin/catalog/items/${encodeURIComponent(id)}/events`, {
      method: 'POST',
      body: { event, revision },
    }) as { data: AdminCatalogItem }
    return payload.data
  }

  /** Applies a partial price/stock patch to many records; each row answers separately. */
  const bulkUpdate = async (patch: AdminCatalogBulkPatch): Promise<AdminCatalogBulkResult> => {
    const payload = await plainFetch('/api/v1/admin/catalog/items/bulk', {
      method: 'POST',
      body: patch,
    }) as { data: AdminCatalogBulkResult }
    return payload.data
  }

  const listCategories = async (): Promise<AdminCatalogCategory[]> => {
    const payload = await plainFetch('/api/v1/admin/catalog/categories') as { data: AdminCatalogCategory[] }
    return payload.data
  }

  const createCategory = async (draft: AdminCatalogCategoryDraft): Promise<AdminCatalogCategory> => {
    const payload = await plainFetch('/api/v1/admin/catalog/categories', {
      method: 'POST',
      body: draft,
    }) as { data: AdminCatalogCategory }
    return payload.data
  }

  const updateCategory = async (
    id: string,
    draft: AdminCatalogCategoryDraft & { revision: number },
  ): Promise<AdminCatalogCategory> => {
    const payload = await plainFetch(`/api/v1/admin/catalog/categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: draft,
    }) as { data: AdminCatalogCategory }
    return payload.data
  }

  const deleteCategory = async (id: string, revision: number): Promise<void> => {
    await plainFetch(`/api/v1/admin/catalog/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      query: { revision },
    })
  }

  const listTags = async (): Promise<{ name: string, count: number }[]> => {
    const payload = await plainFetch('/api/v1/admin/catalog/tags') as { data: { name: string, count: number }[] }
    return payload.data
  }

  const errorCode = (error: unknown): string | null => {
    const body = (error as ApiErrorBody)?.data
    return body?.data?.error?.code || body?.error?.code || null
  }

  return {
    list,
    get,
    create,
    update,
    runEvent,
    bulkUpdate,
    listCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    listTags,
    errorCode,
  }
}
