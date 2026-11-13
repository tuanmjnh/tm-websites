<script setup lang="ts">
import type { PublicContentListItem } from '@tm/flow-contracts/content-public'

/**
 * Card grid shared by every public content listing (`/bai-viet`, tag and
 * category landing pages). It renders only the fields the public DTO carries, so
 * a listing page cannot accidentally print status or schedule internals.
 */

const props = withDefaults(defineProps<{
  items: PublicContentListItem[]
  loading?: boolean
  error?: boolean
  hasMore?: boolean
  emptyText?: string
  unavailableText?: string
  loadMoreLabel?: string
}>(), {
  loading: false,
  error: false,
  hasMore: false,
  emptyText: '',
  unavailableText: '',
  loadMoreLabel: '',
})

const emit = defineEmits<{ loadMore: [] }>()

const { t, locale } = useI18n()

const emptyMessage = computed(() => props.emptyText || t('post.empty'))
const unavailableMessage = computed(() => props.unavailableText || t('post.unavailable'))
const moreLabel = computed(() => props.loadMoreLabel || t('post.loadMore'))

const tagPath = (tag: string) => `/tag/${encodeURIComponent(tag)}`
</script>

<template>
  <div>
    <p v-if="error" class="rounded-sm border border-error/40 bg-error/10 p-4 text-sm text-error">
      {{ unavailableMessage }}
    </p>

    <div v-else-if="items.length" class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <article
        v-for="item in items"
        :key="item.key"
        class="flex flex-col overflow-hidden rounded-[4px] border border-default/60 bg-elevated/20"
      >
        <!-- Duplicate of the title link below: kept for the mouse, hidden from AT and the tab order. -->
        <NuxtLink :to="item.path" class="block" aria-hidden="true" tabindex="-1">
          <img
            v-if="item.image"
            :src="item.image"
            :alt="item.title"
            class="aspect-[16/9] w-full object-cover"
            loading="lazy"
          >
          <div v-else class="aspect-[16/9] w-full bg-elevated/60" aria-hidden="true" />
        </NuxtLink>

        <div class="flex flex-1 flex-col gap-2 p-4">
          <div class="flex flex-wrap gap-1.5">
            <NuxtLink
              v-for="itemTag in item.tags"
              :key="`${item.key}-${itemTag}`"
              :to="tagPath(itemTag)"
              class="inline-flex items-center rounded-[4px] border border-default/60 bg-elevated/40 px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-primary/50 hover:text-primary"
            >
              #{{ itemTag }}
            </NuxtLink>
          </div>
          <h2 class="text-base font-semibold text-highlighted">
            <NuxtLink :to="item.path" class="hover:text-primary">{{ item.title }}</NuxtLink>
          </h2>
          <p v-if="item.excerpt" class="text-sm text-muted">{{ item.excerpt }}</p>
          <div class="mt-auto flex items-center justify-between pt-2 text-xs text-muted">
            <span v-if="item.publishedAt">{{ new Date(item.publishedAt).toLocaleDateString(locale) }}</span>
            <NuxtLink :to="item.path" class="font-medium text-primary hover:underline">{{ t('post.readMore') }}</NuxtLink>
          </div>
        </div>
      </article>
    </div>

    <p v-else-if="!loading" class="rounded-sm border border-default/60 p-6 text-sm text-muted">
      {{ emptyMessage }}
    </p>

    <div v-if="hasMore" class="mt-8 flex justify-center">
      <UButton
        color="neutral"
        variant="soft"
        size="sm"
        :loading="loading"
        :label="moreLabel"
        @click="emit('loadMore')"
      />
    </div>
  </div>
</template>
