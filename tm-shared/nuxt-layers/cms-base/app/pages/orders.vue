<script setup lang="ts">
import type { AdminOrder, AdminOrderItem } from '../composables/useOperationsAdmin'

const { t } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const {
  listOrders,
  createOrder,
  updateOrder,
  deleteOrder,
  restoreOrder,
  listItemOptions,
  errorCode,
} = useOperationsAdmin()

const canRead = computed(() => hasCapability('content.read'))
const canWrite = computed(() => hasCapability('content.write'))

const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'completed', 'cancelled'] as const
const PAYMENT_METHODS = ['cash', 'banking', 'cod', 'card', 'other'] as const

const loading = ref(false)
const error = ref<string | null>(null)
const orders = ref<AdminOrder[]>([])
const query = ref('')
const statusFilter = ref('all')
const includeDeleted = ref(false)
const nextCursor = ref<string | null>(null)
const hasMore = ref(false)
const counts = ref({ all: 0, active: 0, deleted: 0 })

const { reason: auditReason, resetOnClose } = useAuditReason()

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)} ₫`

const statusOptions = computed(() => [
  { label: t('admin.orders.allStatuses'), value: 'all' },
  ...ORDER_STATUSES.map(status => ({ label: t(`admin.orders.statuses.${status}`), value: status })),
])

const orderStatusItems = computed<{ label: string, value: string }[]>(() =>
  ORDER_STATUSES.map(status => ({ label: t(`admin.orders.statuses.${status}`), value: status })),
)
const paymentMethodItems = computed<{ label: string, value: string }[]>(() =>
  PAYMENT_METHODS.map(method => ({ label: t(`admin.orders.paymentMethods.${method}`), value: method })),
)

const statusColor = (status: string) => {
  if (status === 'completed') return 'success'
  if (status === 'cancelled') return 'error'
  if (status === 'shipped') return 'primary'
  if (status === 'processing') return 'warning'
  return 'neutral'
}

const errorMessages: Record<string, string> = {
  ORDER_PAYLOAD_INVALID: 'admin.orders.errors.invalid',
  ORDER_ID_INVALID: 'admin.orders.errors.invalid',
  ORDER_NOT_FOUND: 'admin.orders.errors.notFound',
  ORDER_DELETED: 'admin.orders.errors.deleted',
  ORDER_LOCKED: 'admin.orders.errors.locked',
  ORDER_REVISION_REQUIRED: 'admin.orders.errors.revisionRequired',
  ORDER_REVISION_CONFLICT: 'admin.orders.errors.conflict',
  ORDER_CUSTOMER_NOT_FOUND: 'admin.orders.errors.customerMissing',
  ORDER_CODE_EXISTS: 'admin.orders.errors.codeExists',
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

async function load(reset = true) {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const page = await listOrders({
      q: query.value.trim() || undefined,
      status: statusFilter.value === 'all' ? undefined : statusFilter.value,
      includeDeleted: includeDeleted.value,
      cursor: reset ? null : nextCursor.value,
    })
    orders.value = reset ? page.data : [...orders.value, ...page.data]
    nextCursor.value = page.nextCursor
    hasMore.value = page.hasMore
    counts.value = { ...counts.value, ...page.counts }
  } catch (e) {
    error.value = describeError(e)
  } finally {
    loading.value = false
  }
}

watchDebounced(query, () => load(), { debounce: 300 })
watch([statusFilter, includeDeleted], () => load())

/* ------------------------------ item picker ----------------------------- */

const itemOptions = ref<{ label: string, value: string }[]>([])
const pickerItems = ref<{ id: string, key: string, sku: string, title: Record<string, string>, basePrice: number, salePrice: number | null }[]>([])
const pickedItem = ref('')

async function searchItems(term: string) {
  try {
    pickerItems.value = await listItemOptions(term)
    itemOptions.value = pickerItems.value.map(item => ({
      label: `${item.title.vi || item.title.en || item.key}${item.sku ? ` · ${item.sku}` : ''}`,
      value: item.id,
    }))
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
  }
}

/* ------------------------------- order form ----------------------------- */

const formOpen = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)
const editing = ref<AdminOrder | null>(null)

const form = reactive({
  code: '',
  status: 'pending',
  paymentMethod: 'cash',
  shippingFee: 0,
  discountAmount: 0,
  paidAmount: 0,
  note: '',
  address: { fullName: '', phone: '', street: '', ward: '', district: '', city: '', country: '' },
  items: [] as AdminOrderItem[],
})

const draftTotal = computed(() => form.items.reduce((sum, item) => sum + item.price * item.quantity, 0) + Number(form.shippingFee || 0) - Number(form.discountAmount || 0))

function resetForm() {
  form.code = ''
  form.status = 'pending'
  form.paymentMethod = 'cash'
  form.shippingFee = 0
  form.discountAmount = 0
  form.paidAmount = 0
  form.note = ''
  form.address = { fullName: '', phone: '', street: '', ward: '', district: '', city: '', country: '' }
  form.items = []
  pickedItem.value = ''
  auditReason.value = ''
  formError.value = null
}

function openCreate() {
  editing.value = null
  resetForm()
  void searchItems('')
  formOpen.value = true
}

function openEdit(order: AdminOrder) {
  editing.value = order
  form.code = order.code
  form.status = order.status
  form.paymentMethod = order.paymentMethod
  form.shippingFee = order.shippingFee
  form.discountAmount = order.discountAmount
  form.paidAmount = order.paidAmount
  form.note = order.note
  form.address = { ...form.address, ...order.shippingAddress }
  form.items = order.items.map(item => ({ ...item }))
  auditReason.value = ''
  formError.value = null
  formOpen.value = true
}

function addItem() {
  const item = pickerItems.value.find(entry => entry.id === pickedItem.value)
  if (!item) return
  form.items.push({
    itemId: item.id,
    variantId: null,
    supplierId: null,
    itemName: item.title.vi || item.title.en || item.key,
    sku: item.sku,
    attributes: {},
    price: item.salePrice ?? item.basePrice,
    quantity: 1,
    thumbnail: null,
    returnedQuantity: 0,
  })
  pickedItem.value = ''
}

async function submitForm() {
  if (!canWrite.value || saving.value) return
  if (!form.items.length) {
    formError.value = t('admin.orders.errors.itemsRequired')
    return
  }

  saving.value = true
  formError.value = null
  try {
    if (editing.value) {
      await updateOrder(editing.value.id, {
        revision: editing.value.revision,
        status: form.status,
        paymentMethod: form.paymentMethod,
        shippingFee: Number(form.shippingFee) || 0,
        discountAmount: Number(form.discountAmount) || 0,
        paidAmount: Number(form.paidAmount) || 0,
        note: form.note,
      }, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.orders.updated'), color: 'success' })
    } else {
      await createOrder({
        code: form.code.trim() || undefined,
        status: form.status,
        paymentMethod: form.paymentMethod,
        shippingFee: Number(form.shippingFee) || 0,
        discountAmount: Number(form.discountAmount) || 0,
        paidAmount: Number(form.paidAmount) || 0,
        note: form.note,
        shippingAddress: form.address,
        items: form.items.map(item => ({
          itemId: item.itemId,
          variantId: item.variantId,
          supplierId: item.supplierId,
          itemName: item.itemName,
          sku: item.sku,
          attributes: item.attributes,
          price: Number(item.price) || 0,
          quantity: Number(item.quantity) || 1,
          thumbnail: item.thumbnail,
        })),
      }, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.orders.created'), color: 'success' })
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
const confirmTarget = ref<AdminOrder | null>(null)
const confirmMode = ref<'delete' | 'restore'>('delete')

function askRemove(order: AdminOrder, mode: 'delete' | 'restore') {
  confirmTarget.value = order
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
      await deleteOrder(confirmTarget.value.id, confirmTarget.value.revision, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.orders.hidden'), color: 'success' })
    } else {
      await restoreOrder(confirmTarget.value.id, confirmTarget.value.revision, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.orders.restored'), color: 'success' })
    }
    confirmOpen.value = false
    await load()
  } catch (e) {
    confirmError.value = describeError(e)
  } finally {
    confirmBusy.value = false
  }
}

if (canRead.value) await load()

resetOnClose(formOpen, confirmOpen)
</script>

<template>
  <div>
    <CmsBasePage
      :title="t('admin.orders.title')"
      :description="t('admin.orders.description')"
      :loading="loading && !orders.length"
      :error="error"
      :empty="canRead && !loading && !orders.length"
      :empty-text="canRead
        ? (query || statusFilter !== 'all' || includeDeleted ? t('admin.orders.noMatch') : t('admin.orders.empty'))
        : t('admin.orders.permissionDenied')"
      empty-icon="i-lucide-shopping-cart"
    >
      <template #right>
        <UButton
          v-if="canWrite"
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          size="sm"
          :label="t('admin.orders.create')"
          @click="openCreate"
        />
      </template>

      <div v-if="canRead" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-3">
          <UInput
            v-model="query"
            icon="i-lucide-search"
            size="sm"
            class="w-full sm:w-64"
            :placeholder="t('admin.orders.searchPlaceholder')"
          />
          <USelect
            v-model="statusFilter"
            :items="statusOptions"
            value-key="value"
            size="sm"
            class="w-full sm:w-48"
          />
          <USwitch v-model="includeDeleted" size="sm" :label="t('admin.orders.includeDeleted')" />
          <p class="text-xs text-muted">
            {{ t('admin.orders.summary', { all: counts.all, active: counts.active, deleted: counts.deleted }) }}
          </p>
        </div>

        <div v-if="orders.length" class="overflow-hidden rounded-[4px] border border-default/60">
          <div
            v-for="order in orders"
            :key="order.id"
            class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0"
          >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-xs font-medium text-highlighted">{{ order.code }}</span>
                <UBadge :color="statusColor(order.status)" variant="subtle" size="sm">
                  {{ t(`admin.orders.statuses.${order.status}`) }}
                </UBadge>
                <UBadge color="neutral" variant="subtle" size="sm">
                  {{ t(`admin.orders.paymentStatuses.${order.paymentStatus}`) }}
                </UBadge>
                <UBadge v-if="order.isDeleted" color="error" variant="subtle" size="sm">
                  {{ t('admin.orders.badgeHidden') }}
                </UBadge>
              </div>
              <p class="mt-0.5 truncate text-xs text-muted">
                <span>{{ money(order.totalAmount) }}</span>
                <span> · {{ t('admin.orders.itemsCount', { count: order.items.length }) }}</span>
                <span v-if="order.shippingAddress.fullName"> · {{ order.shippingAddress.fullName }}</span>
                <span v-if="order.createdAt"> · {{ new Date(order.createdAt).toLocaleString() }}</span>
              </p>
            </div>

            <div v-if="canWrite" class="flex items-center gap-1">
              <UButton
                icon="i-lucide-pencil"
                color="neutral"
                variant="ghost"
                size="xs"
                :title="t('common.edit')"
                @click="openEdit(order)"
              />
              <UButton
                v-if="order.isDeleted"
                icon="i-lucide-rotate-ccw"
                color="neutral"
                variant="ghost"
                size="xs"
                :title="t('admin.orders.restore')"
                @click="askRemove(order, 'restore')"
              />
              <UButton
                v-else
                icon="i-lucide-archive"
                color="error"
                variant="ghost"
                size="xs"
                :title="t('admin.orders.hide')"
                @click="askRemove(order, 'delete')"
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
            :label="t('admin.orders.loadMore')"
            @click="load(false)"
          />
        </div>
      </div>
    </CmsBasePage>

    <!-- Create / edit order -->
    <UModal
      v-model:open="formOpen"
      :title="editing ? t('admin.orders.editTitle') : t('admin.orders.createTitle')"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-3xl' }"
    >
      <template #body>
        <div class="flex max-h-[70vh] flex-col gap-4 overflow-y-auto scroll-thin">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.orders.fields.code')">
              <UInput v-model="form.code" class="w-full" :disabled="Boolean(editing)" :placeholder="t('admin.orders.codePlaceholder')" />
            </UFormField>
            <UFormField :label="t('admin.orders.fields.status')">
              <USelect v-model="form.status" :items="orderStatusItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.orders.fields.paymentMethod')">
              <USelect v-model="form.paymentMethod" :items="paymentMethodItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.orders.fields.paidAmount')">
              <UInput v-model.number="form.paidAmount" type="number" min="0" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.orders.fields.shippingFee')">
              <UInput v-model.number="form.shippingFee" type="number" min="0" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.orders.fields.discount')">
              <UInput v-model.number="form.discountAmount" type="number" min="0" class="w-full" />
            </UFormField>
          </div>

          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium text-highlighted">{{ t('admin.orders.fields.items') }}</p>
              <p class="text-xs text-muted">{{ t('admin.orders.draftTotal', { total: money(draftTotal) }) }}</p>
            </div>

            <div v-if="!editing" class="flex flex-wrap items-end gap-2">
              <USelectMenu
                v-model="pickedItem"
                :items="itemOptions"
                value-key="value"
                searchable
                class="min-w-56 flex-1"
                :placeholder="t('admin.orders.fields.pickItem')"
                @update:search-term="searchItems"
              />
              <UButton
                icon="i-lucide-plus"
                color="neutral"
                variant="soft"
                size="sm"
                :label="t('admin.orders.fields.addItem')"
                :disabled="!pickedItem"
                @click="addItem"
              />
            </div>

            <p v-if="!form.items.length" class="text-xs text-muted">{{ t('admin.orders.fields.noItems') }}</p>

            <div v-for="(item, index) in form.items" :key="index" class="flex flex-wrap items-end gap-2 rounded-[4px] border border-default/60 p-2">
              <div class="min-w-40 flex-1">
                <p class="truncate text-sm font-medium text-highlighted">{{ item.itemName }}</p>
                <p class="text-xs text-muted">{{ item.sku || '—' }}</p>
              </div>
              <UFormField :label="t('admin.orders.fields.price')" class="w-28">
                <UInput v-model.number="item.price" type="number" min="0" size="sm" class="w-full" :disabled="Boolean(editing)" />
              </UFormField>
              <UFormField :label="t('admin.orders.fields.quantity')" class="w-20">
                <UInput v-model.number="item.quantity" type="number" min="1" size="sm" class="w-full" :disabled="Boolean(editing)" />
              </UFormField>
              <UButton
                v-if="!editing"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                :title="t('admin.orders.fields.removeItem')"
                @click="form.items.splice(index, 1)"
              />
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.orders.fields.address.fullName')">
              <UInput v-model="form.address.fullName" class="w-full" :disabled="Boolean(editing)" />
            </UFormField>
            <UFormField :label="t('admin.orders.fields.address.phone')">
              <UInput v-model="form.address.phone" class="w-full" :disabled="Boolean(editing)" />
            </UFormField>
            <UFormField :label="t('admin.orders.fields.address.street')" class="sm:col-span-2">
              <UInput v-model="form.address.street" class="w-full" :disabled="Boolean(editing)" />
            </UFormField>
            <UFormField :label="t('admin.orders.fields.address.city')">
              <UInput v-model="form.address.city" class="w-full" :disabled="Boolean(editing)" />
            </UFormField>
            <UFormField :label="t('admin.orders.fields.note')">
              <UInput v-model="form.note" class="w-full" />
            </UFormField>
          </div>

          <div v-if="editing" class="flex flex-col gap-2">
            <p class="text-sm font-medium text-highlighted">{{ t('admin.orders.history') }}</p>
            <p v-if="!editing.history.length" class="text-xs text-muted">{{ t('admin.orders.noHistory') }}</p>
            <div v-else class="flex flex-col gap-1">
              <div v-for="(entry, index) in editing.history" :key="index" class="flex flex-wrap items-center gap-2 text-xs text-muted">
                <UBadge color="neutral" variant="subtle" size="sm">{{ t(`admin.orders.statuses.${entry.status}`) }}</UBadge>
                <span>{{ entry.at ? new Date(entry.at).toLocaleString() : '' }}</span>
                <span v-if="entry.note">· {{ entry.note }}</span>
              </div>
            </div>
            <p class="text-xs text-muted">{{ t('admin.orders.revision', { revision: editing.revision }) }}</p>
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

    <!-- Hide / restore -->
    <UModal
      v-model:open="confirmOpen"
      :title="confirmMode === 'delete' ? t('admin.orders.hideTitle') : t('admin.orders.restoreTitle')"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }"
    >
      <template #body>
        <div class="flex flex-col gap-3">
          <p class="text-sm text-toned">
            {{ confirmMode === 'delete'
              ? t('admin.orders.hideHint', { code: confirmTarget?.code || '' })
              : t('admin.orders.restoreHint', { code: confirmTarget?.code || '' }) }}
          </p>
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
            :label="confirmMode === 'delete' ? t('admin.orders.hide') : t('admin.orders.restore')"
            @click="confirmAction"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
