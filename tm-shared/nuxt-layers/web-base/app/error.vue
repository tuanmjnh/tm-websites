<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{
  error: NuxtError
}>()

const { t } = useI18n()
const { customer } = useCustomerConfig()

const statusCode = computed(() => props.error?.statusCode ?? 500)
const isNotFound = computed(() => statusCode.value === 404)

const title = computed(() => (isNotFound.value ? t('error.notFoundTitle') : t('error.serverTitle')))
const description = computed(() => (isNotFound.value ? t('error.notFoundDescription') : t('error.serverDescription')))

const goHome = () => clearError({ redirect: '/' })
</script>

<template>
  <div class="relative flex min-h-screen items-center justify-center px-4 py-16">
    <div class="udmt-backdrop" />

    <main class="relative z-10 w-full max-w-lg text-center">
      <div class="mb-6 inline-flex items-center gap-2 rounded-[4px] border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
        <UIcon :name="isNotFound ? 'i-lucide-compass' : 'i-lucide-triangle-alert'" class="size-3.5" />
        <span>{{ customer?.companyName || 'TM Web' }}</span>
      </div>

      <p class="text-6xl font-extrabold tracking-tight text-primary">{{ statusCode }}</p>

      <h1 class="mt-4 text-2xl font-bold tracking-tight text-highlighted">
        {{ title }}
      </h1>

      <p class="mx-auto mt-3 max-w-md text-sm text-muted">
        {{ description }}
      </p>

      <div class="mt-8 flex justify-center gap-3">
        <UButton
          color="primary"
          variant="soft"
          size="md"
          icon="i-lucide-arrow-left"
          :label="t('error.backHome')"
          @click="goHome"
        />
      </div>
    </main>
  </div>
</template>
