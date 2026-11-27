<script setup lang="ts">
import type { PublicContentListItem } from '@tm/flow-contracts/content-public'
import { buildBreadcrumbJsonLd, buildCanonicalUrl, buildItemListJsonLd } from '@tm/flow-utils/seo'

/**
 * Tag landing page. Tags are free-form strings on a content record, so the URL
 * is the tag itself and the page reuses the public listing policy: a tag with no
 * published record renders the empty state, never a 404, because the tag may
 * exist on drafts only. It is `noindex` in that state, though: anyone can invent
 * a `/tag/<anything>` URL, and an indexable empty page is a soft 404.
 */

const PAGE_SIZE = 12

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const config = useRuntimeConfig()
const requestUrl = useRequestURL()

const tag = computed(() => (typeof route.params.tag === 'string' ? route.params.tag.trim() : ''))
const baseUrl = String(config.public.siteUrl || requestUrl.origin)

/** `offset` renders numbered pages, `cursor` keeps the load-more button. */
const paginationType = await usePublicPaginationType()
const paged = computed(() => paginationType.value === 'offset')
const page = computed(() => {
  if (!paged.value) return 1
  const raw = route.query.page
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : 1
})
const total = ref(0)

const canonical = computed(() => {
  const base = buildCanonicalUrl(baseUrl, `/tag/${encodeURIComponent(tag.value)}`)
  return paged.value && page.value > 1 ? `${base}?page=${page.value}` : base
})

const pageModel = computed({
  get: () => page.value,
  set: (value: number) => {
    const query = { ...route.query }
    if (value > 1) query.page = String(value)
    else delete query.page
    router.push({ query })
  },
})

const items = ref<PublicContentListItem[]>([])
const cursor = ref<string | null>(null)
const hasMore = ref(false)
const loading = ref(false)
const loadError = ref(false)

async function load(reset = true) {
  if (loading.value || !tag.value) return
  loading.value = true
  loadError.value = false

  try {
    const response = await $fetch<{
      success: boolean
      data: PublicContentListItem[]
      meta: { nextCursor: string | null, hasMore: boolean, page?: number, total?: number }
    }>('/api/public/content', {
      query: {
        tag: tag.value,
        locale: locale.value,
        limit: PAGE_SIZE,
        page: paged.value ? page.value : undefined,
        cursor: paged.value ? undefined : (reset ? undefined : cursor.value ?? undefined),
      },
    })

    items.value = reset || paged.value
      ? response.data
      : [...items.value, ...response.data.filter(item => !items.value.some(existing => existing.key === item.key))]
    cursor.value = response.meta.nextCursor
    hasMore.value = response.meta.hasMore
    total.value = response.meta.total ?? items.value.length
  } catch {
    if (reset) items.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

await load()
watch([tag, locale, paged, page], () => load())

// A paged URL is its own canonical, so `page` is the one query key that stays
// indexable; every other parameter drops the page out of the index.
const robots = usePageRobots({ keepQuery: paged.value ? ['page'] : [], empty: () => !items.value.length })

useSeoMeta({
  title: () => `#${tag.value}`,
  description: () => t('tag.subtitle', { tag: tag.value }),
  ogTitle: () => `#${tag.value}`,
  ogDescription: () => t('tag.subtitle', { tag: tag.value }),
  ogType: 'website',
  ogUrl: () => canonical.value,
  robots,
})

/** Home → posts → the tag, matching the trail the template renders. */
const breadcrumbs = computed(() => buildBreadcrumbJsonLd(baseUrl, tag.value
  ? [
      { name: t('common.home'), path: '/' },
      { name: t('post.indexTitle'), path: '/bai-viet' },
      { name: `#${tag.value}`, path: canonical.value },
    ]
  : []))

/** The cards this tag lists, so a crawler sees the posts without following each link. */
const itemList = computed(() => buildItemListJsonLd(baseUrl, items.value.map(item => ({
  name: item.title,
  path: item.path,
})), { name: `#${tag.value}` }))

/** Both JSON-LD blocks, keyed so one never replaces the other. */
const jsonLd = computed(() => {
  const blocks: { type: 'application/ld+json', key: string, innerHTML: string }[] = []
  for (const [key, data] of [['ld-breadcrumb', breadcrumbs.value], ['ld-items', itemList.value]] as const) {
    if (data) blocks.push({ type: 'application/ld+json', key, innerHTML: JSON.stringify(data).replace(/</g, '\\u003c') })
  }
  return blocks
})

useHead({
  link: [{ rel: 'canonical', href: () => canonical.value }],
  script: () => jsonLd.value,
})
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
    <nav class="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted" :aria-label="t('a11y.breadcrumb')">
      <NuxtLink to="/" class="transition-colors hover:text-primary">{{ t('common.home') }}</NuxtLink>
      <span aria-hidden="true">/</span>
      <NuxtLink to="/bai-viet" class="transition-colors hover:text-primary">{{ t('post.indexTitle') }}</NuxtLink>
      <span aria-hidden="true">/</span>
      <span class="truncate text-default">#{{ tag }}</span>
    </nav>

    <header class="mb-8">
      <h1 class="text-2xl font-extrabold tracking-tight text-highlighted sm:text-3xl">#{{ tag }}</h1>
      <p class="mt-1 text-sm text-muted">{{ t('tag.subtitle', { tag }) }}</p>
    </header>

    <WebContentList
      :items="items"
      :loading="loading"
      :error="loadError"
      :has-more="!paged && hasMore"
      :empty-text="t('tag.empty', { tag })"
      @load-more="load(false)"
    />

    <div v-if="paged && total > PAGE_SIZE" class="mt-8 flex justify-center">
      <UPagination
        v-model:page="pageModel"
        :aria-label="t('a11y.pagination')"
        class="w-full"
        :ui="{ list: 'flex-wrap justify-center' }"
        :total="total"
        :items-per-page="PAGE_SIZE"
        :sibling-count="1"
        show-edges
      />
    </div>
  </div>
</template>
