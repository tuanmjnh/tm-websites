<template>
  <div class="min-h-screen bg-white text-slate-900">
    <div class="print:hidden flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm">
      <UButton to="/quotations" variant="ghost" size="sm" icon="i-lucide-arrow-left" :label="t('admin.quotations.back')" />
      <div class="flex items-center gap-2">
        <USelect
          v-if="quotation"
          v-model="selectedStatus"
          :items="STATUSES.map(status => ({ label: t(`admin.quotations.statuses.${status}`), value: status }))"
          class="w-44"
          :disabled="savingStatus"
        />
        <UButton
          v-if="quotation"
          size="sm"
          variant="soft"
          icon="i-lucide-check"
          :loading="savingStatus"
          :label="t('admin.quotations.saveStatus')"
          @click="saveStatus"
        />
        <UButton size="sm" icon="i-lucide-printer" :label="t('admin.quotations.print')" @click="print" />
      </div>
    </div>

    <div class="mx-auto max-w-[820px] px-6 py-8">
      <p v-if="loading" class="text-sm text-slate-500">{{ t('admin.quotations.loading') }}</p>
      <p v-else-if="error" class="text-sm text-red-600">{{ error }}</p>

      <article v-else-if="quotation">
        <header class="flex items-start justify-between gap-6 border-b pb-4" :style="{ borderColor: primaryColor }">
          <div>
            <p v-if="companyName" class="text-xs font-medium text-slate-500">{{ companyName }}</p>
            <h1 class="text-2xl font-bold uppercase tracking-wide" :style="{ color: primaryColor }">
              {{ titleText }}
            </h1>
            <p v-if="subtitleText" class="mt-1 text-sm text-slate-600">{{ subtitleText }}</p>
            <p class="mt-1 text-sm text-slate-600">{{ t('admin.quotations.code') }}: <strong>{{ quotation.code }}</strong></p>
            <p class="text-sm text-slate-600">{{ t('admin.quotations.createdAt') }}: {{ dateOf(quotation.createdAt) }}</p>
          </div>
          <div class="text-right text-sm text-slate-600">
            <p v-if="companyAddress">{{ companyAddress }}</p>
            <p v-if="companyPhone">{{ companyPhone }}</p>
            <p v-if="companyEmail">{{ companyEmail }}</p>
            <p v-if="companyTaxCode">{{ t('admin.quotations.taxCode') }}: {{ companyTaxCode }}</p>
            <p v-if="companyWebsite">{{ companyWebsite }}</p>
            <p class="mt-2">{{ t('admin.quotations.validUntil') }}: {{ dateOf(quotation.validUntil) }}</p>
            <p>{{ t('admin.quotations.status') }}: {{ t(`admin.quotations.statuses.${quotation.status}`) }}</p>
          </div>
        </header>

        <section class="mt-5">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-slate-500">{{ t('admin.quotations.customer') }}</h2>
          <p class="mt-1 font-medium">{{ quotation.shippingAddress.fullName || '—' }}</p>
          <p v-if="quotation.shippingAddress.phone" class="text-sm text-slate-600">{{ quotation.shippingAddress.phone }}</p>
          <p v-if="customerLines.length" class="text-sm text-slate-600">{{ customerLines.join(', ') }}</p>
        </section>

        <table class="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr class="border-y text-left text-xs uppercase text-white" :style="{ backgroundColor: primaryColor, borderColor: primaryColor }">
              <th class="px-2 py-2 font-semibold">#</th>
              <th class="px-2 py-2 font-semibold">{{ t('admin.quotations.item') }}</th>
              <th v-if="showSku" class="px-2 py-2 font-semibold">{{ t('admin.quotations.sku') }}</th>
              <th class="px-2 py-2 text-right font-semibold">{{ t('admin.quotations.quantity') }}</th>
              <th v-if="showUnitPrice" class="px-2 py-2 text-right font-semibold">{{ t('admin.quotations.unitPrice') }}</th>
              <th class="px-2 py-2 text-right font-semibold">{{ t('admin.quotations.amount') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in quotation.items" :key="index" class="border-b border-slate-200 align-top">
              <td class="px-2 py-2">{{ index + 1 }}</td>
              <td class="px-2 py-2">
                <p class="font-medium">{{ item.itemName }}</p>
                <p v-if="Object.keys(item.attributes).length" class="text-xs text-slate-500">
                  {{ Object.entries(item.attributes).map(([key, value]) => `${key}: ${value}`).join(' · ') }}
                </p>
              </td>
              <td v-if="showSku" class="px-2 py-2 text-slate-600">{{ item.sku || '—' }}</td>
              <td class="px-2 py-2 text-right">{{ item.quantity }}</td>
              <td v-if="showUnitPrice" class="px-2 py-2 text-right">{{ money(item.price, quotation.currency) }}</td>
              <td class="px-2 py-2 text-right font-medium">{{ money(item.price * item.quantity, quotation.currency) }}</td>
            </tr>
          </tbody>
        </table>

        <section class="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
          <div class="flex justify-between">
            <span class="text-slate-600">{{ t('admin.quotations.subtotal') }}</span>
            <span>{{ money(quotation.itemsPrice, quotation.currency) }}</span>
          </div>
          <div v-if="quotation.shippingFee" class="flex justify-between">
            <span class="text-slate-600">{{ t('admin.quotations.shipping') }}</span>
            <span>{{ money(quotation.shippingFee, quotation.currency) }}</span>
          </div>
          <div v-if="showDiscount && quotation.discountAmount" class="flex justify-between">
            <span class="text-slate-600">{{ t('admin.quotations.discount') }}</span>
            <span>-{{ money(quotation.discountAmount, quotation.currency) }}</span>
          </div>
          <div class="flex justify-between border-t border-slate-300 pt-1 text-base font-semibold" :style="{ color: primaryColor }">
            <span>{{ t('admin.quotations.total') }}</span>
            <span>{{ money(quotation.totalAmount, quotation.currency) }}</span>
          </div>
          <p v-if="showTotalInWords" class="pt-1 text-xs italic text-slate-500">
            {{ t('admin.quotations.totalInWords') }}: {{ amountInWords(quotation.totalAmount) }}
          </p>
        </section>

        <section v-if="showBankAccounts && (companyName || companyTaxCode)" class="mt-6 text-sm">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-slate-500">{{ t('admin.quotations.bankAccounts') }}</h2>
          <p class="mt-1 text-slate-600">{{ t('admin.quotations.bankAccountsHint') }}</p>
        </section>

        <section v-if="quotation.customerNote || quotation.adminNote || termsText || notesText" class="mt-6 text-sm">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-slate-500">{{ t('admin.quotations.notes') }}</h2>
          <p v-if="termsText" class="mt-1 whitespace-pre-line text-slate-600">{{ termsText }}</p>
          <p v-if="notesText" class="mt-1 whitespace-pre-line text-slate-600">{{ notesText }}</p>
          <p v-if="quotation.customerNote" class="mt-1 whitespace-pre-line">{{ quotation.customerNote }}</p>
          <p v-if="quotation.adminNote" class="mt-1 whitespace-pre-line text-slate-600">{{ quotation.adminNote }}</p>
        </section>

        <footer v-if="showSignatures" class="mt-12 grid grid-cols-3 gap-6 text-center text-sm">
          <div>
            <p class="font-medium">{{ senderTitleText }}</p>
            <p class="mt-16 text-xs text-slate-400">{{ t('admin.quotations.signatureHint') }}</p>
          </div>
          <div>
            <p class="font-medium">{{ accountantTitleText }}</p>
            <p class="mt-16 text-xs text-slate-400">{{ t('admin.quotations.signatureHint') }}</p>
          </div>
          <div>
            <p class="font-medium">{{ receiverTitleText }}</p>
            <p class="mt-16 text-xs text-slate-400">{{ t('admin.quotations.signatureHint') }}</p>
          </div>
        </footer>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AdminQuotation } from '../../composables/useQuotationsAdmin'
import type { AdminDocumentTemplate } from '../../composables/useDocumentTemplatesAdmin'

definePageMeta({ layout: false })

const { t } = useI18n()
const route = useRoute()
const { getQuotation, updateQuotation } = useQuotationsAdmin()
const { getDefault: getDefaultTemplate } = useDocumentTemplatesAdmin()

const loading = ref(true)
const error = ref<string | null>(null)
const quotation = ref<AdminQuotation | null>(null)
const templateConfig = ref<AdminDocumentTemplate | null>(null)
const savingStatus = ref(false)
const STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'] as const
type QuotationStatus = (typeof STATUSES)[number]
const selectedStatus = ref<QuotationStatus>('draft')
const isQuotationStatus = (value: string): value is QuotationStatus =>
  (STATUSES as readonly string[]).includes(value)

const money = (value: number, currency: string) =>
  `${new Intl.NumberFormat('vi-VN').format(value)} ${currency}`
const dateOf = (value: string | number | null | undefined) => {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('vi-VN')
}
const customerLines = computed(() => {
  const address = quotation.value?.shippingAddress
  if (!address) return []
  return [address.street, address.ward, address.district, address.city, address.country].filter(Boolean)
})

const primaryColor = computed(() => templateConfig.value?.primaryColor || '#0284c7')
const titleText = computed(() => templateConfig.value?.title || t('admin.quotations.sheetTitle'))
const subtitleText = computed(() => templateConfig.value?.subtitle || '')
const companyName = computed(() => templateConfig.value?.companyName || '')
const companyAddress = computed(() => templateConfig.value?.companyAddress || '')
const companyPhone = computed(() => templateConfig.value?.companyPhone || '')
const companyEmail = computed(() => templateConfig.value?.companyEmail || '')
const companyTaxCode = computed(() => templateConfig.value?.companyTaxCode || '')
const companyWebsite = computed(() => templateConfig.value?.companyWebsite || '')
const showSku = computed(() => templateConfig.value?.showSku !== false)
const showUnitPrice = computed(() => templateConfig.value?.showUnitPrice !== false)
const showDiscount = computed(() => templateConfig.value?.showDiscount !== false)
const showTotalInWords = computed(() => templateConfig.value?.showTotalInWords !== false)
const showBankAccounts = computed(() => templateConfig.value?.showBankAccounts === true)
const showSignatures = computed(() => templateConfig.value?.showSignatures !== false)
const termsText = computed(() => templateConfig.value?.terms || '')
const notesText = computed(() => templateConfig.value?.notes || '')
const senderTitleText = computed(() => templateConfig.value?.senderTitle || t('admin.quotations.signatureSender'))
const receiverTitleText = computed(() => templateConfig.value?.receiverTitle || t('admin.quotations.signatureCustomer'))
const accountantTitleText = computed(() => templateConfig.value?.accountantTitle || t('admin.quotations.signatureAccountant'))

const amountInWords = (value: number) => {
  if (!value) return ''
  const ones = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']
  const readThree = (n: number, hasHigher: boolean) => {
    const hundred = Math.floor(n / 100)
    const ten = Math.floor((n % 100) / 10)
    const unit = n % 10
    const parts: string[] = []
    if (hundred > 0) parts.push(`${ones[hundred]!} trăm`)
    if (ten > 1) {
      parts.push(`${ones[ten]!} mươi`)
      if (unit === 1) parts.push('mốt')
      else if (unit === 5) parts.push('lăm')
      else if (unit > 0) parts.push(ones[unit]!)
    } else if (ten === 1) {
      parts.push('mười')
      if (unit === 5) parts.push('lăm')
      else if (unit > 0) parts.push(ones[unit]!)
    } else if (unit > 0) {
      if (hasHigher || hundred > 0) parts.push(`lẻ ${unit === 5 ? 'năm' : ones[unit]!}`)
      else parts.push(ones[unit]!)
    }
    return parts.join(' ')
  }
  const groups: number[] = []
  let n = Math.round(value)
  while (n > 0) {
    groups.unshift(n % 1000)
    n = Math.floor(n / 1000)
  }
  const scales = ['', ' nghìn', ' triệu', ' tỷ']
  const words = groups
    .map((g, i) => {
      const scaleIndex = groups.length - 1 - i
      const scale = scales[scaleIndex] || ''
      if (g === 0) return ''
      return readThree(g, scaleIndex < groups.length - 1) + scale
    })
    .filter(Boolean)
    .join(' ')
  const trimmed = words.trim()
  if (!trimmed) return ''
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1) + ' đồng'
}

