<script setup lang="ts">
import type { AdminPayable, AdminPayment } from '../composables/useOperationsAdmin'

const { t } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const ops = useOperationsAdmin()

const canRead = computed(() => hasCapability('content.read'))
const canWrite = computed(() => hasCapability('content.write'))

type Tab = 'payments' | 'payables'
const tab = ref<Tab>('payments')

const { reason: auditReason, resetOnClose } = useAuditReason()
const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)} ₫`

const PAYMENT_METHODS = ['cash', 'banking', 'cod', 'card', 'other'] as const

const describeError = (e: unknown) => {
  const code = ops.errorCode(e) ?? ''
  if (/EXCEEDS_OUTSTANDING|EXCEEDS/.test(code)) return t('admin.finance.errors.exceeds')
  if (/REVISION_CONFLICT/.test(code)) return t('admin.finance.errors.conflict')
  if (/NOT_FOUND/.test(code)) return t('admin.finance.errors.notFound')
  if (/DIRECTION_MISMATCH/.test(code)) return t('admin.finance.errors.direction')
  if (/REFERENCE_CLOSED/.test(code)) return t('admin.finance.errors.closed')
  if (/ALREADY_VOIDED/.test(code)) return t('admin.finance.errors.alreadyVoided')
  if (/PAYLOAD_INVALID|_INVALID$/.test(code)) return t('admin.finance.errors.invalid')
  if (/REASON_REQUIRED/.test(code)) return t('admin.finance.errors.reasonRequired')
  const status = (e as { statusCode?: number, status?: number })?.statusCode ?? (e as { status?: number })?.status
  if (status === 401) return t('admin.errors.unauthorized')
  if (status === 403) return t('admin.errors.forbidden')
  if (status === 404) return t('admin.errors.notFound')
  if (!status) return t('admin.errors.network')
  if (status === 503) return t('admin.errors.unavailable')
  return t('admin.errors.generic')
}

/* ------------------------------- payments ------------------------------- */

const payments = ref<AdminPayment[]>([])
const paymentDirection = ref('all')
const paymentState = ref('all')
const paymentCursor = ref<string | null>(null)
const paymentHasMore = ref(false)
const paymentLoading = ref(false)
const paymentError = ref<string | null>(null)
const paymentCounts = ref({ all: 0, posted: 0, voided: 0, postedAmount: 0 })

const directionOptions = computed(() => [
  { label: t('admin.finance.payments.allDirections'), value: 'all' },
  { label: t('admin.finance.directions.receivable'), value: 'receivable' },
  { label: t('admin.finance.directions.payable'), value: 'payable' },
])

const paymentMethodItems = computed<{ label: string, value: string }[]>(() =>
  PAYMENT_METHODS.map(method => ({ label: t(`admin.finance.methods.${method}`), value: method })),
)

const stateOptions = computed(() => [
  { label: t('admin.finance.payments.allStates'), value: 'all' },
  { label: t('admin.finance.paymentStates.posted'), value: 'posted' },
  { label: t('admin.finance.paymentStates.voided'), value: 'voided' },
])

async function loadPayments(reset = true) {
  if (!canRead.value) return
  paymentLoading.value = true
  paymentError.value = null
  try {
    const page = await ops.listPayments({
      direction: paymentDirection.value === 'all' ? undefined : paymentDirection.value,
      state: paymentState.value === 'all' ? undefined : paymentState.value,
      cursor: reset ? null : paymentCursor.value,
    })
    payments.value = reset ? page.data : [...payments.value, ...page.data]
    paymentCursor.value = page.nextCursor
    paymentHasMore.value = page.hasMore
    paymentCounts.value = { ...paymentCounts.value, ...page.counts }
  } catch (e) {
    paymentError.value = describeError(e)
  } finally {
    paymentLoading.value = false
  }
}

watch([paymentDirection, paymentState], () => loadPayments())

const paymentFormOpen = ref(false)
const paymentSaving = ref(false)
const paymentFormError = ref<string | null>(null)
const paymentForm = reactive({
  direction: 'receivable',
  referenceModel: 'Order',
  referenceId: '',
  amount: 0,
  method: 'cash',
  note: '',
})

function openPaymentCreate() {
  Object.assign(paymentForm, { direction: 'receivable', referenceModel: 'Order', referenceId: '', amount: 0, method: 'cash', note: '' })
  auditReason.value = ''
  paymentFormError.value = null
  paymentFormOpen.value = true
}

async function submitPayment() {
  if (paymentSaving.value) return
  if (!paymentForm.referenceId.trim() || Number(paymentForm.amount) <= 0) {
    paymentFormError.value = t('admin.finance.errors.paymentIncomplete')
    return
  }
  paymentSaving.value = true
  paymentFormError.value = null
  try {
    await ops.createPayment({
      direction: paymentForm.direction,
      referenceModel: paymentForm.referenceModel,
      referenceId: paymentForm.referenceId.trim(),
      amount: Number(paymentForm.amount),
      method: paymentForm.method,
      note: paymentForm.note,
    }, auditReason.value.trim() || undefined)
    toast.add({ title: t('admin.finance.payments.created'), color: 'success' })
    paymentFormOpen.value = false
    await Promise.all([loadPayments(), loadPayables()])
  } catch (e) {
    paymentFormError.value = describeError(e)
  } finally {
    paymentSaving.value = false
  }
}

/* ------------------------------- payables ------------------------------- */

const payables = ref<AdminPayable[]>([])
const payableStatus = ref('all')
const payableCursor = ref<string | null>(null)
const payableHasMore = ref(false)
const payableLoading = ref(false)
const payableError = ref<string | null>(null)

const payableStatusOptions = computed(() => [
  { label: t('admin.finance.payables.allStatuses'), value: 'all' },
  { label: t('admin.finance.payableStates.posted'), value: 'posted' },
  { label: t('admin.finance.payableStates.voided'), value: 'voided' },
])

async function loadPayables(reset = true) {
  if (!canRead.value) return
  payableLoading.value = true
  payableError.value = null
  try {
    const page = await ops.listPayables({
      status: payableStatus.value === 'all' ? undefined : payableStatus.value,
      cursor: reset ? null : payableCursor.value,
    })
    payables.value = reset ? page.data : [...payables.value, ...page.data]
    payableCursor.value = page.nextCursor
    payableHasMore.value = page.hasMore
  } catch (e) {
    payableError.value = describeError(e)
  } finally {
    payableLoading.value = false
  }
}

watch(payableStatus, () => loadPayables())

/* ------------------------------ void flow ------------------------------- */

const voidOpen = ref(false)
const voidBusy = ref(false)
const voidError = ref<string | null>(null)
const voidKind = ref<'payment' | 'payable'>('payment')
const voidPaymentTarget = ref<AdminPayment | null>(null)
const voidPayableTarget = ref<AdminPayable | null>(null)

function askVoidPayment(payment: AdminPayment) {
  voidKind.value = 'payment'
  voidPaymentTarget.value = payment
  voidPayableTarget.value = null
  auditReason.value = ''
  voidError.value = null
  voidOpen.value = true
}

function askVoidPayable(payable: AdminPayable) {
  voidKind.value = 'payable'
  voidPayableTarget.value = payable
  voidPaymentTarget.value = null
  auditReason.value = ''
  voidError.value = null
  voidOpen.value = true
}

async function runVoid() {
  if (voidBusy.value) return
  const reason = auditReason.value.trim()
  if (!reason) {
    voidError.value = t('admin.finance.errors.reasonRequired')
    return
  }
  voidBusy.value = true
  voidError.value = null
  try {
    if (voidKind.value === 'payment') {
      await ops.voidPayment(voidPaymentTarget.value!.id, { revision: voidPaymentTarget.value!.revision, reason }, reason)
      toast.add({ title: t('admin.finance.payments.voidedToast'), color: 'success' })
      await Promise.all([loadPayments(), loadPayables()])
    } else {
      await ops.voidPayable(voidPayableTarget.value!.id, { reason }, reason)
      toast.add({ title: t('admin.finance.payables.voidedToast'), color: 'success' })
      await loadPayables()
    }
    voidOpen.value = false
  } catch (e) {
    voidError.value = describeError(e)
  } finally {
    voidBusy.value = false
  }
}

if (canRead.value) {
  await Promise.all([loadPayments(), loadPayables()])
}

resetOnClose(paymentFormOpen, voidOpen)
</script>

<template>
  <div>
    <CmsBasePage
      :title="t('admin.finance.title')"
      :description="t('admin.finance.description')"
      :empty="!canRead"
      :empty-text="t('admin.finance.permissionDenied')"
      empty-icon="i-lucide-wallet"
    >
      <template #right>
        <UButton
          v-if="canWrite && tab === 'payments'"
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          size="sm"
          :label="t('admin.finance.payments.create')"
          @click="openPaymentCreate"
        />
      </template>

      <div v-if="canRead" class="flex flex-col gap-4">
        <div class="flex flex-wrap gap-2">
          <UButton
            icon="i-lucide-receipt"
            :label="t('admin.finance.tabs.payments')"
            size="sm"
            :color="tab === 'payments' ? 'primary' : 'neutral'"
            :variant="tab === 'payments' ? 'soft' : 'ghost'"
            @click="tab = 'payments'"
          />
          <UButton
            icon="i-lucide-file-clock"
            :label="t('admin.finance.tabs.payables')"
            size="sm"
            :color="tab === 'payables' ? 'primary' : 'neutral'"
            :variant="tab === 'payables' ? 'soft' : 'ghost'"
            @click="tab = 'payables'"
          />
        </div>

        <!-- Payments -->
        <div v-if="tab === 'payments'" class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <USelect v-model="paymentDirection" :items="directionOptions" value-key="value" size="sm" class="w-full sm:w-44" />
            <USelect v-model="paymentState" :items="stateOptions" value-key="value" size="sm" class="w-full sm:w-40" />
            <p class="text-xs text-muted">
              {{ t('admin.finance.payments.summary', { all: paymentCounts.all, posted: paymentCounts.posted, amount: money(paymentCounts.postedAmount) }) }}
            </p>
          </div>

          <p v-if="paymentError" class="text-xs text-error">{{ paymentError }}</p>
          <p v-else-if="paymentLoading && !payments.length" class="text-xs text-muted">{{ t('common.loading') }}</p>
          <p v-else-if="!payments.length" class="text-xs text-muted">{{ t('admin.finance.payments.empty') }}</p>

          <div v-else class="overflow-hidden rounded-[4px] border border-default/60">
            <div v-for="payment in payments" :key="payment.id" class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs font-medium text-highlighted">{{ payment.code }}</span>
                  <UBadge :color="payment.direction === 'receivable' ? 'success' : 'warning'" variant="subtle" size="sm">
                    {{ t(`admin.finance.directions.${payment.direction}`) }}
                  </UBadge>
                  <UBadge :color="payment.state === 'voided' ? 'error' : 'neutral'" variant="subtle" size="sm">
                    {{ t(`admin.finance.paymentStates.${payment.state}`) }}
                  </UBadge>
                </div>
                <p class="mt-0.5 truncate text-xs text-muted">
                  <span>{{ payment.referenceModel }} · {{ payment.referenceCode || payment.referenceId }}</span>
                  <span> · {{ t(`admin.finance.methods.${payment.method}`) }}</span>
                  <span> · {{ payment.paidAt ? new Date(payment.paidAt).toLocaleString() : '' }}</span>
                </p>
              </div>
              <div class="flex items-center gap-3">
                <span class="text-sm font-medium text-highlighted">{{ money(payment.amount) }}</span>
                <UButton
                  v-if="canWrite && payment.state !== 'voided'"
                  icon="i-lucide-ban"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :title="t('admin.finance.payments.void')"
                  @click="askVoidPayment(payment)"
                />
              </div>
            </div>
          </div>

          <div v-if="paymentHasMore" class="flex justify-center">
            <UButton color="neutral" variant="ghost" size="sm" :loading="paymentLoading" :label="t('admin.finance.loadMore')" @click="loadPayments(false)" />
          </div>
        </div>

        <!-- Payables -->
        <div v-else class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <USelect v-model="payableStatus" :items="payableStatusOptions" value-key="value" size="sm" class="w-full sm:w-44" />
            <p class="text-xs text-muted">{{ t('admin.finance.payables.hint') }}</p>
          </div>

          <p v-if="payableError" class="text-xs text-error">{{ payableError }}</p>
          <p v-else-if="payableLoading && !payables.length" class="text-xs text-muted">{{ t('common.loading') }}</p>
          <p v-else-if="!payables.length" class="text-xs text-muted">{{ t('admin.finance.payables.empty') }}</p>

          <div v-else class="overflow-hidden rounded-[4px] border border-default/60">
            <div v-for="payable in payables" :key="payable.id" class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs font-medium text-highlighted">{{ payable.code }}</span>
                  <UBadge :color="payable.status === 'voided' ? 'error' : 'neutral'" variant="subtle" size="sm">
                    {{ t(`admin.finance.payableStates.${payable.status}`) }}
                  </UBadge>
                </div>
                <p class="mt-0.5 truncate text-xs text-muted">
                  <span>{{ t('admin.finance.payables.purchaseOrder') }}: {{ payable.purchaseOrderCode || payable.purchaseOrderId }}</span>
                  <span v-if="payable.postedAt"> · {{ new Date(payable.postedAt).toLocaleDateString() }}</span>
                  <span v-if="payable.voidedAt"> · {{ t('admin.finance.payables.voidedAt') }} {{ new Date(payable.voidedAt).toLocaleDateString() }}</span>
                </p>
              </div>
              <div class="flex items-center gap-3">
                <span class="text-sm font-medium text-highlighted">{{ money(payable.amount) }}</span>
                <UButton
                  v-if="canWrite && payable.status === 'posted'"
                  icon="i-lucide-ban"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :title="t('admin.finance.payables.void')"
                  @click="askVoidPayable(payable)"
                />
              </div>
            </div>
          </div>

          <div v-if="payableHasMore" class="flex justify-center">
            <UButton color="neutral" variant="ghost" size="sm" :loading="payableLoading" :label="t('admin.finance.loadMore')" @click="loadPayables(false)" />
          </div>
        </div>
      </div>
    </CmsBasePage>

    <!-- Record payment -->
    <UModal v-model:open="paymentFormOpen" :title="t('admin.finance.payments.createTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-lg' }">
      <template #body>
        <div class="flex flex-col gap-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.finance.payments.fields.direction')">
              <USelect
                v-model="paymentForm.direction"
                :items="[{ label: t('admin.finance.directions.receivable'), value: 'receivable' }, { label: t('admin.finance.directions.payable'), value: 'payable' }]"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="t('admin.finance.payments.fields.referenceModel')">
              <USelect
                v-model="paymentForm.referenceModel"
                :items="[{ label: t('admin.finance.references.order'), value: 'Order' }, { label: t('admin.finance.references.purchaseOrder'), value: 'PurchaseOrder' }]"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="t('admin.finance.payments.fields.referenceId')" class="sm:col-span-2">
              <UInput v-model="paymentForm.referenceId" class="w-full" :placeholder="t('admin.finance.payments.referencePlaceholder')" />
            </UFormField>
            <UFormField :label="t('admin.finance.payments.fields.amount')">
              <UInput v-model.number="paymentForm.amount" type="number" min="0" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.finance.payments.fields.method')">
              <USelect v-model="paymentForm.method" :items="paymentMethodItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.finance.payments.fields.note')" class="sm:col-span-2">
              <UTextarea v-model="paymentForm.note" :rows="2" class="w-full" />
            </UFormField>
          </div>
          <p class="text-xs text-muted">{{ t('admin.finance.payments.directionHint') }}</p>
          <AuditReasonField v-model="auditReason" />
          <p v-if="paymentFormError" class="text-xs text-error">{{ paymentFormError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="paymentFormOpen = false" />
          <UButton color="primary" variant="soft" :loading="paymentSaving" :label="t('common.save')" @click="submitPayment" />
        </div>
      </template>
    </UModal>

    <!-- Void payment / payable -->
    <UModal v-model:open="voidOpen" :title="voidKind === 'payment' ? t('admin.finance.payments.voidTitle') : t('admin.finance.payables.voidTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }">
      <template #body>
        <div class="flex flex-col gap-3">
          <p class="text-sm text-toned">
            {{ voidKind === 'payment' ? voidPaymentTarget?.code : voidPayableTarget?.code }}
          </p>
          <p class="text-xs text-muted">{{ t('admin.finance.voidHint') }}</p>
          <AuditReasonField v-model="auditReason" />
          <p v-if="voidError" class="text-xs text-error">{{ voidError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="voidOpen = false" />
          <UButton color="error" variant="soft" :loading="voidBusy" :label="t('admin.finance.void')" @click="runVoid" />
        </div>
      </template>
    </UModal>
  </div>
</template>
