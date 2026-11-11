<script setup lang="ts">
import type { PublicContentListItem } from '@tm/flow-contracts/content-public'
import type { CatalogListQuery } from '../composables/useCatalog'
import { buildCanonicalUrl, buildWebSiteJsonLd } from '@tm/flow-utils/seo'

const { t, locale } = useI18n()
const config = useRuntimeConfig()
const requestUrl = useRequestURL()
const { brandName, seo } = usePublicSite()

const baseUrl = String(config.public.siteUrl || requestUrl.origin)
const canonical = buildCanonicalUrl(baseUrl, '/')

const featuredQuery = ref<CatalogListQuery>({ limit: 8, sort: 'newest' })
const { result: featured, items: featuredItems } = useCatalogList(featuredQuery)
const { categories } = useCatalogCategories()
const topCategories = computed(() => categories.value.filter(category => !category.parentId).slice(0, 6))

/**
 * Latest published posts, read through the same public reader as `/bai-viet`: the
 * route only returns published, in-window, allowlisted records. A broken reader
 * hides the section instead of showing an error block on a marketing page.
 */
const { data: latestPosts } = await useAsyncData<PublicContentListItem[]>(
  () => `home:posts:${locale.value}`,
  async () => {
    try {
      const response = await $fetch<{ data: PublicContentListItem[] }>('/api/public/content', {
        query: { type: 'post', locale: locale.value, limit: 3 },
      })
      return response.data
    } catch {
      return []
    }
  },
  { watch: [locale], default: () => [] as PublicContentListItem[] }
)

// The settings document owns the site description; the translated copy is the fallback.
const siteDescription = computed(() => seo.value?.defaultDescription || t('home.seo.description', { company: brandName.value }))

useSeoMeta({
  title: () => brandName.value,
  description: () => siteDescription.value,
  ogTitle: () => brandName.value,
  ogDescription: () => siteDescription.value,
  ogType: 'website',
  ogUrl: canonical,
  ogImage: `${baseUrl}/branding/og-cover.png`,
  twitterCard: 'summary_large_image',
  robots: () => (config.public.indexable === false ? 'noindex, nofollow' : 'index, follow'),
})

/** The site itself, so a search engine can offer this store's own search box. */
const websiteJsonLd = computed(() => buildWebSiteJsonLd(baseUrl, {
  name: brandName.value,
  searchPath: '/tim-kiem',
  language: locale.value === 'en' ? 'en-US' : 'vi-VN',
}))

useHead({
  link: [{ rel: 'canonical', href: canonical }],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: brandName.value,
        url: `${baseUrl}/`,
        logo: `${baseUrl}/branding/logo.svg`,
      }).replace(/</g, '\\u003c'),
    },
    ...(websiteJsonLd.value
      ? [{
          type: 'application/ld+json' as const,
          key: 'ld-website',
          innerHTML: JSON.stringify(websiteJsonLd.value).replace(/</g, '\\u003c'),
        }]
      : []),
  ],
})
</script>

<template>
  <div class="space-y-14 pb-16">
    <section class="relative overflow-hidden pt-12 pb-8 text-center sm:pt-20 sm:pb-12">
      <div class="mx-auto max-w-3xl px-4 sm:px-6">
        <div class="mb-6 inline-flex items-center gap-2 rounded-[4px] border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <UIcon name="i-lucide-sparkles" class="size-3.5" aria-hidden="true" />
          <span>{{ t('home.hero.badge') }}</span>
        </div>

        <h1 class="text-3xl font-extrabold tracking-tight text-highlighted sm:text-5xl">
          {{ t('home.hero.title') }}
          <span class="text-primary">{{ brandName }}</span>
        </h1>

        <p class="mx-auto mt-4 max-w-xl text-sm text-muted sm:text-base">
          {{ t('home.hero.subtitle') }}
        </p>

        <div class="mt-8 flex flex-wrap justify-center gap-3">
          <UButton
            to="/products"
            color="primary"
            variant="soft"
            size="md"
            :label="t('home.hero.cta')"
            icon="i-lucide-arrow-right"
            trailing
          />
          <UButton
            to="/categories"
            color="neutral"
            variant="ghost"
            size="md"
            :label="t('home.hero.secondary')"
          />
        </div>
      </div>
    </section>

    <section class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 class="text-xl font-bold tracking-tight text-highlighted">{{ t('home.featured.title') }}</h2>
          <p class="text-xs text-muted">{{ t('home.featured.subtitle') }}</p>
        </div>
        <NuxtLink to="/products" class="shrink-0 text-xs font-semibold text-primary hover:underline">
          {{ t('home.featured.viewAll') }} →
        </NuxtLink>
      </div>

      <CatalogStateNotice
        v-if="featured.status === 'disconnected' || featured.status === 'unavailable'"
        :status="featured.status"
      />

      <div v-else-if="featuredItems.length" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CatalogProductCard v-for="item in featuredItems" :key="item.id" :item="item" />
      </div>

      <div v-else class="rounded-[6px] border border-dashed border-default/70 bg-elevated/20 px-6 py-12 text-center text-sm text-muted">
        {{ t('catalog.empty.description') }}
      </div>
    </section>

    <section v-if="latestPosts.length" class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 class="text-xl font-bold tracking-tight text-highlighted">{{ t('home.posts.title') }}</h2>
          <p class="text-xs text-muted">{{ t('home.posts.subtitle') }}</p>
        </div>
        <NuxtLink to="/bai-viet" class="shrink-0 text-xs font-semibold text-primary hover:underline">
          {{ t('home.posts.viewAll') }} →
        </NuxtLink>
      </div>

      <WebContentList :items="latestPosts" />
    </section>

    <section v-if="topCategories.length" class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 class="text-xl font-bold tracking-tight text-highlighted">{{ t('home.categories.title') }}</h2>
          <p class="text-xs text-muted">{{ t('home.categories.subtitle') }}</p>
        </div>
        <NuxtLink to="/categories" class="shrink-0 text-xs font-semibold text-primary hover:underline">
          {{ t('home.categories.viewAll') }} →
        </NuxtLink>
      </div>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <NuxtLink
          v-for="category in topCategories"
          :key="category.id"
          :to="category.path"
          class="bento-card flex items-center gap-2 px-3 py-3"
        >
          <UIcon name="i-lucide-layers" class="size-4 shrink-0 text-primary/70" aria-hidden="true" />
          <span class="truncate text-xs font-medium text-highlighted">
            {{ readLocalized(category.name, locale) }}
          </span>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>
