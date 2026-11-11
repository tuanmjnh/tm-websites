<script setup lang="ts">
import { buildCanonicalUrl, buildItemListJsonLd } from '@tm/flow-utils/seo'

const { t, locale } = useI18n()
const config = useRuntimeConfig()
const requestUrl = useRequestURL()

const { result, categories } = useCatalogCategories()

const baseUrl = String(config.public.siteUrl || requestUrl.origin)
const canonical = buildCanonicalUrl(baseUrl, '/categories')

const grouped = computed(() => {
  const topLevel = categories.value.filter(category => !category.parentId)
  return topLevel.map(parent => ({
    ...parent,
    children: categories.value.filter(category => category.parentId === parent.id),
  }))
})

useSeoMeta({
  title: () => t('category.indexTitle'),
  description: () => t('category.indexSubtitle'),
  ogTitle: () => t('category.indexTitle'),
  ogDescription: () => t('category.indexSubtitle'),
  ogType: 'website',
  ogUrl: canonical,
  robots: () => (config.public.indexable === false ? 'noindex, nofollow' : 'index, follow'),
})

/** The tree the page shows, flattened with each parent followed by its children. */
const itemList = computed(() => buildItemListJsonLd(baseUrl, grouped.value.flatMap(group => [
  { name: readLocalized(group.name, locale.value), path: group.path },
  ...group.children.map(child => ({ name: readLocalized(child.name, locale.value), path: child.path })),
]), { name: t('category.indexTitle') }))

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
  <div class="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
    <header class="mb-6">
      <h1 class="text-2xl font-extrabold tracking-tight text-highlighted sm:text-3xl">
        {{ t('category.indexTitle') }}
      </h1>
      <p class="mt-1 text-sm text-muted">{{ t('category.indexSubtitle') }}</p>
    </header>

    <CatalogStateNotice
      v-if="result.status === 'disconnected' || result.status === 'unavailable'"
      :status="result.status"
    />

    <div v-else-if="grouped.length" class="space-y-6">
      <section
        v-for="group in grouped"
        :key="group.id"
        class="rounded-[6px] border border-default/60 bg-elevated/20 p-4"
      >
        <div class="flex items-center justify-between gap-3">
          <NuxtLink :to="group.path" class="flex items-center gap-2 text-base font-semibold text-highlighted transition-colors hover:text-primary">
            <UIcon name="i-lucide-layers" class="size-4 text-primary/70" aria-hidden="true" />
            {{ readLocalized(group.name, locale) }}
          </NuxtLink>
          <UIcon name="i-lucide-chevron-right" class="size-4 text-dimmed" aria-hidden="true" />
        </div>

        <p v-if="group.description" class="mt-2 line-clamp-2 text-xs text-muted">
          {{ readLocalized(group.description, locale) }}
        </p>

        <div v-if="group.children.length" class="mt-3 flex flex-wrap gap-2">
          <NuxtLink
            v-for="child in group.children"
            :key="child.id"
            :to="child.path"
            class="rounded-[4px] border border-default/60 px-2.5 py-1 text-xs text-default transition-colors hover:border-primary/50 hover:text-primary"
          >
            {{ readLocalized(child.name, locale) }}
          </NuxtLink>
        </div>
      </section>
    </div>

    <div v-else class="rounded-[6px] border border-dashed border-default/70 bg-elevated/20 px-6 py-16 text-center">
      <UIcon name="i-lucide-layers" class="mx-auto size-8 text-dimmed" aria-hidden="true" />
      <h2 class="mt-3 text-base font-semibold text-highlighted">{{ t('category.emptyTitle') }}</h2>
      <p class="mt-1 text-sm text-muted">{{ t('category.emptyDescription') }}</p>
    </div>
  </div>
</template>
