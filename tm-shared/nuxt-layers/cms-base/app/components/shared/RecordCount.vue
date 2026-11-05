<script setup lang="ts">
const props = withDefaults(defineProps<{
  count?: number
  hasMore?: boolean
}>(), {
  count: 0,
  hasMore: false
})

const { t } = useI18n()
</script>

<template>
  <span class="flex shrink-0 items-center gap-1.5 text-[11px] font-medium whitespace-nowrap text-muted sm:text-xs">
    <strong class="font-semibold text-highlighted">{{ props.hasMore ? `${props.count}+` : props.count }}</strong>
    {{ t('common.records') }}
  </span>
</template>