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
  data?: { code?: string }
}

/**
 * The catalog is bound per deployment. When no tenant database is configured the
 * BFF answers 503 `CATALOG_NOT_CONFIGURED`; that is an honest "not connected"
 * state for the visitor, not an outage.
 */
const catalogFailure = (error: unknown): CatalogStatus => {
  const failure = error as CatalogErrorLike
  if (failure?.data?.code === 'CATALOG_NOT_CONFIGURED') return 'disconnected'
  if (failure?.statusCode === 404) return 'notfound'
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

export const useCatalogCategory = (slug: Ref<string>) => {
  const enabled = useCatalogEnabled()

  const { data, pending, refresh } = useAsyncData<CatalogResult<PublicCatalogCategory>>(
    () => `catalog:category:${slug.value}`,
    async () => {
      if (!enabled.value) return { status: 'disconnected' }

      try {
        const response = await $fetch<{ success: boolean, data: PublicCatalogCategory }>(
          `/api/public/categories/${encodeURIComponent(slug.value)}`
        )
        return { status: 'ok', value: response.data }
      } catch (error) {
        return { status: catalogFailure(error) } as CatalogResult<PublicCatalogCategory>
      }
    },
    { watch: [slug], default: (): CatalogResult<PublicCatalogCategory> => ({ status: 'disconnected' }) }
  )

  const result = computed<CatalogResult<PublicCatalogCategory>>(() => data.value ?? { status: 'unavailable' })

  return { result, pending, refresh }
}

export const useCatalogItem = (slug: Ref<string>) => {
  const enabled = useCatalogEnabled()

  const { data, pending, refresh } = useAsyncData<CatalogResult<PublicCatalogItemDetail>>(
    () => `catalog:item:${slug.value}`,
    async () => {
      if (!enabled.value) return { status: 'disconnected' }

      try {
        const response = await $fetch<{ success: boolean, data: PublicCatalogItemDetail }>(
          `/api/public/products/${encodeURIComponent(slug.value)}`
        )
        return { status: 'ok', value: response.data }
      } catch (error) {
        return { status: catalogFailure(error) } as CatalogResult<PublicCatalogItemDetail>
      }
    },
    { watch: [slug], default: (): CatalogResult<PublicCatalogItemDetail> => ({ status: 'disconnected' }) }
  )

  const result = computed<CatalogResult<PublicCatalogItemDetail>>(() => data.value ?? { status: 'unavailable' })

  return { result, pending, refresh }
}
