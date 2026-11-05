<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    image?: string
  }>(),
  {
    description: '',
    image: '',
  }
)

useSeoMeta({
  title: props.title,
  description: props.description,
  ogTitle: props.title,
  ogDescription: props.description,
  ogImage: props.image,
})
</script>

<template>
  <div class="relative min-h-screen">
    <!-- Ambient mesh background -->
    <div class="udmt-backdrop" />

    <!-- Public Header / Navbar slot -->
    <header class="sticky top-0 z-20 border-b border-default bg-elevated/40 backdrop-blur-xl">
      <div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <slot name="header-brand" />
        <slot name="header-nav" />
        <slot name="header-actions" />
      </div>
    </header>

    <!-- Main Content Area -->
    <main class="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <slot name="hero" />
      <slot />
    </main>

    <!-- Public Footer -->
    <footer class="relative z-10 border-t border-default bg-elevated/30 py-8 backdrop-blur-md">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <slot name="footer" />
      </div>
    </footer>
  </div>
</template>

