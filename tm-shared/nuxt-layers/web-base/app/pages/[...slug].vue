<script setup lang="ts">
import { contentKeyFromPath, type HubPublicContent } from '@tm/flow-contracts'
import { buildCanonicalUrl, resolveSiteUrl } from '@tm/flow-utils/seo'

const route = useRoute()
const config = useRuntimeConfig()
const { customer } = useCustomerConfig()
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
  () => `public-content:${contentKey.value ?? 'invalid'}`,
  async () => {
    const response = await $fetch<{ success: boolean, data: HubPublicContent }>(contentEndpoint.value)
    return response.data
  },
  { watch: [() => route.fullPath] },
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
const canonical = computed(() => buildCanonicalUrl(baseUrl, route.path))

const metadataImage = computed(() => {
  const image = content.value?.metadata?.image
  return typeof image === 'string' ? image : ''
})

const ogImage = computed(() => resolveSiteUrl(baseUrl, metadataImage.value || '/branding/og-cover.png'))

const formattedDate = computed(() => {
  const value = content.value?.updatedAt
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale.value === 'en' ? 'en-US' : 'vi-VN', { dateStyle: 'medium' }).format(date)
})

useSeoMeta({
  title: () => content.value?.title || '',
  description: () => content.value?.description || '',
  ogTitle: () => content.value?.title || '',
  ogDescription: () => content.value?.description || '',
  ogType: 'article',
  ogUrl: () => canonical.value,
  ogImage: () => ogImage.value,
  twitterCard: 'summary_large_image',
  robots: () => (config.public.indexable === false ? 'noindex, nofollow' : 'index, follow'),
})

useHead({
  link: [
    { rel: 'canonical', href: () => canonical.value },
  ],
})

useHead(() => {
  const current = content.value
  if (!current) return {}

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: current.title,
    description: current.description || undefined,
    url: canonical.value,
    dateModified: current.updatedAt || undefined,
    inLanguage: locale.value,
    isPartOf: {
      '@type': 'WebSite',
      name: customer.value?.companyName || '',
      url: `${baseUrl}/`,
    },
  }

  return {
    script: [
      {
        type: 'application/ld+json',
        innerHTML: JSON.stringify(structuredData).replace(/</g, '\\u003c'),
      },
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
        v-if="content.category"
        class="mb-3 inline-flex items-center rounded-[4px] border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary"
      >
        {{ content.category }}
      </div>

      <h1 class="text-3xl font-extrabold tracking-tight text-highlighted sm:text-4xl">
        {{ content.title }}
      </h1>

      <p v-if="content.description" class="mt-3 text-sm text-muted sm:text-base">
        {{ content.description }}
      </p>

      <p v-if="formattedDate" class="mt-3 text-xs text-muted">
        {{ t('content.updatedAt') }}: {{ formattedDate }}
      </p>
    </header>

    <WebContentBody :content="content" />
  </article>
</template>
