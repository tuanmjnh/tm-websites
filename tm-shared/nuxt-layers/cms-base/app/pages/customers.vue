<script setup lang="ts">
import type { AdminCustomer, AdminCustomerAddress, AdminCustomerSegment } from '@tm/flow-contracts/customer-admin'
import { ADMIN_CUSTOMER_LIST_LIMIT_DEFAULT, ADMIN_CUSTOMER_NOTE_MAX } from '@tm/flow-contracts/customer-admin'
import type { ImportOutcome } from '../utils/import-rows'

const { t } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const {
  listCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  restoreCustomer,
  importCustomers,
  listSegments,
  createSegment,
  updateSegment,
  deleteSegment,
  restoreSegment,
  errorCode,
} = useCrmAdmin()

const canRead = computed(() => hasCapability('content.read'))
const canWrite = computed(() => hasCapability('content.write'))

const loading = ref(false)
const error = ref<string | null>(null)
const customers = ref<AdminCustomer[]>([])
const segments = ref<AdminCustomerSegment[]>([])
const query = ref('')
const segmentFilter = ref('all')
const includeDeleted = ref(false)
const nextCursor = ref<string | null>(null)
const hasMore = ref(false)
const counts = ref({ all: 0, active: 0, inactive: 0, deleted: 0 })

const { reason: auditReason, resetOnClose } = useAuditReason()

/* ------------------------------- list ---------------------------------- */

const segmentOptions = computed(() => [
  { label: t('admin.customers.allSegments'), value: 'all' },
  ...segments.value.map(segment => ({ label: segment.title, value: segment.id })),
])

/** Empty string is "no segment" in the form; the API wants null. */
const segmentFormOptions = computed(() => [
  { label: t('admin.customers.noSegment'), value: '' },
  ...segments.value.map(segment => ({ label: segment.title, value: segment.id })),
])

const segmentTitle = (id: string | null) => {
  if (!id) return '—'
  return segments.value.find(segment => segment.id === id)?.title ?? t('admin.customers.unknownSegment')
}

const errorMessages: Record<string, string> = {
  CUSTOMER_SUBJECT_REQUIRED: 'admin.customers.errors.subjectRequired',
  CUSTOMER_SUBJECT_EXISTS: 'admin.customers.errors.subjectExists',
  CUSTOMER_SUBJECT_IMMUTABLE: 'admin.customers.errors.subjectImmutable',
  CUSTOMER_CODE_EXISTS: 'admin.customers.errors.codeExists',
  CUSTOMER_PAYLOAD_INVALID: 'admin.customers.errors.invalid',
  CUSTOMER_REVISION_REQUIRED: 'admin.customers.errors.revisionRequired',
  CUSTOMER_REVISION_CONFLICT: 'admin.customers.errors.conflict',
  CUSTOMER_SEGMENT_NOT_FOUND: 'admin.customers.errors.segmentMissing',
  CUSTOMER_SEGMENT_DELETED: 'admin.customers.errors.segmentDeleted',
  CUSTOMER_NOT_FOUND: 'admin.customers.errors.notFound',
  CUSTOMER_SEGMENT_IN_USE: 'admin.customerSegments.errors.inUse',
  CUSTOMER_SEGMENT_CODE_EXISTS: 'admin.customerSegments.errors.codeExists',
  CUSTOMER_SEGMENT_PAYLOAD_INVALID: 'admin.customerSegments.errors.invalid',
  CUSTOMER_SEGMENT_REVISION_CONFLICT: 'admin.customerSegments.errors.conflict',
}

const describeError = (e: unknown) => {
  const code = errorCode(e)
  if (code && errorMessages[code]) return t(errorMessages[code]!)
  const status = (e as { statusCode?: number, status?: number })?.statusCode ?? (e as { status?: number })?.status
  if (status === 401) return t('admin.errors.unauthorized')
  if (status === 403) return t('admin.errors.forbidden')
  if (status === 404) return t('admin.errors.notFound')
  if (!status) return t('admin.errors.network')
  if (status === 503) return t('admin.errors.unavailable')
  return t('admin.errors.generic')
}

