<script setup lang="ts">
import type { PublicContentListItem } from '@tm/flow-contracts/content-public'
import { PUBLIC_CONTENT_SEARCH_MAX } from '@tm/flow-contracts/content-public'
import { buildCanonicalUrl } from '@tm/flow-utils/seo'

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
const canonical = buildCanonicalUrl(baseUrl, '/bai-viet')

const readQuery = (key: string) => {
  const raw = route.query[key]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value.trim() : ''
}

const tag = computed(() => readQuery('tag'))
const category = computed(() => readQuery('category'))
const q = computed(() => readQuery('q'))

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
      meta: { nextCursor: string | null, hasMore: boolean }
    }>('/api/public/content', {
      query: {
        type: 'post',
        locale: locale.value,
        limit: PAGE_SIZE,
        q: q.value || undefined,
        tag: tag.value || undefined,
        category: category.value || undefined,
        cursor: reset ? undefined : cursor.value ?? undefined,
      },
    })

    items.value = reset
      ? response.data
      : [...items.value, ...response.data.filter(item => !items.value.some(existing => existing.key === item.key))]
    cursor.value = response.meta.nextCursor
    hasMore.value = response.meta.hasMore
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
watch([tag, category, q, locale], () => load())

useSeoMeta({
  title: () => (q.value ? t('post.searchTitle', { q: q.value }) : t('post.indexTitle')),
  description: () => t('post.indexSubtitle'),
  ogTitle: () => (q.value ? t('post.searchTitle', { q: q.value }) : t('post.indexTitle')),
  ogDescription: () => t('post.indexSubtitle'),
  ogType: 'website',
  ogUrl: canonical,
  robots: () => (config.public.indexable === false ? 'noindex, nofollow' : 'index, follow'),
})

useHead({
  link: [{ rel: 'canonical', href: canonical }],
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

      <div v-if="tag || category || q" class="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <UBadge v-if="q" color="primary" variant="subtle" size="sm">
          {{ t('post.filterQuery', { q }) }}
        </UBadge>
        <UBadge v-if="tag" color="neutral" variant="subtle" size="sm">
          {{ t('post.filterTag', { tag }) }}
        </UBadge>
        <UBadge v-if="category" color="secondary" variant="subtle" size="sm">
          {{ category }}
        </UBadge>
        <UButton color="neutral" variant="ghost" size="xs" :label="t('post.clearFilter')" @click="clearFilters" />
      </div>
    </header>

    <WebContentList
      :items="items"
      :loading="loading"
      :error="loadError"
      :has-more="hasMore"
      :empty-text="q ? t('post.searchEmpty', { q }) : t('post.empty')"
      @load-more="load(false)"
    />
  </div>
</template>
