<script setup lang="ts">
import type {
  PublicCheckoutBlockedLine,
  PublicCheckoutOrder,
  PublicCheckoutPaymentMethod,
  PublicCheckoutRequest,
} from '@tm/flow-contracts'
import {
  PUBLIC_CHECKOUT_IDEMPOTENCY_HEADER,
  PUBLIC_CHECKOUT_PAYMENT_METHODS,
  PublicCheckoutRequestSchema,
} from '@tm/flow-contracts'

/**
 * Guest checkout page.
 *
 * The browser sends quantities and delivery details only; the server re-quotes
 * the cart and writes the order. The `Idempotency-Key` is generated per cart
 * contents and kept for the submit, so a reload followed by a second click (or
 * a retry after a timeout) resolves to the order that already exists instead of
 * a duplicate.
 */
const { t, locale } = useI18n()
const config = useRuntimeConfig()

const {
  quoted,
  lines,
  pending,
  hydrated,
  subtotal,
  currency,
  hydrate,
  quote,
  clear,
  cartLineKey,
} = useCart()

useSeoMeta({
  title: () => t('checkout.title'),
  robots: usePageRobots({ never: true }),
})

onMounted(async () => {
  hydrate()
  await quote()
})

const form = reactive({
  fullName: '',
  phone: '',
  email: '',
  street: '',
  ward: '',
  district: '',
  city: '',
  country: 'Việt Nam',
  note: '',
  paymentMethod: 'cod' as PublicCheckoutPaymentMethod,
})

const paymentOptions = computed(() =>
  PUBLIC_CHECKOUT_PAYMENT_METHODS.map(value => ({
    value,
    label: value === 'cod' ? t('checkout.paymentCod') : t('checkout.paymentBanking'),
    hint: value === 'cod' ? t('checkout.paymentCodHint') : t('checkout.paymentBankingHint'),
  })),
)

const submitting = ref(false)
const order = ref<PublicCheckoutOrder | null>(null)
const mailQueued = ref(false)
const fieldErrors = ref<Record<string, string>>({})
const cartChanged = ref<PublicCheckoutBlockedLine[]>([])
const failed = ref(false)

const rows = computed(() => quoted.value?.lines ?? [])
const hasBlockedLine = computed(() => rows.value.some(row => !row.available))
const isEmpty = computed(() => hydrated.value && !lines.value.length)
const loading = computed(() => !hydrated.value || (pending.value && !rows.value.length))
const canSubmit = computed(() => Boolean(quoted.value) && !submitting.value && !hasBlockedLine.value && !isEmpty.value)

const KEY_STORAGE_PREFIX = 'tm-checkout-key:v1:'
const keyStorage = `${KEY_STORAGE_PREFIX}${String(config.public.siteUrl || 'default')}`

/** Cart contents the pending order is for; a change means a new attempt. */
const cartSignature = computed(() =>
  lines.value
    .map(line => `${cartLineKey(line)}:${line.quantity}`)
    .sort()
    .join('|'),
)

/**
 * One key per cart contents. Reusing it across attempts for the same cart is
 * what makes a retry safe; a changed cart gets a new key so it can be ordered.
 */
const idempotencyKey = (): string => {
  if (import.meta.client) {
    try {
      const stored = JSON.parse(sessionStorage.getItem(keyStorage) || 'null') as
        | { signature?: string; key?: string }
        | null
      if (stored?.signature === cartSignature.value && stored.key && stored.key.length >= 16) {
        return stored.key
      }
    } catch {
      // Storage unavailable: fall through to a fresh key.
    }
  }

  const key = `web-${cartSignature.value.length}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`
  if (import.meta.client) {
    try {
      sessionStorage.setItem(keyStorage, JSON.stringify({ signature: cartSignature.value, key }))
    } catch {
      // A per-attempt key still prevents a double submit from one page session.
    }
  }
  return key
}

const forgetKey = () => {
  if (!import.meta.client) return
  try {
    sessionStorage.removeItem(keyStorage)
  } catch {
    // Nothing to clean up.
  }
}

const errorCode = (error: unknown): string => {
  const body = (error as { data?: { data?: { code?: string }; code?: string } } | undefined)?.data
  return body?.data?.code || body?.code || ''
}

