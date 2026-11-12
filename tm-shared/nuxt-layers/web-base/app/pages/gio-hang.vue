<script setup lang="ts">
import type { PublicCartIssue } from '@tm/flow-contracts'

const { t, locale } = useI18n()

const {
  quoted,
  lines,
  pending,
  hydrated,
  subtotal,
  currency,
  hydrate,
  quote,
  setQuantity,
  remove,
  clear,
  cartLineKey,
} = useCart()

useSeoMeta({
  title: () => t('cart.title'),
  // A cart is per visitor and has no canonical content.
  robots: usePageRobots({ never: true }),
})

onMounted(async () => {
  hydrate()
  await quote()
})

const rows = computed(() => quoted.value?.lines ?? [])
const isEmpty = computed(() => hydrated.value && !lines.value.length)
const loading = computed(() => !hydrated.value || (pending.value && !rows.value.length))

const rowIssue = (issues: PublicCartIssue[]) => issues.map(code => t(`cart.issue.${code}`))

const changeQuantity = (key: string, value: unknown) => {
  setQuantity(key, Number(value))
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight text-highlighted sm:text-3xl">{{ t('cart.title') }}</h1>
        <p v-if="!isEmpty" class="mt-1 text-sm text-muted">{{ t('cart.itemsCount', { count: lines.length }) }}</p>
      </div>
      <UButton
        v-if="rows.length"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-trash-2"
        :label="t('cart.clear')"
        @click="clear()"
      />
    </header>

    <div v-if="loading" class="mt-8 space-y-3">
      <div class="h-24 animate-pulse rounded-[6px] border border-default/50 bg-elevated/20" />
      <div class="h-24 animate-pulse rounded-[6px] border border-default/50 bg-elevated/20" />
    </div>

    <section v-else-if="isEmpty" class="mt-10 rounded-[6px] border border-default/60 bg-elevated/20 px-6 py-12 text-center">
      <UIcon name="i-lucide-shopping-cart" class="mx-auto size-10 text-dimmed" aria-hidden="true" />
      <h2 class="mt-4 text-base font-semibold text-highlighted">{{ t('cart.empty') }}</h2>
      <p class="mx-auto mt-2 max-w-md text-sm text-muted">{{ t('cart.emptyHint') }}</p>
      <UButton to="/products" color="primary" size="md" class="mt-5" :label="t('cart.browse')" />
    </section>

    <template v-else>
      <div class="mt-8 overflow-hidden rounded-[6px] border border-default/60">
        <table class="w-full text-left text-sm">
          <thead class="bg-elevated/30 text-xs text-muted">
            <tr>
              <th class="px-3 py-2 font-medium">{{ t('cart.product') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('cart.unitPrice') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('cart.quantity') }}</th>
              <th class="px-3 py-2 text-right font-medium">{{ t('cart.lineTotal') }}</th>
              <th class="px-3 py-2"><span class="sr-only">{{ t('cart.remove') }}</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default/50">
            <tr v-for="row in rows" :key="cartLineKey(row)" :class="row.available ? '' : 'bg-elevated/10'">
              <td class="px-3 py-3 align-top">
                <NuxtLink
                  v-if="row.path"
                  :to="row.path"
                  class="font-medium text-highlighted transition-colors hover:text-primary"
                >
                  {{ readLocalized(row.name, locale) || t('cart.unavailableName') }}
                </NuxtLink>
                <span v-else class="font-medium text-muted">{{ t('cart.unavailableName') }}</span>
                <p v-if="row.variantSku" class="mt-0.5 text-xs text-muted">{{ row.variantSku }}</p>
                <p v-for="message in rowIssue(row.issues)" :key="message" class="mt-1 text-xs text-warning">
                  {{ message }}
                </p>
              </td>
              <td class="px-3 py-3 align-top text-default">
                {{ row.unitPrice > 0 ? formatCatalogPrice(row.unitPrice, currency, locale) : '—' }}
              </td>
              <td class="px-3 py-3 align-top">
                <UInput
                  :model-value="row.quantity"
                  type="number"
                  min="1"
                  max="99"
                  class="w-20"
                  :aria-label="t('cart.quantity')"
                  @update:model-value="changeQuantity(cartLineKey(row), $event)"
                />
              </td>
              <td class="px-3 py-3 align-top text-right font-semibold text-highlighted">
                {{ row.available ? formatCatalogPrice(row.lineTotal, currency, locale) : '—' }}
              </td>
              <td class="px-3 py-3 align-top text-right">
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-x"
                  :aria-label="t('cart.remove')"
                  @click="remove(cartLineKey(row))"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-6 flex flex-col items-end gap-3">
        <dl class="flex w-full max-w-xs items-baseline justify-between gap-4 border-t border-default/60 pt-3">
          <dt class="text-sm text-muted">{{ t('cart.subtotal') }}</dt>
          <dd class="text-lg font-bold text-highlighted">{{ formatCatalogPrice(subtotal, currency, locale) }}</dd>
        </dl>
        <p class="max-w-sm text-right text-xs text-muted">{{ t('cart.checkoutSoon') }}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <UButton to="/products" color="neutral" variant="soft" size="md" :label="t('cart.continueShopping')" />
          <UButton to="/tim-kiem" color="primary" variant="ghost" size="md" :label="t('nav.search')" />
        </div>
      </div>
    </template>
  </div>
</template>
