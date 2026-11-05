<script setup lang="ts">
import type { CatalogStatus } from '../composables/useCatalog'

const props = defineProps<{
  status: Exclude<CatalogStatus, 'ok' | 'notfound'>
}>()

const { t } = useI18n()

const icon = computed(() => (props.status === 'disconnected' ? 'i-lucide-plug' : 'i-lucide-cloud-off'))

const message = computed(() => (props.status === 'disconnected'
  ? { title: t('catalog.state.disconnected.title'), description: t('catalog.state.disconnected.description') }
  : { title: t('catalog.state.unavailable.title'), description: t('catalog.state.unavailable.description') }))
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 rounded-[6px] border border-dashed border-default/70 bg-elevated/20 px-6 py-16 text-center">
    <div class="flex size-12 items-center justify-center rounded-full bg-accented/40 text-muted">
      <UIcon :name="icon" class="size-6" aria-hidden="true" />
    </div>
    <h2 class="text-base font-semibold text-highlighted">
      {{ message.title }}
    </h2>
    <p class="max-w-md text-sm text-muted">
      {{ message.description }}
    </p>
  </div>
</template>