const changedLines = (error: unknown): PublicCheckoutBlockedLine[] => {
  const body = (error as { data?: { data?: { lines?: PublicCheckoutBlockedLine[] } } } | undefined)?.data
  return Array.isArray(body?.data?.lines) ? body.data.lines : []
}

const submit = async () => {
  if (submitting.value || !quoted.value) return

  fieldErrors.value = {}
  cartChanged.value = []
  failed.value = false

  const payload = {
    lines: lines.value.map(line => ({
      itemId: line.itemId,
      ...(line.variantSku ? { variantSku: line.variantSku } : {}),
      quantity: line.quantity,
    })),
    customer: {
      fullName: form.fullName,
      phone: form.phone,
      ...(form.email.trim() ? { email: form.email } : {}),
    },
    shippingAddress: {
      fullName: form.fullName,
      phone: form.phone,
      street: form.street,
      ward: form.ward,
      district: form.district,
      city: form.city,
      country: form.country || 'Việt Nam',
    },
    paymentMethod: form.paymentMethod,
    note: form.note,
  }

  const parsed = PublicCheckoutRequestSchema.safeParse(payload)
  if (!parsed.success) {
    const errors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[issue.path.length - 1] ?? '')
      if (field && !errors[field]) errors[field] = t('checkout.invalidField')
    }
    fieldErrors.value = errors
    return
  }

  submitting.value = true
  try {
    const response = await $fetch<{ data: PublicCheckoutOrder, mailQueued?: boolean }>('/api/public/checkout', {
      method: 'POST',
      headers: { [PUBLIC_CHECKOUT_IDEMPOTENCY_HEADER]: idempotencyKey() },
      body: parsed.data as PublicCheckoutRequest,
    })
    order.value = response.data
    // Only claim a mail when the server queued one.
    mailQueued.value = response.mailQueued === true
    forgetKey()
    clear()
  } catch (error) {
    const code = errorCode(error)
    if (code === 'CHECKOUT_CART_CHANGED') {
      cartChanged.value = changedLines(error)
      await quote()
    } else if (code === 'CHECKOUT_EMPTY') {
      cartChanged.value = []
      await quote()
    } else {
      failed.value = true
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
    <header>
      <h1 class="text-2xl font-extrabold tracking-tight text-highlighted sm:text-3xl">{{ t('checkout.title') }}</h1>
      <p class="mt-1 max-w-2xl text-sm text-muted">{{ t('checkout.subtitle') }}</p>
    </header>

    <div v-if="loading" class="mt-8 space-y-3">
      <div class="h-24 animate-pulse rounded-[6px] border border-default/50 bg-elevated/20" />
      <div class="h-24 animate-pulse rounded-[6px] border border-default/50 bg-elevated/20" />
    </div>

    <section v-else-if="order" class="mt-10 max-w-xl rounded-[6px] border border-default/60 bg-elevated/20 px-6 py-10">
      <UIcon name="i-lucide-circle-check" class="size-9 text-primary" aria-hidden="true" />
      <h2 class="mt-3 text-base font-semibold text-highlighted">{{ t('checkout.successTitle') }}</h2>
      <p class="mt-2 max-w-xl text-sm text-muted">{{ t('checkout.successHint') }}</p>
      <p v-if="mailQueued" class="mt-2 max-w-xl text-sm text-muted">{{ t('checkout.mailQueued') }}</p>
      <dl class="mt-6 grid max-w-md gap-2 text-sm">
        <div class="flex items-baseline justify-between gap-4 border-b border-default/50 pb-2">
          <dt class="text-muted">{{ t('checkout.orderCode') }}</dt>
          <dd class="font-mono font-semibold text-highlighted">{{ order.code }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-4 border-b border-default/50 pb-2">
          <dt class="text-muted">{{ t('checkout.orderItems') }}</dt>
          <dd class="text-default">{{ order.itemCount }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-4">
          <dt class="text-muted">{{ t('checkout.orderTotal') }}</dt>
          <dd class="text-lg font-bold text-highlighted">
            {{ formatCatalogPrice(order.totalAmount, order.currency, locale) }}
          </dd>
        </div>
      </dl>
      <div class="mt-6 flex flex-wrap gap-2">
        <UButton to="/products" color="primary" size="md" :label="t('checkout.continueShopping')" />
        <UButton to="/tra-cuu-don" color="neutral" variant="soft" size="md" :label="t('checkout.lookupOrder')" />
      </div>
    </section>

    <section v-else-if="isEmpty" class="mt-10 rounded-[6px] border border-default/60 bg-elevated/20 px-6 py-12 text-center">
      <UIcon name="i-lucide-shopping-cart" class="mx-auto size-10 text-dimmed" aria-hidden="true" />
      <h2 class="mt-4 text-base font-semibold text-highlighted">{{ t('checkout.emptyTitle') }}</h2>
      <p class="mx-auto mt-2 max-w-md text-sm text-muted">{{ t('checkout.emptyHint') }}</p>
      <UButton to="/products" color="primary" size="md" class="mt-5" :label="t('checkout.browse')" />
    </section>

    <form v-else class="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]" @submit.prevent="submit">
      <div class="space-y-6">
        <fieldset class="rounded-[6px] border border-default/60 p-5">
          <legend class="px-1 text-sm font-semibold text-highlighted">{{ t('checkout.contact') }}</legend>
          <div class="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label for="checkout-name" class="mb-1 block text-xs font-medium text-muted">{{ t('checkout.fullName') }}</label>
              <UInput id="checkout-name" v-model="form.fullName" autocomplete="name" :disabled="submitting" class="w-full" />
              <p v-if="fieldErrors.fullName" class="mt-1 text-xs text-error">{{ fieldErrors.fullName }}</p>
            </div>
            <div>
              <label for="checkout-phone" class="mb-1 block text-xs font-medium text-muted">{{ t('checkout.phone') }}</label>
              <UInput id="checkout-phone" v-model="form.phone" type="tel" autocomplete="tel" :disabled="submitting" class="w-full" />
              <p v-if="fieldErrors.phone" class="mt-1 text-xs text-error">{{ fieldErrors.phone }}</p>
            </div>
            <div class="sm:col-span-2">
              <label for="checkout-email" class="mb-1 block text-xs font-medium text-muted">{{ t('checkout.email') }}</label>
              <UInput id="checkout-email" v-model="form.email" type="email" autocomplete="email" :disabled="submitting" class="w-full" />
              <p v-if="fieldErrors.email" class="mt-1 text-xs text-error">{{ fieldErrors.email }}</p>
            </div>
          </div>
        </fieldset>

        <fieldset class="rounded-[6px] border border-default/60 p-5">
          <legend class="px-1 text-sm font-semibold text-highlighted">{{ t('checkout.shipping') }}</legend>
          <div class="mt-3 grid gap-4 sm:grid-cols-2">
            <div class="sm:col-span-2">
              <label for="checkout-street" class="mb-1 block text-xs font-medium text-muted">{{ t('checkout.street') }}</label>
              <UInput id="checkout-street" v-model="form.street" autocomplete="street-address" :disabled="submitting" class="w-full" />
              <p v-if="fieldErrors.street" class="mt-1 text-xs text-error">{{ fieldErrors.street }}</p>
            </div>
            <div>
              <label for="checkout-ward" class="mb-1 block text-xs font-medium text-muted">{{ t('checkout.ward') }}</label>
              <UInput id="checkout-ward" v-model="form.ward" autocomplete="address-level3" :disabled="submitting" class="w-full" />
            </div>
            <div>
              <label for="checkout-district" class="mb-1 block text-xs font-medium text-muted">{{ t('checkout.district') }}</label>
              <UInput id="checkout-district" v-model="form.district" autocomplete="address-level2" :disabled="submitting" class="w-full" />
            </div>
            <div>
              <label for="checkout-city" class="mb-1 block text-xs font-medium text-muted">{{ t('checkout.city') }}</label>
              <UInput id="checkout-city" v-model="form.city" autocomplete="address-level1" :disabled="submitting" class="w-full" />
              <p v-if="fieldErrors.city" class="mt-1 text-xs text-error">{{ fieldErrors.city }}</p>
            </div>
            <div>
              <label for="checkout-country" class="mb-1 block text-xs font-medium text-muted">{{ t('checkout.country') }}</label>
              <UInput id="checkout-country" v-model="form.country" autocomplete="country-name" :disabled="submitting" class="w-full" />
            </div>
            <div class="sm:col-span-2">
              <label for="checkout-note" class="mb-1 block text-xs font-medium text-muted">{{ t('checkout.note') }}</label>
              <UTextarea id="checkout-note" v-model="form.note" :rows="3" :disabled="submitting" class="w-full" />
            </div>
          </div>
        </fieldset>

        <fieldset class="rounded-[6px] border border-default/60 p-5">
          <legend class="px-1 text-sm font-semibold text-highlighted">{{ t('checkout.payment') }}</legend>
          <div class="mt-3 space-y-2">
            <label
              v-for="option in paymentOptions"
              :key="option.value"
              class="flex cursor-pointer items-start gap-3 rounded-[6px] border border-default/60 px-3 py-2.5"
              :class="form.paymentMethod === option.value ? 'border-primary/60 bg-elevated/30' : ''"
            >
              <input
                v-model="form.paymentMethod"
                type="radio"
                name="checkout-payment"
                :value="option.value"
                :disabled="submitting"
                class="mt-1"
              >
              <span>
                <span class="block text-sm font-medium text-highlighted">{{ option.label }}</span>
                <span class="block text-xs text-muted">{{ option.hint }}</span>
              </span>
            </label>
          </div>
        </fieldset>
      </div>

      <aside class="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <div class="rounded-[6px] border border-default/60 p-5">
          <h2 class="text-sm font-semibold text-highlighted">{{ t('checkout.summary') }}</h2>
          <ul class="mt-3 space-y-2 text-sm">
            <li v-for="row in rows" :key="cartLineKey(row)" class="flex items-start justify-between gap-3">
              <span :class="row.available ? 'text-default' : 'text-muted line-through'">
                {{ readLocalized(row.name, locale) || t('cart.unavailableName') }}
                <span class="text-muted">× {{ row.quantity }}</span>
              </span>
              <span class="whitespace-nowrap font-medium text-highlighted">
                {{ row.available ? formatCatalogPrice(row.lineTotal, currency, locale) : '—' }}
              </span>
            </li>
          </ul>
          <dl class="mt-4 flex items-baseline justify-between gap-4 border-t border-default/60 pt-3">
            <dt class="text-sm text-muted">{{ t('checkout.total') }}</dt>
            <dd class="text-lg font-bold text-highlighted">{{ formatCatalogPrice(subtotal, currency, locale) }}</dd>
          </dl>
          <p class="mt-2 text-xs text-muted">{{ t('checkout.priceNote') }}</p>
        </div>

        <div v-if="cartChanged.length" class="rounded-[6px] border border-warning/50 bg-warning/10 px-4 py-3" role="alert">
          <p class="text-sm font-semibold text-highlighted">{{ t('checkout.changedTitle') }}</p>
          <p class="mt-1 text-xs text-muted">{{ t('checkout.changedHint') }}</p>
          <ul class="mt-2 space-y-1 text-xs text-warning">
            <li v-for="line in cartChanged" :key="`${line.itemId}:${line.variantSku || ''}`">
              {{ line.variantSku || line.itemId }} — {{ line.issues.map(code => t(`cart.issue.${code}`)).join(' ') }}
            </li>
          </ul>
          <UButton to="/gio-hang" color="neutral" variant="soft" size="xs" class="mt-3" :label="t('checkout.backToCart')" />
        </div>

        <div v-if="hasBlockedLine && !cartChanged.length" class="rounded-[6px] border border-warning/50 bg-warning/10 px-4 py-3" role="alert">
          <p class="text-sm font-semibold text-highlighted">{{ t('checkout.emptyCart') }}</p>
          <UButton to="/gio-hang" color="neutral" variant="soft" size="xs" class="mt-3" :label="t('checkout.backToCart')" />
        </div>

        <div v-if="failed" class="rounded-[6px] border border-error/50 bg-error/10 px-4 py-3" role="alert">
          <p class="text-sm text-error">{{ t('checkout.failed') }}</p>
        </div>

        <UButton
          type="submit"
          color="primary"
          size="lg"
          block
          :loading="submitting"
          :disabled="!canSubmit"
          :label="submitting ? t('checkout.submitting') : t('checkout.submit')"
        />
        <UButton to="/gio-hang" color="neutral" variant="ghost" size="sm" block :label="t('checkout.backToCart')" />
      </aside>
    </form>
  </div>
</template>
