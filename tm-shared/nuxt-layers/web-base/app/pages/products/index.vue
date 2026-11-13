<script setup lang="ts">
import type { CatalogListQuery } from '../../composables/useCatalog'
import { PUBLIC_CATALOG_SORTS } from '@tm/flow-contracts'
import { buildCanonicalUrl, buildItemListJsonLd } from '@tm/flow-utils/seo'

const PAGE_SIZE = 12

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const config = useRuntimeConfig()
const requestUrl = useRequestURL()

const baseUrl = String(config.public.siteUrl || requestUrl.origin)
/** The URL carries filters, so a paged view is only canonical when nothing is filtered. */
const urlFilters = computed(() => Boolean(
  queryValue(route.query.q) || queryValue(route.query.category)
  || queryValue(route.query.min) || queryValue(route.query.max)
  || queryValue(route.query.sort) && queryValue(route.query.sort) !== 'newest',
))

const canonical = computed(() => {
  const base = buildCanonicalUrl(baseUrl, '/products')
  const page = readPage()
  return page > 1 && !urlFilters.value ? `${base}?page=${page}` : base
})

const queryValue = (value: unknown): string => {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' ? raw.trim() : ''
}

const queryNumber = (value: unknown): number | undefined => {
  const raw = queryValue(value)
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

const sortValues = PUBLIC_CATALOG_SORTS as readonly string[]

const sortOptions = computed(() => [
  { label: t('catalog.sort.newest'), value: 'newest' },
  { label: t('catalog.sort.price-asc'), value: 'price-asc' },
  { label: t('catalog.sort.price-desc'), value: 'price-desc' },
  { label: t('catalog.sort.name-asc'), value: 'name-asc' },
  { label: t('catalog.sort.popular'), value: 'popular' },
])

const readSort = (): string => {
  const raw = queryValue(route.query.sort)
  return sortValues.includes(raw) ? raw : 'newest'
}

const readPage = (): number => {
  const parsed = queryNumber(route.query.page) ?? 1
  return Math.max(1, Math.trunc(parsed))
}

const listQuery = computed<CatalogListQuery>(() => ({
  search: queryValue(route.query.q) || undefined,
  category: queryValue(route.query.category) || undefined,
  sort: readSort(),
  minPrice: queryNumber(route.query.min),
  maxPrice: queryNumber(route.query.max),
  page: readPage(),
  limit: PAGE_SIZE,
}))

const { result, items, total, pending } = useCatalogList(listQuery)
const { categories } = useCatalogCategories()

const categoryItems = computed(() => [
  { label: t('catalog.allCategories'), value: '' },
  ...categories.value.map(category => ({
    label: readLocalized(category.name, locale.value),
    value: readLocalized(category.slug, locale.value),
  })),
])

const searchInput = ref(queryValue(route.query.q))
const categoryValue = ref(queryValue(route.query.category))
const sortValue = ref(readSort())
const minPrice = ref(queryNumber(route.query.min)?.toString() ?? '')
const maxPrice = ref(queryNumber(route.query.max)?.toString() ?? '')

watch(() => route.query, () => {
  searchInput.value = queryValue(route.query.q)
  categoryValue.value = queryValue(route.query.category)
  sortValue.value = readSort()
  minPrice.value = queryNumber(route.query.min)?.toString() ?? ''
  maxPrice.value = queryNumber(route.query.max)?.toString() ?? ''
})

const commit = (patch: Record<string, string | number | undefined>, keepPage = false) => {
  const next: Record<string, string> = {}

  const merged: Record<string, string | number | undefined> = {
    q: searchInput.value || undefined,
    category: categoryValue.value || undefined,
    sort: sortValue.value === 'newest' ? undefined : sortValue.value,
    min: minPrice.value.trim() || undefined,
    max: maxPrice.value.trim() || undefined,
    page: keepPage ? (readPage() > 1 ? readPage() : undefined) : undefined,
    ...patch,
  }

  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === '') continue
    next[key] = String(value)
  }

  router.push({ path: '/products', query: next })
}

const onSearch = useDebounceFn(() => commit({}), 400)

const applyFilters = () => commit({})

const clearFilters = () => {
  searchInput.value = ''
  categoryValue.value = ''
  sortValue.value = 'newest'
  minPrice.value = ''
  maxPrice.value = ''
  router.push({ path: '/products' })
}

const hasFilters = computed(() =>
  Boolean(searchInput.value || categoryValue.value || minPrice.value || maxPrice.value || readSort() !== 'newest')
)

const pageModel = computed({
  get: () => readPage(),
  set: (page: number) => commit({ page: page > 1 ? page : undefined }, true),
})

const activeStatus = computed(() => (result.value.status === 'ok' ? null : result.value.status))

