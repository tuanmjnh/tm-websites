<script setup lang="ts">
import type { CatalogListQuery } from '../../composables/useCatalog'
import { catalogSegmentFromParam } from '@tm/flow-contracts'
import { buildBreadcrumbJsonLd, buildCanonicalUrl, buildItemListJsonLd, resolveSiteUrl } from '@tm/flow-utils/seo'

const PAGE_SIZE = 12

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const config = useRuntimeConfig()
const requestUrl = useRequestURL()

const slug = computed(() => catalogSegmentFromParam(route.params.slug) ?? '')
const catalog = useCatalogCategory(slug)
const { result: categoryResult } = catalog

const category = computed(() => (categoryResult.value.status === 'ok' ? categoryResult.value.value : null))

if (import.meta.server) {
  // Same as a product: wait for the read so an unknown slug is a 404, not an
  // empty category page served with 200.
  await catalog.ready
  await nextTick()
  if (categoryResult.value.status === 'notfound') {
    throw createError({ statusCode: 404, statusMessage: 'error.categoryNotFound', fatal: true })
  }
}

watch(() => categoryResult.value.status, (value) => {
  if (value === 'notfound') {
    showError({ statusCode: 404, statusMessage: 'error.categoryNotFound' })
  }
})

const readPage = (): number => {
  const raw = Array.isArray(route.query.page) ? route.query.page[0] : route.query.page
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : 1
}

const listQuery = computed<CatalogListQuery>(() => ({
  category: slug.value,
  sort: 'newest',
  page: readPage(),
  limit: PAGE_SIZE,
}))

const { items, total, pending } = useCatalogList(listQuery)

const pageModel = computed({
  get: () => readPage(),
  set: (page: number) => router.push({ query: page > 1 ? { page: String(page) } : {} }),
})

const baseUrl = String(config.public.siteUrl || requestUrl.origin)

/** Page one is the list the category's bare URL describes; a later page is its own. */
const hasOtherQuery = computed(() => Object.keys(route.query).some(key => key !== 'page'))

const canonical = computed(() => {
  const base = buildCanonicalUrl(baseUrl, `/categories/${slug.value}`)
  const page = readPage()
  return page > 1 && !hasOtherQuery.value ? `${base}?page=${page}` : base
})

const title = computed(() => (category.value ? readLocalized(category.value.name, locale.value) : ''))
const description = computed(() => (category.value?.description ? readLocalized(category.value.description, locale.value) : ''))

/** The three steps the template shows, with the category as the current page. */
const breadcrumbs = computed(() => buildBreadcrumbJsonLd(baseUrl, category.value
  ? [
      { name: t('common.home'), path: '/' },
      { name: t('category.indexTitle'), path: '/categories' },
      { name: title.value, path: canonical.value },
    ]
  : []))

/** Page one is the list the category's canonical URL describes; a later page is not. */
const itemList = computed(() => (readPage() > 1
  ? null
  : buildItemListJsonLd(baseUrl, items.value.map(item => ({
      name: readLocalized(item.name, locale.value),
      path: item.path,
    })), { name: title.value })))

const activeStatus = computed(() => {
  if (categoryResult.value.status !== 'ok') return categoryResult.value.status
  return null
})

const robots = usePageRobots({
  keepQuery: ['page'],
  empty: () => readPage() === 1 && !items.value.length,
})

useSeoMeta({
  title: () => title.value,
  description: () => description.value || t('category.indexSubtitle'),
  ogTitle: () => title.value,
  ogDescription: () => description.value,
  ogType: 'website',
  ogUrl: () => canonical.value,
  ogImage: () => resolveSiteUrl(baseUrl, category.value?.image || '/branding/og-cover.png'),
  ogImageAlt: () => title.value,
  twitterImage: () => resolveSiteUrl(baseUrl, category.value?.image || '/branding/og-cover.png'),
  twitterImageAlt: () => title.value,
  robots,
})

useHead(() => {
  if (!category.value) return { link: [] }

  return {
    link: [{ rel: 'canonical', href: canonical.value }],
    script: [
      {
        type: 'application/ld+json',
        innerHTML: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: title.value,
          description: description.value || undefined,
          url: canonical.value,
        }).replace(/</g, '\\u003c'),
      },
      ...(breadcrumbs.value
        ? [{
            type: 'application/ld+json' as const,
            key: 'ld-breadcrumb',
            innerHTML: JSON.stringify(breadcrumbs.value).replace(/</g, '\\u003c'),
          }]
        : []),
      ...(itemList.value
        ? [{
            type: 'application/ld+json' as const,
            key: 'ld-items',
            innerHTML: JSON.stringify(itemList.value).replace(/</g, '\\u003c'),
          }]
        : []),
    ],
  }
})
</script>

<template>
  <div class="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
    <CatalogStateNotice v-if="activeStatus === 'disconnected' || activeStatus === 'unavailable'" :status="activeStatus" />

    <template v-else-if="category">
      <nav class="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted" :aria-label="t('a11y.breadcrumb')">
        <NuxtLink to="/" class="transition-colors hover:text-primary">{{ t('common.home') }}</NuxtLink>
        <span aria-hidden="true">/</span>
        <NuxtLink to="/categories" class="transition-colors hover:text-primary">{{ t('category.indexTitle') }}</NuxtLink>
        <span aria-hidden="true">/</span>
        <span class="truncate text-default">{{ title }}</span>
      </nav>

      <header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div
          v-if="category.image"
          class="size-20 shrink-0 overflow-hidden rounded-[6px] border border-default/60 bg-elevated/30"
        >
          <NuxtImg :src="category.image" :alt="title" width="160" height="160" format="webp" class="size-full object-cover" />
        </div>

        <div>
          <h1 class="text-2xl font-extrabold tracking-tight text-highlighted sm:text-3xl">{{ title }}</h1>
          <p v-if="description" class="mt-1 max-w-2xl text-sm text-muted">{{ description }}</p>
          <p class="mt-1 text-xs text-muted">{{ t('catalog.results', { n: total }) }}</p>
        </div>
      </header>

      <div v-if="items.length" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <CatalogProductCard v-for="item in items" :key="item.id" :item="item" />
      </div>

      <div v-else-if="pending" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <div v-for="index in 4" :key="index" class="aspect-[3/4] animate-pulse rounded-[6px] border border-default/50 bg-elevated/30" />
      </div>

      <div v-else class="rounded-[6px] border border-dashed border-default/70 bg-elevated/20 px-6 py-16 text-center">
        <UIcon name="i-lucide-package" class="mx-auto size-8 text-dimmed" aria-hidden="true" />
        <h2 class="mt-3 text-base font-semibold text-highlighted">{{ t('catalog.empty.title') }}</h2>
        <p class="mt-1 text-sm text-muted">{{ t('category.emptyDescription') }}</p>
        <UButton to="/products" color="primary" variant="soft" size="sm" class="mt-4" :label="t('category.viewAllProducts')" />
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
