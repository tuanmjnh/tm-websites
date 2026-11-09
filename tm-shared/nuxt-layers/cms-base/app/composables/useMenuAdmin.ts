import type {
  AdminMenu,
  AdminMenuPatch,
  AdminMenuSummary,
  MenuLinkOptions,
} from '@tm/flow-contracts/menu-admin'

/**
 * CMS menu client. Menus belong to the deployment's site, so a request never
 * carries a tenant id; the revision travels back with each save.
 */
export const useMenuAdmin = () => {
  const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

  const list = async (): Promise<AdminMenuSummary[]> => {
    const payload = await plainFetch('/api/v1/admin/menus') as { data: AdminMenuSummary[] }
    return payload.data
  }

  const get = async (id: string): Promise<AdminMenu> => {
    const payload = await plainFetch(`/api/v1/admin/menus/${encodeURIComponent(id)}`) as { data: AdminMenu }
    return payload.data
  }

  const create = async (draft: { key: string, name: string }): Promise<AdminMenu> => {
    const payload = await plainFetch('/api/v1/admin/menus', { method: 'POST', body: draft }) as { data: AdminMenu }
    return payload.data
  }

  const save = async (id: string, patch: AdminMenuPatch): Promise<AdminMenu> => {
    const payload = await plainFetch(`/api/v1/admin/menus/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
    }) as { data: AdminMenu }
    return payload.data
  }

  const remove = async (id: string, revision: number): Promise<{ id: string, key: string }> => {
    const payload = await plainFetch(`/api/v1/admin/menus/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      query: { revision },
    }) as { data: { id: string, key: string } }
    return payload.data
  }

  /** Pages and categories this site can link to, for the item dialog. */
  const linkOptions = async (): Promise<MenuLinkOptions> => {
    const payload = await plainFetch('/api/v1/admin/menus/link-options') as { data: MenuLinkOptions }
    return payload.data
  }

  const errorCode = (error: unknown): string | null => {
    const body = (error as { data?: { error?: { code?: string }, data?: { error?: { code?: string } } } })?.data
    return body?.error?.code ?? body?.data?.error?.code ?? null
  }

  return { list, get, create, save, remove, linkOptions, errorCode }
}
