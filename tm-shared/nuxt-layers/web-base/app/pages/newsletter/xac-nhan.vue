<script setup lang="ts">
/**
 * Landing page for the confirmation link inside the newsletter mail.
 *
 * The token from the URL is posted once, on mount; the page then reports
 * confirmed, already-used/expired or a retryable failure. The token is not
 * shown and is dropped from the address afterwards so a screenshot or a shared
 * URL cannot carry it.
 */
const { t } = useI18n()
const route = useRoute()

useSeoMeta({
  title: () => t('newsletter.confirmTitle'),
  robots: usePageRobots({ never: true }),
})

const state = ref<'confirming' | 'confirmed' | 'invalid' | 'failed'>('confirming')

onMounted(async () => {
  const token = typeof route.query.token === 'string' ? route.query.token.trim() : ''
  if (!token) {
    state.value = 'invalid'
    return
  }

  try {
    await $fetch('/api/public/newsletter/confirm', { method: 'POST', body: { token } })
    state.value = 'confirmed'
  } catch (error) {
    const code = (error as { data?: { data?: { code?: string }; code?: string } })?.data
    const reason = code?.data?.code || code?.code
    // A truncated or malformed link is unusable, not retryable: offering "try
    // again later" for a bad URL only sends the reader round in circles.
    state.value = reason === 'NEWSLETTER_TOKEN_NOT_FOUND' || reason === 'NEWSLETTER_TOKEN_INVALID'
      ? 'invalid'
      : 'failed'
  } finally {
    if (import.meta.client) window.history.replaceState({}, '', route.path)
  }
})
</script>

<template>
  <div class="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
    <UIcon
      :name="state === 'confirmed' ? 'i-lucide-mail-check' : state === 'confirming' ? 'i-lucide-loader-circle' : 'i-lucide-mail-x'"
      class="mx-auto size-10"
      :class="state === 'confirmed' ? 'text-primary' : state === 'confirming' ? 'animate-spin text-muted' : 'text-warning'"
      aria-hidden="true"
    />
    <h1 class="mt-4 text-xl font-bold tracking-tight text-highlighted">
      {{ t('newsletter.confirmTitle') }}
    </h1>
    <p class="mt-2 text-sm text-muted">
      <template v-if="state === 'confirming'">{{ t('newsletter.confirming') }}</template>
      <template v-else-if="state === 'confirmed'">{{ t('newsletter.confirmed') }}</template>
      <template v-else-if="state === 'invalid'">{{ t('newsletter.confirmInvalid') }}</template>
      <template v-else>{{ t('newsletter.confirmFailed') }}</template>
    </p>
    <UButton to="/" color="primary" variant="soft" size="md" class="mt-6" :label="t('newsletter.backHome')" />
  </div>
</template>
