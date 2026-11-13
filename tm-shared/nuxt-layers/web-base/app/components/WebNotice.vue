<script setup lang="ts">
/**
 * A page-level notice for a site that has not published this content yet.
 *
 * It says what is missing instead of drawing an empty box, and it never invents
 * a phone number, an address or a description on the customer's behalf.
 */
defineProps<{
  icon: string
  title: string
  description: string
}>()
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 rounded-[6px] border border-dashed border-default/70 bg-elevated/20 px-6 py-16 text-center">
    <div class="flex size-12 items-center justify-center rounded-full bg-accented/40 text-muted">
      <UIcon :name="icon" class="size-6" aria-hidden="true" />
    </div>
    <h2 class="text-base font-semibold text-highlighted">
      {{ title }}
    </h2>
    <p class="max-w-md text-sm text-muted">
      {{ description }}
    </p>
  </div>
</template>
