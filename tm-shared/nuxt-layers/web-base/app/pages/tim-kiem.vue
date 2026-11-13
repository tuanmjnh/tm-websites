<script setup lang="ts">
import type { PublicContentListItem } from '@tm/flow-contracts/content-public'
import { PUBLIC_CONTENT_SEARCH_MAX } from '@tm/flow-contracts/content-public'
import { buildCanonicalUrl } from '@tm/flow-utils/seo'

/**
 * Public search across content and products.
 *
 * One bounded query (`q`, ≤80) feeds two existing read paths — the content
 * listing and the catalog listing — instead of a new join, so each keeps its own
 * publish policy and neither can leak a draft. Search result pages are `noindex`:
 * they are useful to the visitor who typed the query, but they are not a stable
 * URL a crawler should index.
 */

const SECTION_LIMIT = 8

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const config = useRuntimeConfig()
const requestUrl = useRequestURL()

const baseUrl = String(config.public.siteUrl || requestUrl.origin)
const canonical = buildCanonicalUrl(baseUrl, '/tim-kiem')

const readQuery = (key: string) => {
  const raw = route.query[key]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value.trim() : ''
}

const q = computed(() => readQuery('q').slice(0, PUBLIC_CONTENT_SEARCH_MAX))
const search = ref(q.value)
watch(q, value => { search.value = value })

const { data: contentResult, error: contentError, pending: contentPending } = await useAsyncData(
  () => `search:content:${q.value}:${locale.value}`,
  async () => {
    if (!q.value) return [] as PublicContentListItem[]
    const response = await $fetch<{ success: boolean, data: PublicContentListItem[] }>('/api/public/content', {
      query: { q: q.value, locale: locale.value, limit: SECTION_LIMIT },
    })
    return response.data
  },
  { watch: [q, locale] },
)

const catalogQuery = computed(() => ({ search: q.value, page: 1, limit: SECTION_LIMIT, sort: 'newest' }))
const { items: products, total: productTotal, result: productResult, pending: productPending } = useCatalogList(catalogQuery)

const contentItems = computed(() => contentResult.value ?? [])
const noResults = computed(() =>
  q.value
  && !contentPending.value
  && !productPending.value
  && !contentItems.value.length
  && !products.value.length,
)

function submitSearch() {
  const term = search.value.trim().slice(0, PUBLIC_CONTENT_SEARCH_MAX)
  router.push({ query: term ? { q: term } : {} })
}

useSeoMeta({
  title: () => (q.value ? t('search.title', { q: q.value }) : t('search.indexTitle')),
  description: () => t('search.subtitle'),
  ogTitle: () => (q.value ? t('search.title', { q: q.value }) : t('search.indexTitle')),
  ogDescription: () => t('search.subtitle'),
  ogType: 'website',
  ogUrl: canonical,
  robots: usePageRobots({ never: true }),
})

useHead({
  link: [{ rel: 'canonical', href: canonical }],
})
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
    <header class="mb-8">
      <h1 class="text-2xl font-extrabold tracking-tight text-highlighted sm:text-3xl">
        {{ q ? t('search.title', { q }) : t('search.indexTitle') }}
      </h1>
      <p class="mt-1 text-sm text-muted">{{ t('search.subtitle') }}</p>

      <form class="mt-4 flex max-w-md items-center gap-2" role="search" @submit.prevent="submitSearch">
        <UInput
          v-model="search"
          name="q"
          :maxlength="PUBLIC_CONTENT_SEARCH_MAX"
          :placeholder="t('search.placeholder')"
          icon="i-lucide-search"
          class="flex-1"
          :aria-label="t('search.placeholder')"
        />
        <UButton type="submit" color="primary" variant="soft" size="sm" :label="t('search.action')" />
      </form>
    </header>

    <p v-if="!q" class="rounded-sm border border-dashed border-default/70 bg-elevated/20 px-6 py-12 text-center text-sm text-muted">
      {{ t('search.hint') }}
    </p>

    <p v-else-if="noResults" class="rounded-sm border border-default/60 p-6 text-sm text-muted">
      {{ t('search.empty', { q }) }}
    </p>

    <template v-else>
      <p v-if="contentError" class="mb-6 rounded-sm border border-error/40 bg-error/10 p-4 text-sm text-error">
        {{ t('post.unavailable') }}
      </p>

      <section v-if="contentItems.length" class="mb-10">
        <div class="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="text-lg font-semibold text-highlighted">
            {{ t('search.contentSection') }}
            <span class="ml-1 text-xs font-normal text-muted">{{ contentItems.length }}</span>
          </h2>
          <NuxtLink :to="{ path: '/bai-viet', query: { q } }" class="text-xs font-medium text-primary hover:underline">
            {{ t('search.viewAllContent') }}
          </NuxtLink>
        </div>

        <ul class="flex flex-col gap-3">
          <li
            v-for="item in contentItems"
            :key="item.key"
            class="rounded-[4px] border border-default/60 bg-elevated/20 p-4"
          >
            <NuxtLink :to="item.path" class="text-base font-semibold text-highlighted hover:text-primary">
              <WebSearchHighlight :text="item.title" :term="q" />
            </NuxtLink>
            <p v-if="item.excerpt" class="mt-1 text-sm text-muted">
              <WebSearchHighlight :text="item.excerpt" :term="q" />
            </p>
            <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <span>{{ t(`contentType.${item.type}`) }}</span>
              <NuxtLink
                v-for="itemTag in item.tags"
                :key="`${item.key}-${itemTag}`"
                :to="`/tag/${encodeURIComponent(itemTag)}`"
                class="transition-colors hover:text-primary"
              >
                #{{ itemTag }}
              </NuxtLink>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="products.length">
        <div class="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="text-lg font-semibold text-highlighted">
            {{ t('search.productSection') }}
            <span class="ml-1 text-xs font-normal text-muted">{{ productTotal }}</span>
          </h2>
          <NuxtLink :to="{ path: '/products', query: { q } }" class="text-xs font-medium text-primary hover:underline">
            {{ t('search.viewAllProducts') }}
          </NuxtLink>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CatalogProductCard v-for="product in products" :key="product.id" :item="product" :term="q" />
        </div>
      </section>

      <p
        v-if="productResult.status === 'disconnected' || productResult.status === 'unavailable'"
        class="mt-6 rounded-sm border border-default/60 p-4 text-xs text-muted"
      >
        {{ t('search.productsUnavailable') }}
      </p>
    </template>
  </div>
</template>
