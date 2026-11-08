<script setup lang="ts">
import type { PublicContentListItem } from '@tm/flow-contracts/content-public'
import { buildCanonicalUrl } from '@tm/flow-utils/seo'

/**
 * Tag landing page. Tags are free-form strings on a content record, so the URL
 * is the tag itself and the page reuses the public listing policy: a tag with no
 * published record renders the empty state, never a 404, because the tag may
 * exist on drafts only.
 */

const PAGE_SIZE = 12

const { t, locale } = useI18n()
const route = useRoute()
const config = useRuntimeConfig()
const requestUrl = useRequestURL()

const tag = computed(() => (typeof route.params.tag === 'string' ? route.params.tag.trim() : ''))
const baseUrl = String(config.public.siteUrl || requestUrl.origin)
const canonical = computed(() => buildCanonicalUrl(baseUrl, `/tag/${encodeURIComponent(tag.value)}`))

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
      meta: { nextCursor: string | null, hasMore: boolean }
    }>('/api/public/content', {
      query: {
        tag: tag.value,
        locale: locale.value,
        limit: PAGE_SIZE,
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

await load()
watch([tag, locale], () => load())

useSeoMeta({
  title: () => `#${tag.value}`,
  description: () => t('tag.subtitle', { tag: tag.value }),
  ogTitle: () => `#${tag.value}`,
  ogDescription: () => t('tag.subtitle', { tag: tag.value }),
  ogType: 'website',
  ogUrl: () => canonical.value,
  robots: () => (config.public.indexable === false ? 'noindex, nofollow' : 'index, follow'),
})

useHead({
  link: [{ rel: 'canonical', href: () => canonical.value }],
})
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
    <nav class="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted" aria-label="Breadcrumb">
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
      :has-more="hasMore"
      :empty-text="t('tag.empty', { tag })"
      @load-more="load(false)"
    />
  </div>
</template>
