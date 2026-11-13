<script setup lang="ts">
const { t } = useI18n()
const { brandName, seo } = usePublicSite()

/**
 * The storefront owns no about-page copy: the page is the description the
 * customer saved in site settings, and an explicit notice while it is empty.
 * Contact channels live on `/contact` and are not repeated here.
 */
const description = computed(() => seo.value?.defaultDescription || '')

const robots = usePageRobots({ empty: () => !description.value })

const metaDescription = computed(() => description.value || t('about.metaFallback', { company: brandName.value }))

useSeoMeta({
  title: () => t('about.title', { company: brandName.value }),
  description: () => metaDescription.value,
  ogTitle: () => t('about.title', { company: brandName.value }),
  ogDescription: () => metaDescription.value,
  ogType: 'website',
  robots,
})
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
    <header class="mb-8">
      <h1 class="text-2xl font-extrabold tracking-tight text-highlighted sm:text-3xl">
        {{ t('about.title', { company: brandName }) }}
      </h1>
      <p v-if="description" class="mt-2 text-sm leading-relaxed text-muted">
        {{ description }}
      </p>
    </header>

    <WebNotice
      v-if="!description"
      icon="i-lucide-file-question"
      :title="t('about.emptyTitle')"
      :description="t('about.emptyHint')"
    />

    <NuxtLink
      to="/contact"
      class="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
    >
      <UIcon name="i-lucide-mail" class="size-4" aria-hidden="true" />
      {{ t('about.contactLink') }}
    </NuxtLink>
  </div>
</template>
