<script setup lang="ts">
import { contentKeyFromPath } from '@tm/flow-contracts'
import type { PublicContent } from '@tm/flow-contracts/content-public'
import { buildBreadcrumbJsonLd, buildCanonicalUrl, resolveSiteUrl } from '@tm/flow-utils/seo'

const route = useRoute()
const config = useRuntimeConfig()
const { brandName } = usePublicSite()
const { t, locale } = useI18n()
const requestUrl = useRequestURL()

const contentKey = computed(() => contentKeyFromPath(route.params.slug))
if (!contentKey.value) {
  throw createError({ statusCode: 404, statusMessage: 'error.contentNotFound', fatal: true })
}

const contentEndpoint = computed(() => {
  const key = contentKey.value
  if (!key) return ''
  return `/api/public/content/${key.split('/').map(segment => encodeURIComponent(segment)).join('/')}`
})

const { data, error } = await useAsyncData(
  () => `public-content:${contentKey.value ?? 'invalid'}:${locale.value}`,
  async () => {
    const response = await $fetch<{ success: boolean, data: PublicContent }>(contentEndpoint.value, {
      query: { locale: locale.value },
    })
    return response.data
  },
  { watch: [() => route.fullPath, locale] },
)

if (error.value) {
  const statusCode = error.value.statusCode === 404 ? 404 : 503
  throw createError({
    statusCode,
    statusMessage: statusCode === 404 ? 'error.contentNotFound' : 'error.contentUnavailable',
    fatal: true,
  })
}

const content = computed(() => data.value ?? null)
if (!content.value) {
  throw createError({ statusCode: 404, statusMessage: 'error.contentNotFound', fatal: true })
}

watch(error, (value) => {
  if (!value) return
  const statusCode = value.statusCode === 404 ? 404 : 503
  showError({
    statusCode,
    statusMessage: statusCode === 404 ? 'error.contentNotFound' : 'error.contentUnavailable',
  })
})

const baseUrl = String(config.public.siteUrl || requestUrl.origin)
/**
 * The short `/<slug>` form is canonical. The immutable key path still resolves,
 * so a visitor who lands on `/pages/<key>` is pointed at the URL the cards, the
 * sitemap and a share all use.
 */
const canonical = computed(() => {
  const slug = content.value?.slug
  return buildCanonicalUrl(baseUrl, slug ? `/${encodeURIComponent(slug)}` : route.path)
})

const seoTitle = computed(() => content.value?.seo.title || content.value?.title || '')
const seoDescription = computed(() => content.value?.seo.description || content.value?.excerpt || '')
const seoKeywords = computed(() => content.value?.keywords ?? [])
const categoryLabel = computed(() => content.value?.categories[0] || '')

const ogImage = computed(() => resolveSiteUrl(baseUrl, content.value?.seo.image || '/branding/og-cover.png'))

const formattedDate = computed(() => {
  const value = content.value?.publishedAt || content.value?.updatedAt
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale.value === 'en' ? 'en-US' : 'vi-VN', { dateStyle: 'medium' }).format(date)
})

useSeoMeta({
  title: () => seoTitle.value,
  description: () => seoDescription.value,
  ogTitle: () => seoTitle.value,
  ogDescription: () => seoDescription.value,
  ogType: 'article',
  ogUrl: () => canonical.value,
  ogImage: () => ogImage.value,
  articlePublishedTime: () => content.value?.publishedAt || undefined,
  articleModifiedTime: () => content.value?.updatedAt || undefined,
  twitterCard: 'summary_large_image',
  robots: () => (config.public.indexable === false ? 'noindex, nofollow' : 'index, follow'),
})

useHead({
  link: [
    { rel: 'canonical', href: () => canonical.value },
  ],
  // No empty tag when a page has no keywords: the editor owns this list.
  meta: () => (seoKeywords.value.length ? [{ name: 'keywords', content: seoKeywords.value.join(', ') }] : []),
})

useHead(() => {
  const current = content.value
  if (!current) return {}

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': current.type === 'post' ? 'Article' : 'WebPage',
    name: current.title,
    headline: current.type === 'post' ? current.title : undefined,
    description: seoDescription.value || undefined,
    url: canonical.value,
    datePublished: current.publishedAt || undefined,
    dateModified: current.updatedAt || undefined,
    inLanguage: current.locale,
    isPartOf: {
      '@type': 'WebSite',
      name: brandName.value,
      url: `${baseUrl}/`,
    },
  }

  // The template's breadcrumb is home → this page, so that is the whole trail.
  const breadcrumbs = buildBreadcrumbJsonLd(baseUrl, [
    { name: t('common.home'), path: '/' },
    { name: current.title, path: canonical.value },
  ])

  return {
    script: [
      {
        type: 'application/ld+json',
        innerHTML: JSON.stringify(structuredData).replace(/</g, '\\u003c'),
      },
      ...(breadcrumbs
        ? [{
            type: 'application/ld+json' as const,
            key: 'ld-breadcrumb',
            innerHTML: JSON.stringify(breadcrumbs).replace(/</g, '\\u003c'),
          }]
        : []),
    ],
  }
})
</script>

<template>
  <article v-if="content" class="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
    <nav class="mb-6 flex items-center gap-2 text-xs text-muted" aria-label="Breadcrumb">
      <NuxtLink to="/" class="transition-colors hover:text-primary">
        {{ t('common.home') }}
      </NuxtLink>
      <span aria-hidden="true">/</span>
      <span class="truncate text-default">{{ content.title }}</span>
    </nav>

    <header class="mb-8 border-b border-default/50 pb-6">
      <div
        v-if="categoryLabel"
        class="mb-3 inline-flex items-center rounded-[4px] border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary"
      >
        {{ categoryLabel }}
      </div>

      <h1 class="text-3xl font-extrabold tracking-tight text-highlighted sm:text-4xl">
        {{ content.title }}
      </h1>

      <p v-if="content.excerpt" class="mt-3 text-sm text-muted sm:text-base">
        {{ content.excerpt }}
      </p>

      <p v-if="formattedDate" class="mt-3 text-xs text-muted">
        {{ t('content.updatedAt') }}: {{ formattedDate }}
      </p>
    </header>

    <WebContentBody :content="content" />

    <footer v-if="content.tags.length" class="mt-10 flex flex-wrap gap-2 border-t border-default/50 pt-6">
      <NuxtLink
        v-for="tag in content.tags"
        :key="tag"
        :to="`/tag/${encodeURIComponent(tag)}`"
        class="inline-flex items-center rounded-[4px] border border-default/60 bg-elevated/40 px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-primary/50 hover:text-primary"
      >
        {{ tag }}
      </NuxtLink>
    </footer>
  </article>
</template>