async function loadSegments() {
  try {
    segments.value = await listSegments()
  } catch (e) {
    error.value = describeError(e)
  }
}

async function load(reset = true) {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const page = await listCustomers({
      q: query.value.trim() || undefined,
      segment: segmentFilter.value === 'all' ? undefined : segmentFilter.value,
      includeDeleted: includeDeleted.value,
      cursor: reset ? null : nextCursor.value,
      limit: ADMIN_CUSTOMER_LIST_LIMIT_DEFAULT,
    })
    customers.value = reset ? page.data : [...customers.value, ...page.data]
    nextCursor.value = page.nextCursor
    hasMore.value = page.hasMore
    counts.value = page.counts
  } catch (e) {
    error.value = describeError(e)
  } finally {
    loading.value = false
  }
}

watchDebounced(query, () => load(), { debounce: 300 })
watch([segmentFilter, includeDeleted], () => load())

/* ---------------------------- customer form ---------------------------- */

type AddressDraft = AdminCustomerAddress

const formOpen = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)
const editing = ref<AdminCustomer | null>(null)

const blankAddress = (): AddressDraft => ({
  fullName: '',
  phone: '',
  street: '',
  ward: '',
  district: '',
  city: '',
  country: '',
  isDefault: false,
  sort: 0,
})

const form = reactive({
  code: '',
  subjectId: '',
  email: '',
  fullName: '',
  phone: '',
  customerSegmentId: '',
  loyaltyPoints: 0,
  note: '',
  isActive: true,
  addresses: [] as AddressDraft[],
})

function resetForm() {
  form.code = ''
  form.subjectId = ''
  form.email = ''
  form.fullName = ''
  form.phone = ''
  form.customerSegmentId = ''
  form.loyaltyPoints = 0
  form.note = ''
  form.isActive = true
  form.addresses = []
  auditReason.value = ''
  formError.value = null
}

function openCreate() {
  editing.value = null
  resetForm()
  formOpen.value = true
}

function openEdit(customer: AdminCustomer) {
  editing.value = customer
  form.code = customer.code
  form.subjectId = customer.subjectId
  form.email = customer.email
  form.fullName = customer.fullName
  form.phone = customer.phone
  form.customerSegmentId = customer.customerSegmentId ?? ''
  form.loyaltyPoints = customer.loyaltyPoints
  form.note = customer.note
  form.isActive = customer.isActive
  form.addresses = customer.addresses.map(address => ({ ...address }))
  auditReason.value = ''
  formError.value = null
  formOpen.value = true
}

function addAddress() {
  form.addresses.push({ ...blankAddress(), isDefault: form.addresses.length === 0 })
}

function removeAddress(index: number) {
  const wasDefault = form.addresses[index]?.isDefault
  form.addresses.splice(index, 1)
  if (wasDefault && form.addresses[0]) form.addresses[0].isDefault = true
}

/** Only one address is the default, so selecting one clears the others. */
function setDefaultAddress(index: number) {
  form.addresses.forEach((address, position) => {
    address.isDefault = position === index
  })
}