const load = async () => {
  loading.value = true
  error.value = null
  try {
    const found = await getQuotation(String(route.params.id))
    quotation.value = found
    selectedStatus.value = isQuotationStatus(found.status) ? found.status : 'draft'
    try {
      templateConfig.value = await getDefaultTemplate('quotation')
    } catch {
      templateConfig.value = null
    }
  } catch {
    error.value = t('admin.quotations.notFound')
  } finally {
    loading.value = false
  }
}

const print = () => {
  if (import.meta.client) window.print()
}

const saveStatus = async () => {
  if (!quotation.value || selectedStatus.value === quotation.value.status) return
  savingStatus.value = true
  try {
    quotation.value = await updateQuotation(quotation.value.id, {
      status: selectedStatus.value,
      revision: quotation.value.revision,
    })
    useToast().add({ title: t('admin.quotations.statusSaved'), color: 'success' })
  } catch {
    useToast().add({ title: t('admin.quotations.statusFailed'), color: 'error' })
    selectedStatus.value = isQuotationStatus(quotation.value.status) ? quotation.value.status : 'draft'
  } finally {
    savingStatus.value = false
  }
}

onMounted(() => { void load() })
</script>

<style>
@media print {
  @page {
    size: A4;
    margin: 14mm;
  }
  body {
    background: #fff;
  }
}
</style>