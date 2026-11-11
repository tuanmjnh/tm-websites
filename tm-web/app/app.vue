<script setup lang="ts">
// Neutral Host bootstrap - customer branding and theme tokens are provided by Customer Layer and Base Layer
import { resolveSiteUrl } from '@tm/flow-utils/seo'

const { titleTemplate } = useSiteSeoTitle()
const config = useRuntimeConfig()
const requestUrl = useRequestURL()
const { brandName } = usePublicSite()

/**
 * Site-wide share card. The customer head config used to publish a relative
 * `og:image`, which a social crawler cannot fetch, so the default is resolved
 * against this site's own origin here; a page with its own media overrides it.
 */
const shareImage = computed(() => resolveSiteUrl(
  String(config.public.siteUrl || requestUrl.origin),
  '/branding/og-cover.png',
))

useSeoMeta({
  ogImage: () => shareImage.value,
  ogImageAlt: () => brandName.value,
  twitterImage: () => shareImage.value,
  twitterImageAlt: () => brandName.value,
  twitterCard: 'summary_large_image',
})

// Pages own their title; the template saved in settings decides how it reads.
// Applied here so it covers every page and layout without per-page edits.
useHead(() => ({
  titleTemplate: (title?: string) => titleTemplate(title),
}))
</script>

<template>
  <UApp>
    <div class="udmt-backdrop" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
