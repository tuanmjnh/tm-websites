<script setup lang="ts">
const { t } = useI18n()

const props = withDefaults(defineProps<{
  count?: number
  hasMore?: boolean
  loading?: boolean
  showNoMore?: boolean
}>(), {
  count: 0,
  hasMore: false,
  loading: false,
  showNoMore: false
})
</script>

<template>
  <div class="flex min-h-8 w-full items-center justify-between gap-3">
    <div class="flex min-w-0 items-center gap-2">
      <slot name="left" />
    </div>

    <div class="flex shrink-0 items-center gap-3">
      <slot name="right" />

      <div class="flex items-center gap-2 text-[11px] font-medium text-muted sm:text-xs">
        <SharedRecordCount :count="props.count" :has-more="props.hasMore" />

        <div v-if="props.loading" class="flex items-center gap-1.5 text-primary">
          <UIcon name="i-lucide-loader-2" class="size-3.5 animate-spin" />
          <span class="hidden sm:inline text-xs">{{ t('common.loading_text') }}</span>
        </div>

        <div v-else-if="props.showNoMore && !props.hasMore && props.count > 0"
          class="hidden items-center gap-1.5 text-dimmed italic sm:flex">
          <UIcon name="i-lucide-check-circle-2" class="size-3.5" />
          {{ t('common.no_more_data') }}
        </div>
      </div>
    </div>
  </div>
</template>