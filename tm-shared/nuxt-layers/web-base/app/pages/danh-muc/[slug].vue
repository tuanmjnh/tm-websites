<script setup lang="ts">
import type { PublicContentCategory, PublicContentListItem } from '@tm/flow-contracts/content-public'
import { buildBreadcrumbJsonLd, buildCanonicalUrl, buildItemListJsonLd, resolveSiteUrl } from '@tm/flow-utils/seo'

/**
 * Content category landing page. The URL carries the locale slug, the category
 * row supplies the immutable `key`, and the listing filters on that key — so a
 * renamed display name changes the title, not the stored content or the URL of
 * other categories.
 */

const PAGE_SIZE = 12

const { t, locale } = useI18n()
const route = useRoute()
const config = useRuntimeConfig()
const requestUrl = useRequestURL()

const slug = computed(() => (typeof route.params.slug === 'string' ? route.params.slug.trim() : ''))
const baseUrl = String(config.public.siteUrl || requestUrl.origin)
const canonical = computed(() => buildCanonicalUrl(baseUrl, `/danh-muc/${encodeURIComponent(slug.value)}`))

const category = ref<PublicContentCategory | null>(null)
const items = ref<PublicContentListItem[]>([])
const cursor = ref<string | null>(null)
const hasMore = ref(false)
const loading = ref(false)
const loadError = ref(false)
const categoryMissing = ref(false)

async function loadCategory() {
  if (!slug.value) {
    categoryMissing.value = true
    return
  }

  try {
    const response = await $fetch<{ success: boolean, data: PublicContentCategory }>(
      `/api/public/content/categories/${encodeURIComponent(slug.value)}`,
      { query: { locale: locale.value } },
    )
    category.value = response.data
    categoryMissing.value = false
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    categoryMissing.value = status === 404
    category.value = null
    if (!categoryMissing.value) loadError.value = true
  }
}

async function load(reset = true) {
  if (loading.value || !category.value) return
  loading.value = true
  loadError.value = false

  try {
    const response = await $fetch<{
      success: boolean
      data: PublicContentListItem[]
      meta: { nextCursor: string | null, hasMore: boolean }
    }>('/api/public/content', {
      query: {
        category: category.value.key,
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

await loadCategory()
if (categoryMissing.value) {
  throw createError({ statusCode: 404, statusMessage: 'error.categoryNotFound', fatal: true })
}
await load()

watch(locale, async () => {
  items.value = []
  cursor.value = null
  hasMore.value = false
  await loadCategory()
  await load()
})

/** The editor's own intro wins over the generated subtitle in both places below. */
const categoryDescription = computed(
  () => category.value?.description || t('categoryContent.subtitle', { name: category.value?.name || '' }),
)

/**
 * An empty category landing still exists for its editor and its parent navigation,
 * but it is thin content: it stays 200 and leaves the index until a published post
 * carries it, the same rule the tag landings follow.
 */
const robots = usePageRobots({ empty: () => !items.value.length })

useSeoMeta({
  title: () => category.value?.name || '',
  description: () => categoryDescription.value,
  ogTitle: () => category.value?.name || '',
  ogDescription: () => categoryDescription.value,
  ogType: 'website',
  ogUrl: () => canonical.value,
  // A content category carries no image of its own, so it shares the site card
  // rather than publishing an og:image a crawler cannot fetch.
  ogImage: () => resolveSiteUrl(baseUrl, '/branding/og-cover.png'),
  ogImageAlt: () => category.value?.name || '',
  twitterImage: () => resolveSiteUrl(baseUrl, '/branding/og-cover.png'),
  twitterImageAlt: () => category.value?.name || '',
  robots,
})

/** Home and the category, matching the two-step breadcrumb in the template. */
const breadcrumbs = computed(() => buildBreadcrumbJsonLd(baseUrl, category.value
  ? [
      { name: t('common.home'), path: '/' },
      { name: category.value.name, path: canonical.value },
    ]
  : []))

/** The posts this category lists, so a crawler sees them without following each card. */
const itemList = computed(() => buildItemListJsonLd(baseUrl, items.value.map(item => ({
  name: item.title,
  path: item.path,
})), { name: category.value?.name || '' }))

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
      <span class="truncate text-default">{{ category?.name }}</span>
    </nav>

    <header class="mb-8">
      <h1 class="text-2xl font-extrabold tracking-tight text-highlighted sm:text-3xl">{{ category?.name }}</h1>
      <p class="mt-1 text-sm text-muted" :title="category?.key">
        {{ categoryDescription }}
      </p>
    </header>

    <WebContentList
      :items="items"
      :loading="loading"
      :error="loadError"
      :has-more="hasMore"
      :empty-text="t('categoryContent.empty', { name: category?.name })"
      @load-more="load(false)"
    />
  </div>
</template>
