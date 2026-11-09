<script setup lang="ts">
// Neutral Host bootstrap - customer branding and theme tokens are provided by Customer Layer and Base Layer
const { titleTemplate } = useSiteSeoTitle()

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
