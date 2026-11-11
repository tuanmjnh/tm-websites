<script setup lang="ts">
import { buildBreadcrumbJsonLd, buildCanonicalUrl } from '@tm/flow-utils/seo'

/**
 * Content category index. It lists what the storefront may link to and groups the
 * rows by their parent key, so a visitor can reach a landing page without a URL
 * from an article badge. Categories arrive already narrowed to the active locale
 * and to the site's own database; a site without categories renders the empty
 * state rather than a broken page.
 */

const { t, locale } = useI18n()
const config = useRuntimeConfig()
const requestUrl = useRequestURL()

const { categories } = usePublicContentCategories()

const baseUrl = String(config.public.siteUrl || requestUrl.origin)
const canonical = buildCanonicalUrl(baseUrl, '/danh-muc')

const categoryPath = (slug: string) => `/danh-muc/${encodeURIComponent(slug)}`

const grouped = computed(() => {
  const topLevel = categories.value.filter(category => !category.parent)
  return topLevel.map(parent => ({
    ...parent,
    children: categories.value.filter(category => category.parent === parent.key),
  }))
})

/**
 * A child whose parent is not published in this locale would otherwise vanish,
 * so it is promoted to its own group instead of being silently dropped.
 */
const orphans = computed(() => {
  const keys = new Set(categories.value.map(category => category.key))
  return categories.value.filter(category => category.parent && !keys.has(category.parent))
})

useSeoMeta({
  title: () => t('categoryContent.indexTitle'),
  description: () => t('categoryContent.indexSubtitle'),
  ogTitle: () => t('categoryContent.indexTitle'),
  ogDescription: () => t('categoryContent.indexSubtitle'),
  ogType: 'website',
  ogUrl: canonical,
  robots: () => (config.public.indexable === false ? 'noindex, nofollow' : 'index, follow'),
})

/** Home → posts → the category index, as the template draws it. */
const breadcrumbs = buildBreadcrumbJsonLd(baseUrl, [
  { name: t('common.home'), path: '/' },
  { name: t('post.indexTitle'), path: '/bai-viet' },
  { name: t('categoryContent.indexTitle'), path: '/danh-muc' },
])

useHead({
  link: [{ rel: 'canonical', href: canonical }],
  script: breadcrumbs
    ? [{
        type: 'application/ld+json' as const,
        key: 'ld-breadcrumb',
        innerHTML: JSON.stringify(breadcrumbs).replace(/</g, '\\u003c'),
      }]
    : [],
})
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
    <nav class="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted" aria-label="Breadcrumb">
      <NuxtLink to="/" class="transition-colors hover:text-primary">{{ t('common.home') }}</NuxtLink>
      <span aria-hidden="true">/</span>
      <NuxtLink to="/bai-viet" class="transition-colors hover:text-primary">{{ t('post.indexTitle') }}</NuxtLink>
      <span aria-hidden="true">/</span>
      <span class="truncate text-default">{{ t('categoryContent.indexTitle') }}</span>
    </nav>

    <header class="mb-8">
      <h1 class="text-2xl font-extrabold tracking-tight text-highlighted sm:text-3xl">
        {{ t('categoryContent.indexTitle') }}
      </h1>
      <p class="mt-1 text-sm text-muted">{{ t('categoryContent.indexSubtitle') }}</p>
    </header>

    <div v-if="grouped.length || orphans.length" class="space-y-4">
      <section
        v-for="group in grouped"
        :key="group.key"
        class="rounded-[6px] border border-default/60 bg-elevated/20 p-4"
      >
        <NuxtLink
          :to="categoryPath(group.slug)"
          class="flex items-center gap-2 text-base font-semibold text-highlighted transition-colors hover:text-primary"
        >
          <UIcon name="i-lucide-folder" class="size-4 text-primary/70" aria-hidden="true" />
          {{ group.name }}
          <UIcon name="i-lucide-chevron-right" class="size-4 text-dimmed" aria-hidden="true" />
        </NuxtLink>

        <div v-if="group.children.length" class="mt-3 flex flex-wrap gap-2">
          <NuxtLink
            v-for="child in group.children"
            :key="child.key"
            :to="categoryPath(child.slug)"
            class="rounded-[4px] border border-default/60 px-2.5 py-1 text-xs text-default transition-colors hover:border-primary/50 hover:text-primary"
          >
            {{ child.name }}
          </NuxtLink>
        </div>
      </section>

      <section v-if="orphans.length" class="rounded-[6px] border border-default/60 bg-elevated/20 p-4">
        <div class="flex flex-wrap gap-2">
          <NuxtLink
            v-for="category in orphans"
            :key="category.key"
            :to="categoryPath(category.slug)"
            class="rounded-[4px] border border-default/60 px-2.5 py-1 text-xs text-default transition-colors hover:border-primary/50 hover:text-primary"
          >
            {{ category.name }}
          </NuxtLink>
        </div>
      </section>

      <p class="text-xs text-muted">
        <NuxtLink to="/bai-viet" class="transition-colors hover:text-primary">
          {{ t('categoryContent.allPosts') }}
        </NuxtLink>
      </p>
    </div>

    <div v-else class="rounded-[6px] border border-dashed border-default/70 bg-elevated/20 px-6 py-16 text-center">
      <UIcon name="i-lucide-folder" class="mx-auto size-8 text-dimmed" aria-hidden="true" />
      <h2 class="mt-3 text-base font-semibold text-highlighted">{{ t('categoryContent.emptyTitle') }}</h2>
      <p class="mt-1 text-sm text-muted">{{ t('categoryContent.emptyDescription') }}</p>
      <NuxtLink to="/bai-viet" class="mt-4 inline-block text-sm font-medium text-primary hover:underline">
        {{ t('categoryContent.allPosts') }}
      </NuxtLink>
    </div>
  </div>
</template>
