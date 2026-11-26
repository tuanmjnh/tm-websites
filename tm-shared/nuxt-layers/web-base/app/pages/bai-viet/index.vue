<script setup lang="ts">
import type { PublicContentListItem } from '@tm/flow-contracts/content-public'
import { PUBLIC_CONTENT_SEARCH_MAX } from '@tm/flow-contracts/content-public'
import { buildCanonicalUrl, buildItemListJsonLd } from '@tm/flow-utils/seo'

/**
 * Public post listing. It reads the same public content API as a single page
 * (published + inside its window + allowlisted fields), so an unpublished post
 * can never appear here even if someone links straight to this route.
 *
 * Search is a literal, bounded term (`q`); the route rejects anything longer than
 * PUBLIC_CONTENT_SEARCH_MAX instead of silently truncating the visitor's query.
 */

const PAGE_SIZE = 12

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const config = useRuntimeConfig()
const requestUrl = useRequestURL()

const baseUrl = String(config.public.siteUrl || requestUrl.origin)

const readQuery = (key: string) => {
  const raw = route.query[key]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value.trim() : ''
}

const tag = computed(() => readQuery('tag'))
const category = computed(() => readQuery('category'))
const q = computed(() => readQuery('q'))

/**
 * The site owner chooses the list affordance in Settings: `offset` renders
 * numbered pages (a real `?page=` URL), `cursor` keeps the load-more button.
 */
const { paginationType } = usePublicSite()
const paged = computed(() => paginationType.value === 'offset')
const page = computed(() => {
  if (!paged.value) return 1
  const parsed = Number(readQuery('page'))
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : 1
})
const total = ref(0)

const canonical = computed(() => {
  const base = buildCanonicalUrl(baseUrl, '/bai-viet')
  const filtered = Boolean(q.value || tag.value || category.value)
  return paged.value && page.value > 1 && !filtered ? `${base}?page=${page.value}` : base
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

/**
 * The listing filters on the stored category `key`, but a visitor must read the
 * display name. The category row also supplies the landing slug, so the badge can
 * link to `/danh-muc/<slug>` instead of repeating the raw key in the URL.
 */
const { categories, byKey } = usePublicContentCategories()
const activeCategory = computed(() => (category.value ? byKey.value.get(category.value) ?? null : null))
const categoryLabel = computed(() => activeCategory.value?.name || category.value)

const search = ref(q.value)
watch(q, value => { search.value = value })

const items = ref<PublicContentListItem[]>([])
const cursor = ref<string | null>(null)
const hasMore = ref(false)
const loading = ref(false)
const loadError = ref(false)

async function load(reset = true) {
  if (loading.value) return
  loading.value = true
  loadError.value = false

  try {
    const response = await $fetch<{
      success: boolean
      data: PublicContentListItem[]
      meta: { nextCursor: string | null, hasMore: boolean, page?: number, total?: number }
    }>('/api/public/content', {
      query: {
        type: 'post',
        locale: locale.value,
        limit: PAGE_SIZE,
        q: q.value || undefined,
        tag: tag.value || undefined,
        category: category.value || undefined,
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

function submitSearch() {
  const term = search.value.trim().slice(0, PUBLIC_CONTENT_SEARCH_MAX)
  const query = { ...route.query }
  if (term) query.q = term
  else delete query.q
  delete query.page
  router.push({ query })
}

function clearFilters() {
  router.push('/bai-viet')
}

await load()
watch([tag, category, q, locale, paged, page], () => load())

const robots = usePageRobots({ keepQuery: paged.value ? ['page'] : [], empty: () => !items.value.length })

useSeoMeta({
  title: () => (q.value ? t('post.searchTitle', { q: q.value }) : t('post.indexTitle')),
  description: () => t('post.indexSubtitle'),
  ogTitle: () => (q.value ? t('post.searchTitle', { q: q.value }) : t('post.indexTitle')),
  ogDescription: () => t('post.indexSubtitle'),
  ogType: 'website',
  ogUrl: canonical,
  robots,
})

/** The plain listing is the collection this URL describes; a search or tag view is not. */
const itemList = computed(() => {
  if (q.value || tag.value || category.value) return null
  return buildItemListJsonLd(baseUrl, items.value.map(item => ({
    name: item.title,
    path: item.path,
  })), { name: t('post.indexTitle') })
})

useHead({
  link: [{ rel: 'canonical', href: canonical }],
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
  <div class="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
    <header class="mb-8">
      <h1 class="text-2xl font-extrabold tracking-tight text-highlighted sm:text-3xl">
        {{ q ? t('post.searchTitle', { q }) : t('post.indexTitle') }}
      </h1>
      <p class="mt-1 text-sm text-muted">{{ t('post.indexSubtitle') }}</p>

      <form class="mt-4 flex max-w-md items-center gap-2" role="search" @submit.prevent="submitSearch">
        <UInput
          v-model="search"
          name="q"
          :maxlength="PUBLIC_CONTENT_SEARCH_MAX"
          :placeholder="t('post.searchPlaceholder')"
          icon="i-lucide-search"
          class="flex-1"
          :aria-label="t('post.searchPlaceholder')"
        />
        <UButton type="submit" color="primary" variant="soft" size="sm" :label="t('post.searchAction')" />
      </form>

      <NuxtLink
        v-if="categories.length"
        to="/danh-muc"
        class="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <UIcon name="i-lucide-folder" class="size-3.5" aria-hidden="true" />
        {{ t('categoryContent.browseAll') }}
      </NuxtLink>

      <div v-if="tag || category || q" class="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <UBadge v-if="q" color="primary" variant="subtle" size="sm">
          {{ t('post.filterQuery', { q }) }}
        </UBadge>
        <UBadge v-if="tag" color="neutral" variant="subtle" size="sm">
          {{ t('post.filterTag', { tag }) }}
        </UBadge>
        <NuxtLink
          v-if="category && activeCategory"
          :to="`/danh-muc/${encodeURIComponent(activeCategory.slug)}`"
          class="inline-flex"
        >
          <UBadge color="secondary" variant="subtle" size="sm">
            {{ categoryLabel }}
          </UBadge>
        </NuxtLink>
        <UBadge v-else-if="category" color="secondary" variant="subtle" size="sm">
          {{ categoryLabel }}
        </UBadge>
        <UButton color="neutral" variant="ghost" size="xs" :label="t('post.clearFilter')" @click="clearFilters" />
      </div>
    </header>

    <WebContentList
      :items="items"
      :loading="loading"
      :error="loadError"
      :has-more="!paged && hasMore"
      :empty-text="q ? t('post.searchEmpty', { q }) : t('post.empty')"
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
