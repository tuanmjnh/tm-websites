<script setup lang="ts">
const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    flush?: boolean
    loading?: boolean
    error?: string | null
    empty?: boolean
    emptyText?: string
    emptyIcon?: string
  }>(),
  {
    flush: false,
    loading: false,
    error: null,
    empty: false,
    emptyText: '',
    emptyIcon: 'i-lucide-inbox',
  }
)

useHead(() => ({
  title: props.title,
}))
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <!-- Header / Navbar section with glass effect -->
    <header class="sticky top-0 z-20 border-b border-default bg-elevated/40 px-4 py-3 backdrop-blur-xl sm:px-6">
      <div class="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
        <div class="min-w-0 flex-1">
          <slot name="header-left">
            <h1 class="truncate text-lg font-semibold tracking-tight text-highlighted sm:text-xl">
              {{ title }}
            </h1>
            <p v-if="description" class="mt-0.5 truncate text-xs text-muted sm:text-sm">
              {{ description }}
            </p>
          </slot>
        </div>

        <!-- Desktop Action Slot -->
        <div v-if="$slots.right" class="hidden shrink-0 items-center gap-2 sm:flex">
          <slot name="right">
            <PageActions />
          </slot>
        </div>
      </div>
      <slot name="toolbar" />
    </header>

    <!-- Main Content Canvas -->
    <main class="flex-1" :class="[
      flush ? 'p-0' : 'p-4 sm:p-6 mx-auto w-full max-w-7xl'
    ]">
      <!-- Loading State -->
      <div v-if="loading" class="flex flex-col gap-4 py-8">
        <div class="h-8 w-48 animate-pulse rounded-sm bg-muted/20" />
        <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div v-for="i in 3" :key="i" class="h-32 animate-pulse rounded-md bg-muted/20" />
        </div>
        <div class="h-64 animate-pulse rounded-md bg-muted/20" />
      </div>

      <!-- Error State -->
      <div v-else-if="error"
        class="panel my-6 flex flex-col items-center justify-center p-8 text-center text-error border-error/30">
        <UIcon name="i-lucide-triangle-alert" class="size-10 text-error mb-2" />
        <h3 class="text-base font-semibold">{{ t('common.error') }}</h3>
        <p class="mt-1 text-sm text-muted">{{ error }}</p>
        <slot name="error-retry" />
      </div>

      <!-- Empty State -->
      <div v-else-if="empty"
        class="panel my-6 flex flex-col items-center justify-center border-dashed p-12 text-center">
        <UIcon :name="emptyIcon" class="mb-3 size-12 text-muted" />
        <p class="text-sm text-muted">{{ emptyText || t('common.noData') }}</p>
        <div v-if="$slots.emptyAction" class="mt-4">
          <slot name="emptyAction" />
        </div>
      </div>

      <!-- Default Body Slot -->
      <slot v-else />
    </main>

    <!-- Mobile Action Dock (Sticky at bottom for handheld devices) -->
    <div v-if="$slots.right || $slots['mobile-actions']"
      class="fixed inset-x-0 bottom-0 z-30 border-t border-default bg-elevated/70 p-3 backdrop-blur-xl sm:hidden">
      <div class="flex items-center justify-end gap-2">
        <slot name="mobile-actions">
          <slot name="right" />
        </slot>
      </div>
    </div>
  </div>
</template>
