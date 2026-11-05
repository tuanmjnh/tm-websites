<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
    description?: string
    icon?: string
    colSpan?: 1 | 2 | 3 | 4
  }>(),
  {
    colSpan: 1,
  }
)
</script>

<template>
  <div class="bento-card group flex flex-col justify-between" :class="[
    colSpan === 2 ? 'bento-col-span-2' : '',
    colSpan === 3 ? 'bento-col-span-3' : '',
    colSpan === 4 ? 'col-span-full' : '',
  ]">
    <div v-if="title || icon || $slots.header" class="mb-3 flex items-start justify-between gap-2">
      <div class="min-w-0">
        <slot name="header">
          <h3 v-if="title" class="truncate text-sm font-medium text-highlighted">
            {{ title }}
          </h3>
          <p v-if="description" class="mt-0.5 truncate text-xs text-muted">
            {{ description }}
          </p>
        </slot>
      </div>

      <div v-if="icon || $slots.icon"
        class="flex size-7 shrink-0 items-center justify-center rounded-sm border border-default bg-elevated/50 text-muted group-hover:text-primary">
        <slot name="icon">
          <UIcon v-if="icon" :name="icon" class="size-4" />
        </slot>
      </div>
    </div>

    <div class="flex-1">
      <slot />
    </div>

    <div v-if="$slots.footer" class="mt-3 border-t border-default/50 pt-2 text-xs text-muted">
      <slot name="footer" />
    </div>
  </div>
</template>
