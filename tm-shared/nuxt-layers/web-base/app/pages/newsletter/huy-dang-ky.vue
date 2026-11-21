<script setup lang="ts">
/**
 * Landing page for the unsubscribe link inside the newsletter mail.
 *
 * The token is posted once, on mount; the page then reports opted-out or an
 * unusable link. As on the confirmation page, the token is dropped from the
 * address afterwards so a shared or screenshotted URL cannot carry it.
 */
const { t } = useI18n()
const route = useRoute()

useSeoMeta({
  title: () => t('newsletter.unsubscribeTitle'),
  robots: usePageRobots({ never: true }),
})

const state = ref<'working' | 'unsubscribed' | 'invalid' | 'failed'>('working')

onMounted(async () => {
  const token = typeof route.query.token === 'string' ? route.query.token.trim() : ''
  if (!token) {
    state.value = 'invalid'
    return
  }

  try {
    await $fetch('/api/public/newsletter/unsubscribe', { method: 'POST', body: { token } })
    state.value = 'unsubscribed'
  } catch (error) {
    const code = (error as { data?: { data?: { code?: string }; code?: string } })?.data
    state.value = (code?.data?.code || code?.code) === 'NEWSLETTER_TOKEN_NOT_FOUND' ? 'invalid' : 'failed'
  } finally {
    if (import.meta.client) window.history.replaceState({}, '', route.path)
  }
})
</script>

<template>
  <div class="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
    <UIcon
      :name="state === 'unsubscribed' ? 'i-lucide-mail-minus' : state === 'working' ? 'i-lucide-loader-circle' : 'i-lucide-mail-x'"
      class="mx-auto size-10"
      :class="state === 'unsubscribed' ? 'text-primary' : state === 'working' ? 'animate-spin text-muted' : 'text-warning'"
      aria-hidden="true"
    />
    <h1 class="mt-4 text-xl font-bold tracking-tight text-highlighted">
      {{ t('newsletter.unsubscribeTitle') }}
    </h1>
    <p class="mt-2 text-sm text-muted">
      <template v-if="state === 'working'">{{ t('newsletter.unsubscribing') }}</template>
      <template v-else-if="state === 'unsubscribed'">{{ t('newsletter.unsubscribed') }}</template>
      <template v-else-if="state === 'invalid'">{{ t('newsletter.unsubscribeInvalid') }}</template>
      <template v-else>{{ t('newsletter.unsubscribeFailed') }}</template>
    </p>
    <UButton to="/" color="primary" variant="soft" size="md" class="mt-6" :label="t('newsletter.backHome')" />
  </div>
</template>
