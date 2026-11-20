<script setup lang="ts">
import type { OrderLookupOrder } from '@tm/flow-contracts'
import { OrderLookupRequestSchema } from '@tm/flow-contracts'

/**
 * Guest order lookup.
 *
 * The order code alone is not a credential, so the form asks for the phone
 * number on the order too. The server answers the same 404 for a wrong phone
 * as for an unknown code, and this page repeats that one message either way.
 */
const { t, te, locale } = useI18n()

useSeoMeta({
  title: () => t('lookup.title'),
  robots: usePageRobots({ never: true }),
})

const form = reactive({ code: '', phone: '' })
const order = ref<OrderLookupOrder | null>(null)
const submitting = ref(false)
const errors = ref<Record<string, string>>({})
const notFound = ref(false)
const failed = ref(false)

const errorCode = (error: unknown): string => {
  const body = (error as { data?: { data?: { code?: string }; code?: string } } | undefined)?.data
  return body?.data?.code || body?.code || ''
}

const search = async () => {
  if (submitting.value) return

  errors.value = {}
  notFound.value = false
  failed.value = false

  const parsed = OrderLookupRequestSchema.safeParse({ code: form.code, phone: form.phone })
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[issue.path.length - 1] ?? '')
      if (field && !fields[field]) fields[field] = t('lookup.invalidField')
    }
    errors.value = fields
    return
  }

  submitting.value = true
  try {
    const response = await $fetch<{ data: OrderLookupOrder }>('/api/public/order-lookup', {
      method: 'POST',
      body: parsed.data,
    })
    order.value = response.data
  } catch (error) {
    if (errorCode(error) === 'ORDER_NOT_FOUND') {
      notFound.value = true
    } else {
      failed.value = true
    }
  } finally {
    submitting.value = false
  }
}

const reset = () => {
  order.value = null
  notFound.value = false
  failed.value = false
  errors.value = {}
}

const label = (group: string, value: string | null | undefined): string => {
  if (!value) return '—'
  const key = `lookup.${group}.${value}`
  return te(key) ? t(key) : value
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
    <header>
      <h1 class="text-2xl font-extrabold tracking-tight text-highlighted sm:text-3xl">{{ t('lookup.title') }}</h1>
      <p class="mt-1 max-w-2xl text-sm text-muted">{{ t('lookup.subtitle') }}</p>
    </header>

    <section v-if="order" class="mt-8 rounded-[6px] border border-default/60 p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="font-mono text-sm font-semibold text-highlighted">{{ order.code }}</p>
          <p v-if="order.createdAt" class="mt-1 text-xs text-muted">
            {{ t('lookup.placedAt', { date: formatCatalogDate(order.createdAt, locale) }) }}
          </p>
        </div>
        <span class="rounded-full bg-elevated/40 px-3 py-1 text-xs font-medium text-highlighted">
          {{ label('status', order.status) }}
        </span>
      </div>

      <dl class="mt-5 grid gap-2 text-sm sm:grid-cols-2">
        <div class="flex items-baseline justify-between gap-3 border-b border-default/50 pb-2 sm:border-0 sm:pb-0">
          <dt class="text-muted">{{ t('lookup.paymentMethodLabel') }}</dt>
          <dd class="text-default">{{ label('paymentMethod', order.paymentMethod) }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-3 border-b border-default/50 pb-2 sm:border-0 sm:pb-0">
          <dt class="text-muted">{{ t('lookup.paymentStatusLabel') }}</dt>
          <dd class="text-default">{{ label('paymentStatus', order.paymentStatus) }}</dd>
        </div>
      </dl>

      <h2 class="mt-6 text-sm font-semibold text-highlighted">{{ t('lookup.items') }}</h2>
      <ul class="mt-2 space-y-2 text-sm">
        <li v-for="(line, index) in order.items" :key="index" class="flex items-start justify-between gap-3">
          <span class="text-default">
            {{ readLocalized(line.name, locale) || t('cart.unavailableName') }}
            <span class="text-muted">× {{ line.quantity }}</span>
          </span>
          <span class="whitespace-nowrap font-medium text-highlighted">
            {{ formatCatalogPrice(line.lineTotal, order.currency, locale) }}
          </span>
        </li>
      </ul>
      <dl class="mt-4 flex items-baseline justify-between gap-4 border-t border-default/60 pt-3">
        <dt class="text-sm text-muted">{{ t('lookup.total') }}</dt>
        <dd class="text-lg font-bold text-highlighted">{{ formatCatalogPrice(order.totalAmount, order.currency, locale) }}</dd>
      </dl>

      <div class="mt-6 flex flex-wrap gap-2">
        <UButton color="neutral" variant="soft" size="md" :label="t('lookup.newSearch')" @click="reset()" />
        <UButton to="/products" color="primary" variant="ghost" size="md" :label="t('lookup.browse')" />
      </div>
    </section>

    <form v-else class="mt-8 space-y-4 rounded-[6px] border border-default/60 p-5" @submit.prevent="search">
      <div>
        <label for="lookup-code" class="mb-1 block text-xs font-medium text-muted">{{ t('lookup.code') }}</label>
        <UInput
          id="lookup-code"
          v-model="form.code"
          autocapitalize="characters"
          autocomplete="off"
          placeholder="WEB-XXXXXXXX"
          :disabled="submitting"
          class="w-full font-mono"
        />
        <p v-if="errors.code" class="mt-1 text-xs text-error">{{ errors.code }}</p>
      </div>
      <div>
        <label for="lookup-phone" class="mb-1 block text-xs font-medium text-muted">{{ t('lookup.phone') }}</label>
        <UInput
          id="lookup-phone"
          v-model="form.phone"
          type="tel"
          autocomplete="tel"
          :disabled="submitting"
          class="w-full"
        />
        <p v-if="errors.phone" class="mt-1 text-xs text-error">{{ errors.phone }}</p>
      </div>

      <div v-if="notFound" class="rounded-[6px] border border-warning/50 bg-warning/10 px-4 py-3" role="alert">
        <p class="text-sm text-warning">{{ t('lookup.notFound') }}</p>
      </div>
      <div v-if="failed" class="rounded-[6px] border border-error/50 bg-error/10 px-4 py-3" role="alert">
        <p class="text-sm text-error">{{ t('lookup.failed') }}</p>
      </div>

      <UButton
        type="submit"
        color="primary"
        size="md"
        :loading="submitting"
        :label="submitting ? t('lookup.searching') : t('lookup.submit')"
      />
    </form>
  </div>
</template>
