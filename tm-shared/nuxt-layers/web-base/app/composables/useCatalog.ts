import type {
  PublicCatalogCategory,
  PublicCatalogItemDetail,
  PublicCatalogList,
} from '@tm/flow-contracts'

export type CatalogStatus = 'ok' | 'disconnected' | 'unavailable' | 'notfound'

export type CatalogResult<T> =
  | { status: 'ok', value: T }
  | { status: 'disconnected' }
  | { status: 'unavailable' }
  | { status: 'notfound' }

export interface CatalogListQuery {
  category?: string
  search?: string
  sort?: string
  minPrice?: number
  maxPrice?: number
  page?: number
  limit?: number
}

interface CatalogErrorLike {
  statusCode?: number
  status?: number
  response?: { status?: number, _data?: { code?: string } }
  data?: { code?: string }
}

/**
 * `$fetch` carries the HTTP status in more than one place depending on where it
 * failed: `statusCode` on a thrown H3 error, `status` on the fetch error itself,
 * or only on the response. Reading one of them turns a real 404 into an empty
 * page, which is why all three are checked.
 */
const catalogErrorStatus = (failure: CatalogErrorLike | undefined): number | undefined =>
  failure?.statusCode ?? failure?.status ?? failure?.response?.status

const catalogErrorCode = (failure: CatalogErrorLike | undefined): string | undefined =>
  failure?.data?.code ?? failure?.response?._data?.code

/**
 * The catalog is bound per deployment. When no tenant database is configured the
 * BFF answers 503 `CATALOG_NOT_CONFIGURED`; that is an honest "not connected"
 * state for the visitor, not an outage.
 */
const catalogFailure = (error: unknown): CatalogStatus => {
  const failure = error as CatalogErrorLike
  if (catalogErrorCode(failure) === 'CATALOG_NOT_CONFIGURED') return 'disconnected'
  if (catalogErrorStatus(failure) === 404) return 'notfound'
  return 'unavailable'
}

export const useCatalogEnabled = () => {
  const config = useRuntimeConfig()
  return computed(() => Boolean(config.public.catalogEnabled))
}

export const useCatalogList = (query: Ref<CatalogListQuery>) => {
  const enabled = useCatalogEnabled()

  const { data, pending, refresh } = useAsyncData<CatalogResult<PublicCatalogList>>(
    () => `catalog:list:${JSON.stringify(query.value)}`,
    async () => {
      if (!enabled.value) return { status: 'disconnected' }

      try {
        const value = await $fetch<PublicCatalogList>('/api/public/products', {
          query: query.value as Record<string, unknown>,
        })
        return { status: 'ok', value }
      } catch (error) {
        return { status: catalogFailure(error) } as CatalogResult<PublicCatalogList>
      }
    },
    { watch: [query], default: (): CatalogResult<PublicCatalogList> => ({ status: 'disconnected' }) }
  )

  const result = computed<CatalogResult<PublicCatalogList>>(() => data.value ?? { status: 'unavailable' })
  const items = computed(() => (result.value.status === 'ok' ? result.value.value.data : []))
  const total = computed(() => (result.value.status === 'ok' ? result.value.value.total : 0))

  return { result, items, total, pending, refresh }
}

export const useCatalogCategories = () => {
  const enabled = useCatalogEnabled()

  const { data, pending, refresh } = useAsyncData<CatalogResult<PublicCatalogCategory[]>>(
    'catalog:categories',
    async () => {
      if (!enabled.value) return { status: 'disconnected' }

      try {
        const response = await $fetch<{ success: boolean, data: PublicCatalogCategory[] }>('/api/public/categories')
        return { status: 'ok', value: response.data }
      } catch (error) {
        return { status: catalogFailure(error) } as CatalogResult<PublicCatalogCategory[]>
      }
    },
    { default: (): CatalogResult<PublicCatalogCategory[]> => ({ status: 'disconnected' }) }
  )

  const result = computed<CatalogResult<PublicCatalogCategory[]>>(() => data.value ?? { status: 'unavailable' })
  const categories = computed(() => (result.value.status === 'ok' ? result.value.value : []))

  return { result, categories, pending, refresh }
}

/**
 * One read whose 404 the page has to answer itself.
 *
 * SSR never runs watchers and the read settles after setup, so `ready` is the
 * signal a page can await before deciding the response status; on the client the
 * same decision comes from watching the status instead.
 */
export const useCatalogCategory = (slug: Ref<string>) => {
  const enabled = useCatalogEnabled()

  let settle: (() => void) | undefined
  const ready = new Promise<void>((resolve) => { settle = resolve })

  const { data, pending, refresh, error } = useAsyncData<CatalogResult<PublicCatalogCategory>>(
    () => `catalog:category:${slug.value}`,
    async () => {
      try {
        if (!enabled.value) return { status: 'disconnected' }

        const response = await $fetch<{ success: boolean, data: PublicCatalogCategory }>(
          `/api/public/categories/${encodeURIComponent(slug.value)}`
        )
        return { status: 'ok', value: response.data }
      } catch (error) {
        return { status: catalogFailure(error) } as CatalogResult<PublicCatalogCategory>
      } finally {
        settle?.()
      }
    },
    { watch: [slug], default: (): CatalogResult<PublicCatalogCategory> => ({ status: 'disconnected' }) }
  )

  const result = computed<CatalogResult<PublicCatalogCategory>>(() => data.value ?? { status: 'unavailable' })

  return { result, pending, refresh, error, ready }
}

export const useCatalogItem = (slug: Ref<string>) => {
  const enabled = useCatalogEnabled()

  let settle: (() => void) | undefined
  const ready = new Promise<void>((resolve) => { settle = resolve })

  const { data, pending, refresh, error } = useAsyncData<CatalogResult<PublicCatalogItemDetail>>(
    () => `catalog:item:${slug.value}`,
    async () => {
      try {
        if (!enabled.value) return { status: 'disconnected' }

        const response = await $fetch<{ success: boolean, data: PublicCatalogItemDetail }>(
          `/api/public/products/${encodeURIComponent(slug.value)}`
        )
        return { status: 'ok', value: response.data }
      } catch (error) {
        return { status: catalogFailure(error) } as CatalogResult<PublicCatalogItemDetail>
      } finally {
        settle?.()
      }
    },
    { watch: [slug], default: (): CatalogResult<PublicCatalogItemDetail> => ({ status: 'disconnected' }) }
  )

  const result = computed<CatalogResult<PublicCatalogItemDetail>>(() => data.value ?? { status: 'unavailable' })

  return { result, pending, refresh, error, ready }
}