const robots = usePageRobots({ keepQuery: ['page'], empty: () => !items.value.length })

useSeoMeta({
  title: () => t('catalog.title'),
  description: () => t('catalog.subtitle'),
  ogTitle: () => t('catalog.title'),
  ogDescription: () => t('catalog.subtitle'),
  ogType: 'website',
  ogUrl: () => canonical.value,
  robots,
})

/**
 * Only the unfiltered first page is what the canonical `/products` URL describes,
 * so a filtered or paged view publishes no list a crawler could cache as the catalog.
 */
const itemList = computed(() => {
  if (hasFilters.value || readPage() > 1) return null
  return buildItemListJsonLd(baseUrl, items.value.map(item => ({
    name: readLocalized(item.name, locale.value),
    path: item.path,
  })), { name: t('catalog.title') })
})

useHead({
  link: [{ rel: 'canonical', href: () => canonical.value }],
  script: () => (itemList.value
    ? [{
        type: 'application/ld+json' as const,
        key: 'ld-items',
        innerHTML: JSON.stringify(itemList.value).replace(/</g, '\\u003c'),
      }]
    : []),
})
</script>

<template>
  <div class="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
    <header class="mb-6">
      <h1 class="text-2xl font-extrabold tracking-tight text-highlighted sm:text-3xl">
        {{ t('catalog.title') }}
      </h1>
      <p class="mt-1 text-sm text-muted">{{ t('catalog.subtitle') }}</p>
    </header>

    <CatalogStateNotice
      v-if="activeStatus === 'disconnected' || activeStatus === 'unavailable'"
      :status="activeStatus"
    />

    <template v-else>
      <div class="mb-6 flex flex-col gap-3 rounded-[6px] border border-default/60 bg-elevated/20 p-3 sm:flex-row sm:items-center">
        <UInput
          v-model="searchInput"
          icon="i-lucide-search"
          :placeholder="t('catalog.searchPlaceholder')"
          :aria-label="t('catalog.searchPlaceholder')"
          class="w-full sm:flex-1"
          :loading="pending"
          @update:model-value="onSearch"
        />

        <USelectMenu
          v-model="categoryValue"
          :items="categoryItems"
          value-key="value"
          :search-input="{ icon: 'i-lucide-search', placeholder: t('catalog.searchCategory') }"
          :placeholder="t('catalog.allCategories')"
          class="w-full sm:w-56"
          @update:model-value="commit({})"
        >
          <template #empty>{{ t('catalog.state.disconnected.description') }}</template>
        </USelectMenu>

        <USelect
          v-model="sortValue"
          :items="sortOptions"
          value-key="value"
          :aria-label="t('catalog.sortLabel')"
          class="w-full sm:w-44"
          @update:model-value="commit({})"
        />

        <UButton
          v-if="hasFilters"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-x"
          :label="t('catalog.clearFilters')"
          class="shrink-0"
          @click="clearFilters"
        />
      </div>

      <div class="mb-4 flex items-center justify-between gap-3">
        <p class="text-xs text-muted">
          {{ t('catalog.results', { n: total }) }}
        </p>
        <UButton
          v-if="readSort() !== 'newest'"
          color="primary"
          variant="link"
          size="xs"
          :label="t('catalog.sort.newest')"
          @click="commit({ sort: undefined })"
        />
      </div>

      <div v-if="items.length" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <CatalogProductCard v-for="item in items" :key="item.id" :item="item" />
      </div>

      <div v-else-if="pending" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <div v-for="index in 4" :key="index" class="aspect-[3/4] animate-pulse rounded-[6px] border border-default/50 bg-elevated/30" />
      </div>

      <div v-else class="rounded-[6px] border border-dashed border-default/70 bg-elevated/20 px-6 py-16 text-center">
        <UIcon name="i-lucide-package" class="mx-auto size-8 text-dimmed" aria-hidden="true" />
        <h2 class="mt-3 text-base font-semibold text-highlighted">{{ t('catalog.empty.title') }}</h2>
        <p class="mt-1 text-sm text-muted">{{ t('catalog.empty.description') }}</p>
        <UButton
          v-if="hasFilters"
          color="primary"
          variant="soft"
          size="sm"
          class="mt-4"
          :label="t('catalog.clearFilters')"
          @click="clearFilters"
        />
      </div>

      <div v-if="total > PAGE_SIZE" class="mt-8 flex justify-center">
        <UPagination
          :aria-label="t('a11y.pagination')"
          class="w-full"
          :ui="{ list: 'flex-wrap justify-center' }"
          v-model:page="pageModel"
          :total="total"
          :items-per-page="PAGE_SIZE"
          :sibling-count="1"
          show-edges
        />
      </div>
    </template>
  </div>
</template>