async function submitForm() {
  if (!canWrite.value || saving.value) return
  if (!editing.value && !form.subjectId.trim()) {
    formError.value = t('admin.customers.errors.subjectRequired')
    return
  }

  saving.value = true
  formError.value = null
  try {
    const addresses = form.addresses.map((address, index) => ({ ...address, sort: index }))
    if (editing.value) {
      await updateCustomer(editing.value.id, {
        revision: editing.value.revision,
        code: form.code.trim() || undefined,
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        customerSegmentId: form.customerSegmentId || null,
        loyaltyPoints: Number(form.loyaltyPoints) || 0,
        note: form.note,
        isActive: form.isActive,
        addresses,
      }, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.customers.updated'), color: 'success' })
    } else {
      await createCustomer({
        code: form.code.trim() || undefined,
        subjectId: form.subjectId.trim(),
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        customerSegmentId: form.customerSegmentId || null,
        loyaltyPoints: Number(form.loyaltyPoints) || 0,
        note: form.note,
        isActive: form.isActive,
        addresses,
      }, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.customers.created'), color: 'success' })
    }
    formOpen.value = false
    await load()
  } catch (e) {
    formError.value = describeError(e)
  } finally {
    saving.value = false
  }
}

/* --------------------------- delete / restore -------------------------- */

const confirmOpen = ref(false)
const confirmBusy = ref(false)
const confirmError = ref<string | null>(null)
const confirmTarget = ref<AdminCustomer | null>(null)
const confirmMode = ref<'delete' | 'restore'>('delete')

function askRemove(customer: AdminCustomer, mode: 'delete' | 'restore') {
  confirmTarget.value = customer
  confirmMode.value = mode
  auditReason.value = ''
  confirmError.value = null
  confirmOpen.value = true
}

async function confirmAction() {
  if (!confirmTarget.value || confirmBusy.value) return
  confirmBusy.value = true
  confirmError.value = null
  try {
    if (confirmMode.value === 'delete') {
      await deleteCustomer(confirmTarget.value.id, confirmTarget.value.revision, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.customers.hidden'), color: 'success' })
    } else {
      await restoreCustomer(confirmTarget.value.id, confirmTarget.value.revision, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.customers.restored'), color: 'success' })
    }
    confirmOpen.value = false
    await load()
  } catch (e) {
    confirmError.value = describeError(e)
  } finally {
    confirmBusy.value = false
  }
}

/* ------------------------------ segments ------------------------------- */

const segmentsOpen = ref(false)
const segmentFormOpen = ref(false)
const segmentSaving = ref(false)
const segmentError = ref<string | null>(null)
const segmentEditing = ref<AdminCustomerSegment | null>(null)

const segmentForm = reactive({
  code: '',
  title: '',
  description: '',
  sort: 0,
  isActive: true,
  freeShipping: false,
  defaultDiscountPercent: 0,
  minSpent: 0,
  minOrders: 0,
})

function resetSegmentForm() {
  segmentForm.code = ''
  segmentForm.title = ''
  segmentForm.description = ''
  segmentForm.sort = 0
  segmentForm.isActive = true
  segmentForm.freeShipping = false
  segmentForm.defaultDiscountPercent = 0
  segmentForm.minSpent = 0
  segmentForm.minOrders = 0
  segmentError.value = null
}

function openSegmentCreate() {
  segmentEditing.value = null
  resetSegmentForm()
  auditReason.value = ''
  segmentFormOpen.value = true
}

function openSegmentEdit(segment: AdminCustomerSegment) {
  segmentEditing.value = segment
  segmentForm.code = segment.code
  segmentForm.title = segment.title
  segmentForm.description = segment.description
  segmentForm.sort = segment.sort
  segmentForm.isActive = segment.isActive
  segmentForm.freeShipping = segment.freeShipping
  segmentForm.defaultDiscountPercent = segment.defaultDiscountPercent
  segmentForm.minSpent = segment.autoJoinCriteria.minSpent
  segmentForm.minOrders = segment.autoJoinCriteria.minOrders
  segmentError.value = null
  auditReason.value = ''
  segmentFormOpen.value = true
}

async function submitSegment() {
  if (segmentSaving.value) return
  if (!segmentForm.title.trim()) {
    segmentError.value = t('admin.customerSegments.errors.titleRequired')
    return
  }

  segmentSaving.value = true
  segmentError.value = null
  try {
    const payload = {
      code: segmentForm.code.trim() || undefined,
      title: segmentForm.title.trim(),
      description: segmentForm.description.trim(),
      sort: Number(segmentForm.sort) || 0,
      isActive: segmentForm.isActive,
      freeShipping: segmentForm.freeShipping,
      defaultDiscountPercent: Number(segmentForm.defaultDiscountPercent) || 0,
      autoJoinCriteria: {
        minSpent: Number(segmentForm.minSpent) || 0,
        minOrders: Number(segmentForm.minOrders) || 0,
      },
    }

    if (segmentEditing.value) {
      await updateSegment(segmentEditing.value.id, { ...payload, revision: segmentEditing.value.revision }, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.customerSegments.updated'), color: 'success' })
    } else {
      await createSegment(payload, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.customerSegments.created'), color: 'success' })
    }
    segmentFormOpen.value = false
    await loadSegments()
  } catch (e) {
    segmentError.value = describeError(e)
  } finally {
    segmentSaving.value = false
  }
}

async function toggleSegment(segment: AdminCustomerSegment) {
  try {
    if (segment.isDeleted) {
      await restoreSegment(segment.id, segment.revision)
      toast.add({ title: t('admin.customerSegments.restored'), color: 'success' })
    } else {
      await deleteSegment(segment.id, segment.revision)
      toast.add({ title: t('admin.customerSegments.hidden'), color: 'success' })
    }
    await loadSegments()
    await load()
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
  }
}

/* ------------------------------- import -------------------------------- */

const importOpen = ref(false)
const importBusy = ref(false)
const importError = ref<string | null>(null)
const importResult = ref<ImportOutcome | null>(null)
const importExample = 'code,subjectId,email,fullName\nKH-01,hub_subject_01,kh1@example.com,Khách 01'

function openImport() {
  auditReason.value = ''
  importError.value = null
  importResult.value = null
  importOpen.value = true
}

async function runImport(payload: { rows: Record<string, unknown>[], reason: string }) {
  if (!canWrite.value || importBusy.value) return
  importBusy.value = true
  importError.value = null
  try {
    const result = await importCustomers(payload.rows, payload.reason || undefined)
    importResult.value = result
    toast.add({
      title: t('admin.import.result', { created: result.created, updated: result.updated, failed: result.failed }),
      color: result.failed ? 'warning' : 'success',
    })
    if (!result.failed) auditReason.value = ''
    await load()
  } catch (caught) {
    importError.value = describeError(caught)
  } finally {
    importBusy.value = false
  }
}

if (canRead.value) {
  await loadSegments()
  await load()
}

// A cancelled note must not ride along with the next action.
resetOnClose(formOpen, confirmOpen, segmentFormOpen, importOpen)
</script>

<template>
  <div>
    <CmsBasePage
      :title="t('admin.customers.title')"
      :description="t('admin.customers.description')"
      :loading="loading && !customers.length"
      :error="error"
      :empty="canRead && !loading && !customers.length"
      :empty-text="canRead
        ? (query || segmentFilter || includeDeleted ? t('admin.customers.noMatch') : t('admin.customers.empty'))
        : t('admin.customers.permissionDenied')"
      empty-icon="i-lucide-users-round"
    >
      <template #right>
        <div class="flex items-center gap-2">
          <UButton
            v-if="canWrite"
            icon="i-lucide-upload"
            color="neutral"
            variant="ghost"
            size="sm"
            :label="t('admin.import.button')"
            @click="openImport"
          />
          <UButton
            icon="i-lucide-tags"
            color="neutral"
            variant="ghost"
            size="sm"
            :label="t('admin.customers.manageSegments')"
            :disabled="!canRead"
            @click="segmentsOpen = true"
          />
          <UButton
            v-if="canWrite"
            icon="i-lucide-plus"
            color="primary"
            variant="soft"
            size="sm"
            :label="t('admin.customers.create')"
            @click="openCreate"
          />
        </div>
      </template>

      <div v-if="canRead" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-3">
          <UInput
            v-model="query"
            icon="i-lucide-search"
            size="sm"
            class="w-full sm:w-64"
            :placeholder="t('admin.customers.searchPlaceholder')"
          />
          <USelect
            v-model="segmentFilter"
            :items="segmentOptions"
            value-key="value"
            size="sm"
            class="w-full sm:w-48"
          />
          <USwitch v-model="includeDeleted" size="sm" :label="t('admin.customers.includeDeleted')" />
          <p class="text-xs text-muted">
            {{ t('admin.customers.summary', { all: counts.all, inactive: counts.inactive, deleted: counts.deleted }) }}
          </p>
        </div>

        <div v-if="customers.length" class="overflow-hidden rounded-[4px] border border-default/60">
          <div
            v-for="customer in customers"
            :key="customer.id"
            class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0"
          >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="truncate font-medium text-highlighted">{{ customer.fullName || customer.email || customer.code }}</span>
                <UBadge color="neutral" variant="subtle" size="sm">{{ customer.code }}</UBadge>
                <UBadge v-if="customer.customerSegmentId" color="primary" variant="subtle" size="sm">
                  {{ segmentTitle(customer.customerSegmentId) }}
                </UBadge>
                <UBadge v-if="customer.isDeleted" color="error" variant="subtle" size="sm">
                  {{ t('admin.customers.badgeHidden') }}
                </UBadge>
                <UBadge v-else-if="!customer.isActive" color="warning" variant="subtle" size="sm">
                  {{ t('admin.customers.badgeInactive') }}
                </UBadge>
              </div>
              <p class="mt-0.5 truncate text-xs text-muted">
                <span v-if="customer.email">{{ customer.email }}</span>
                <span v-if="customer.phone"> · {{ customer.phone }}</span>
                <span> · {{ customer.metrics.totalOrders }} {{ t('admin.customers.orders') }}</span>
                <span> · {{ t('admin.customers.points', { points: customer.loyaltyPoints }) }}</span>
              </p>
            </div>

            <div v-if="canWrite" class="flex items-center gap-1">
              <UButton
                icon="i-lucide-pencil"
                color="neutral"
                variant="ghost"
                size="xs"
                :title="t('common.edit')"
                @click="openEdit(customer)"
              />
              <UButton
                v-if="customer.isDeleted"
                icon="i-lucide-rotate-ccw"
                color="neutral"
                variant="ghost"
                size="xs"
                :title="t('admin.customers.restore')"
                @click="askRemove(customer, 'restore')"
              />
              <UButton
                v-else
                icon="i-lucide-archive"
                color="error"
                variant="ghost"
                size="xs"
                :title="t('admin.customers.hide')"
                @click="askRemove(customer, 'delete')"
              />
            </div>
          </div>
        </div>

        <div v-if="hasMore" class="flex justify-center">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            :loading="loading"
            :label="t('admin.customers.loadMore')"
            @click="load(false)"
          />
        </div>
      </div>
    </CmsBasePage>

    <!-- Customer create / edit -->
    <UModal
      v-model:open="formOpen"
      :title="editing ? t('admin.customers.editTitle') : t('admin.customers.createTitle')"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-2xl' }"
    >
      <template #body>
        <div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto scroll-thin">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.customers.fields.code')" name="customer-code">
              <UInput v-model="form.code" class="w-full" :placeholder="t('admin.customers.codePlaceholder')" />
            </UFormField>
            <UFormField :label="t('admin.customers.fields.subjectId')" name="customer-subject">
              <UInput v-model="form.subjectId" class="w-full" :disabled="Boolean(editing)" :placeholder="t('admin.customers.subjectPlaceholder')" />
            </UFormField>
            <UFormField :label="t('admin.customers.fields.fullName')" name="customer-name">
              <UInput v-model="form.fullName" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.customers.fields.email')" name="customer-email">
              <UInput v-model="form.email" type="email" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.customers.fields.phone')" name="customer-phone">
              <UInput v-model="form.phone" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.customers.fields.segment')" name="customer-segment">
              <USelect
                v-model="form.customerSegmentId"
                :items="segmentFormOptions"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="t('admin.customers.fields.loyaltyPoints')" name="customer-points">
              <UInput v-model.number="form.loyaltyPoints" type="number" min="0" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.customers.fields.note')" name="customer-note" class="sm:col-span-2">
              <UTextarea v-model="form.note" :maxlength="ADMIN_CUSTOMER_NOTE_MAX" :rows="2" class="w-full" />
            </UFormField>
          </div>

          <div class="flex items-center justify-between">
            <p class="text-sm font-medium text-highlighted">{{ t('admin.customers.addresses.title') }}</p>
            <UButton icon="i-lucide-plus" color="neutral" variant="ghost" size="xs" :label="t('admin.customers.addresses.add')" @click="addAddress" />
          </div>

          <p v-if="!form.addresses.length" class="text-xs text-muted">{{ t('admin.customers.addresses.empty') }}</p>

          <div
            v-for="(address, index) in form.addresses"
            :key="index"
            class="flex flex-col gap-2 rounded-[4px] border border-default/60 p-3"
          >
            <div class="grid gap-2 sm:grid-cols-2">
              <UFormField :label="t('admin.customers.addresses.fullName')">
                <UInput v-model="address.fullName" class="w-full" size="sm" />
              </UFormField>
              <UFormField :label="t('admin.customers.addresses.phone')">
                <UInput v-model="address.phone" class="w-full" size="sm" />
              </UFormField>
              <UFormField :label="t('admin.customers.addresses.street')" class="sm:col-span-2">
                <UInput v-model="address.street" class="w-full" size="sm" />
              </UFormField>
              <UFormField :label="t('admin.customers.addresses.ward')">
                <UInput v-model="address.ward" class="w-full" size="sm" />
              </UFormField>
              <UFormField :label="t('admin.customers.addresses.district')">
                <UInput v-model="address.district" class="w-full" size="sm" />
              </UFormField>
              <UFormField :label="t('admin.customers.addresses.city')">
                <UInput v-model="address.city" class="w-full" size="sm" />
              </UFormField>
              <UFormField :label="t('admin.customers.addresses.country')">
                <UInput v-model="address.country" class="w-full" size="sm" />
              </UFormField>
            </div>
            <div class="flex items-center justify-between">
              <USwitch
                :model-value="address.isDefault"
                size="sm"
                :label="t('admin.customers.addresses.default')"
                @update:model-value="setDefaultAddress(index)"
              />
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                :label="t('common.delete')"
                @click="removeAddress(index)"
              />
            </div>
          </div>

          <div class="flex items-center justify-between">
            <USwitch v-model="form.isActive" size="sm" :label="t('admin.customers.fields.active')" />
            <p v-if="editing" class="text-xs text-muted">{{ t('admin.customers.revision', { revision: editing.revision }) }}</p>
          </div>

          <AuditReasonField v-model="auditReason" />
          <p v-if="formError" class="text-xs text-error">{{ formError }}</p>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="formOpen = false" />
          <UButton color="primary" variant="soft" :loading="saving" :label="t('common.save')" @click="submitForm" />
        </div>
      </template>
    </UModal>

    <!-- Hide / restore confirmation -->
    <UModal
      v-model:open="confirmOpen"
      :title="confirmMode === 'delete' ? t('admin.customers.hideTitle') : t('admin.customers.restoreTitle')"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }"
    >
      <template #body>
        <div class="flex flex-col gap-3">
          <p class="text-sm text-toned">
            {{ confirmMode === 'delete'
              ? t('admin.customers.hideHint', { name: confirmTarget?.fullName || confirmTarget?.code || '' })
              : t('admin.customers.restoreHint', { name: confirmTarget?.fullName || confirmTarget?.code || '' }) }}
          </p>
          <p class="text-xs text-muted">{{ t('admin.customers.hideGuard') }}</p>
          <AuditReasonField v-model="auditReason" />
          <p v-if="confirmError" class="text-xs text-error">{{ confirmError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="confirmOpen = false" />
          <UButton
            :color="confirmMode === 'delete' ? 'error' : 'primary'"
            variant="soft"
            :loading="confirmBusy"
            :label="confirmMode === 'delete' ? t('admin.customers.hide') : t('admin.customers.restore')"
            @click="confirmAction"
          />
        </div>
      </template>
    </UModal>

    <!-- Segments -->
    <UModal
      v-model:open="segmentsOpen"
      :title="t('admin.customerSegments.title')"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-2xl' }"
    >
      <template #body>
        <div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto scroll-thin">
          <div class="flex items-center justify-between gap-2">
            <p class="text-xs text-muted">{{ t('admin.customerSegments.description') }}</p>
            <UButton
              v-if="canWrite"
              icon="i-lucide-plus"
              color="primary"
              variant="soft"
              size="xs"
              :label="t('admin.customerSegments.create')"
              @click="openSegmentCreate"
            />
          </div>

          <p v-if="!segments.length" class="text-xs text-muted">{{ t('admin.customerSegments.empty') }}</p>

          <div v-else class="overflow-hidden rounded-[4px] border border-default/60">
            <div
              v-for="segment in segments"
              :key="segment.id"
              class="flex items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="truncate font-medium text-highlighted">{{ segment.title }}</span>
                  <UBadge color="neutral" variant="subtle" size="sm">{{ segment.code }}</UBadge>
                  <UBadge v-if="segment.freeShipping" color="primary" variant="subtle" size="sm">
                    {{ t('admin.customerSegments.freeShippingBadge') }}
                  </UBadge>
                  <UBadge v-if="segment.isDeleted" color="error" variant="subtle" size="sm">
                    {{ t('admin.customerSegments.badgeHidden') }}
                  </UBadge>
                </div>
                <p class="mt-0.5 text-xs text-muted">
                  {{ t('admin.customerSegments.summary', {
                    sort: segment.sort,
                    discount: segment.defaultDiscountPercent,
                    minSpent: segment.autoJoinCriteria.minSpent,
                    minOrders: segment.autoJoinCriteria.minOrders,
                  }) }}
                </p>
              </div>
              <div v-if="canWrite" class="flex items-center gap-1">
                <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="xs" @click="openSegmentEdit(segment)" />
                <UButton
                  :icon="segment.isDeleted ? 'i-lucide-rotate-ccw' : 'i-lucide-archive'"
                  :color="segment.isDeleted ? 'neutral' : 'error'"
                  variant="ghost"
                  size="xs"
                  @click="toggleSegment(segment)"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end">
          <UButton color="neutral" variant="ghost" :label="t('common.close')" @click="segmentsOpen = false" />
        </div>
      </template>
    </UModal>

    <!-- Segment create / edit -->
    <UModal
      v-model:open="segmentFormOpen"
      :title="segmentEditing ? t('admin.customerSegments.editTitle') : t('admin.customerSegments.createTitle')"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-lg' }"
    >
      <template #body>
        <div class="flex flex-col gap-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.customerSegments.fields.code')">
              <UInput v-model="segmentForm.code" class="w-full" :placeholder="t('admin.customerSegments.codePlaceholder')" />
            </UFormField>
            <UFormField :label="t('admin.customerSegments.fields.sort')">
              <UInput v-model.number="segmentForm.sort" type="number" min="0" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.customerSegments.fields.title')" class="sm:col-span-2">
              <UInput v-model="segmentForm.title" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.customerSegments.fields.description')" class="sm:col-span-2">
              <UTextarea v-model="segmentForm.description" :rows="2" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.customerSegments.fields.discount')">
              <UInput v-model.number="segmentForm.defaultDiscountPercent" type="number" min="0" max="100" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.customerSegments.fields.minSpent')">
              <UInput v-model.number="segmentForm.minSpent" type="number" min="0" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.customerSegments.fields.minOrders')">
              <UInput v-model.number="segmentForm.minOrders" type="number" min="0" class="w-full" />
            </UFormField>
          </div>
          <div class="flex flex-wrap items-center gap-4">
            <USwitch v-model="segmentForm.freeShipping" size="sm" :label="t('admin.customerSegments.fields.freeShipping')" />
            <USwitch v-model="segmentForm.isActive" size="sm" :label="t('admin.customerSegments.fields.active')" />
          </div>
          <p class="text-xs text-muted">{{ t('admin.customerSegments.autoJoinHint') }}</p>
          <AuditReasonField v-model="auditReason" />
          <p v-if="segmentError" class="text-xs text-error">{{ segmentError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="segmentFormOpen = false" />
          <UButton color="primary" variant="soft" :loading="segmentSaving" :label="t('common.save')" @click="submitSegment" />
        </div>
      </template>
    </UModal>

    <CmsImportDialog
      v-model:open="importOpen"
      :title="t('admin.import.title')"
      :hint="t('admin.import.hint')"
      :example="importExample"
      :busy="importBusy"
      :error="importError"
      :result="importResult"
      @submit="runImport"
    />
  </div>
</template>
