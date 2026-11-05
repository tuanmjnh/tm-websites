<script setup lang="ts">
import type { PublicCatalogItemSummary } from '@tm/flow-contracts'

const props = defineProps<{
  item: PublicCatalogItemSummary
}>()

const { t, locale } = useI18n()
const config = useRuntimeConfig()
const currency = computed(() => String(config.public.currency || props.item.currency || 'VND'))

const name = computed(() => readLocalized(props.item.name, locale.value))
const summary = computed(() => readLocalized(props.item.summary, locale.value))
const primaryCategory = computed(() => {
  const first = props.item.categories[0]
  return first ? readLocalized(first.name, locale.value) : ''
})
const price = computed(() => formatCatalogPrice(props.item.price, currency.value, locale.value))
const compareAtPrice = computed(() =>
  props.item.compareAtPrice && props.item.compareAtPrice > props.item.price
    ? formatCatalogPrice(props.item.compareAtPrice, currency.value, locale.value)
    : ''
)
</script>

<template>
  <NuxtLink
    :to="item.path"
    class="bento-card group flex h-full flex-col justify-between overflow-hidden"
  >
    <div>
      <div class="relative mb-3 flex aspect-square w-full items-center justify-center overflow-hidden rounded-[4px] border border-default/50 bg-elevated/40">
        <NuxtImg
          v-if="item.thumbnail"
          :src="item.thumbnail"
          :alt="name"
          width="400"
          height="400"
          loading="lazy"
          format="webp"
          class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <UIcon v-else name="i-lucide-image-off" class="size-10 text-dimmed" aria-hidden="true" />

        <UBadge
          v-if="!item.inStock"
          color="neutral"
          variant="subtle"
          size="xs"
          class="absolute top-2 left-2 rounded-[4px]"
        >
          {{ t('catalog.outOfStock') }}
        </UBadge>
      </div>

      <p v-if="primaryCategory" class="text-[11px] font-medium uppercase tracking-wide text-primary">
        {{ primaryCategory }}
      </p>

      <h3 class="mt-1 line-clamp-2 text-sm font-semibold text-highlighted transition-colors group-hover:text-primary">
        {{ name }}
      </h3>

      <p v-if="summary" class="mt-1 line-clamp-2 text-xs text-muted">
        {{ summary }}
      </p>
    </div>

    <div class="mt-4 flex items-end justify-between gap-2 border-t border-default/50 pt-3">
      <div class="flex flex-col">
        <span v-if="compareAtPrice" class="text-[11px] text-dimmed line-through">{{ compareAtPrice }}</span>
        <span class="text-sm font-bold text-highlighted">{{ price }}</span>
      </div>
      <span class="inline-flex items-center gap-1 text-xs font-medium text-primary">
        {{ t('common.viewDetails') }}
        <UIcon name="i-lucide-arrow-right" class="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </div>
  </NuxtLink>
</template>
