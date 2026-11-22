<script setup lang="ts">
import type { AdminOrder, AdminOrderItem, AdminOrderReturn, AdminShipment } from '../composables/useOperationsAdmin'

const { t } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const {
  listOrders,
  createOrder,
  updateOrder,
  deleteOrder,
  restoreOrder,
  listShipments,
  createShipment,
  updateShipment,
  deleteShipment,
  listOrderReturns,
  createOrderReturn,
  updateOrderReturn,
  deleteOrderReturn,
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
  SHIPMENT_QUANTITY_EXCEEDS_REMAINING: 'admin.orders.errors.shipmentExceeds',
  ORDER_RETURN_QUANTITY_EXCEEDS_REMAINING: 'admin.orders.errors.returnExceeds',
  SHIPMENT_ITEM_NOT_IN_ORDER: 'admin.orders.errors.invalid',
  ORDER_RETURN_ITEM_NOT_IN_ORDER: 'admin.orders.errors.invalid',
  SHIPMENT_CODE_EXISTS: 'admin.orders.errors.codeExists',
  SHIPMENT_REVISION_CONFLICT: 'admin.orders.errors.conflict',
  SHIPMENT_NOT_FOUND: 'admin.orders.errors.notFound',
  ORDER_RETURN_CODE_EXISTS: 'admin.orders.errors.codeExists',
  ORDER_RETURN_REVISION_CONFLICT: 'admin.orders.errors.conflict',
  ORDER_RETURN_NOT_FOUND: 'admin.orders.errors.notFound',
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

/* ---------------------------- fulfillment ------------------------------ */

const SHIPMENT_STATUSES = ['draft', 'shipped', 'in_transit', 'delivered', 'returned', 'cancelled'] as const
const RETURN_STATUSES = ['draft', 'approved', 'refunded', 'cancelled'] as const
const REFUND_METHODS = ['cash', 'card', 'bank', 'credit'] as const

const fulfillOpen = ref(false)
const fulfillOrder = ref<AdminOrder | null>(null)
const fulfillTab = ref<'shipments' | 'returns'>('shipments')
const shipments = ref<AdminShipment[]>([])
const returns = ref<AdminOrderReturn[]>([])
const fulfillLoading = ref(false)
const fulfillError = ref<string | null>(null)

const shippedByKey = computed(() => {
  const map = new Map<string, number>()
  for (const shipment of shipments.value) {
    if (shipment.status === 'cancelled') continue
    for (const line of shipment.items ?? []) {
      const key = `${line.itemId ?? ''}::${line.variantId ?? ''}`
      map.set(key, (map.get(key) ?? 0) + (line.quantity ?? 0))
    }
  }
  return map
})

const shipmentStatusItems = computed<{ label: string, value: string }[]>(() =>
  SHIPMENT_STATUSES.map(status => ({ label: t(`admin.orders.shipments.statuses.${status}`), value: status })),
)
const returnStatusItems = computed<{ label: string, value: string }[]>(() =>
  RETURN_STATUSES.map(status => ({ label: t(`admin.orders.returns.statuses.${status}`), value: status })),
)
const refundMethodItems = computed<{ label: string, value: string }[]>(() =>
  REFUND_METHODS.map(method => ({ label: t(`admin.orders.returns.methods.${method}`), value: method })),
)

const shipmentStatusColor = (status: string) => {
  if (status === 'delivered') return 'success'
  if (status === 'cancelled') return 'error'
  if (status === 'shipped' || status === 'in_transit') return 'primary'
  return 'neutral'
}

const returnStatusColor = (status: string) => {
  if (status === 'refunded') return 'success'
  if (status === 'cancelled') return 'error'
  if (status === 'approved') return 'primary'
  return 'neutral'
}

async function refreshFulfillment() {
  if (!fulfillOrder.value) return
  fulfillLoading.value = true
  fulfillError.value = null
  try {
    const [shipmentPage, returnPage] = await Promise.all([
      listShipments({ orderId: fulfillOrder.value.id }),
      listOrderReturns({ orderId: fulfillOrder.value.id }),
    ])
    shipments.value = shipmentPage.data
    returns.value = returnPage.data
  } catch (e) {
    fulfillError.value = describeError(e)
  } finally {
    fulfillLoading.value = false
  }
}

async function openFulfillment(order: AdminOrder, tab: 'shipments' | 'returns') {
  fulfillOrder.value = order
  fulfillTab.value = tab
  shipments.value = []
  returns.value = []
  fulfillOpen.value = true
  await refreshFulfillment()
}

/* ---------------------------- shipments -------------------------------- */

const shipmentFormOpen = ref(false)
const shipmentSaving = ref(false)
const shipmentError = ref<string | null>(null)
const shipmentForm = reactive({
  carrier: '',
  trackingNumber: '',
  status: 'shipped',
  note: '',
  lines: [] as { itemId: string | null, variantId: string | null, itemName: string, sku: string, quantity: number, remaining: number }[],
})

function openShipmentCreate() {
  const order = fulfillOrder.value
  if (!order) return
  shipmentForm.carrier = ''
  shipmentForm.trackingNumber = ''
  shipmentForm.status = 'shipped'
  shipmentForm.note = ''
  shipmentForm.lines = order.items
    .map((item) => {
      const key = `${item.itemId ?? ''}::${item.variantId ?? ''}`
      const remaining = Math.max(0, item.quantity - (item.returnedQuantity ?? 0) - (shippedByKey.value.get(key) ?? 0))
      return { itemId: item.itemId, variantId: item.variantId, itemName: item.itemName, sku: item.sku, quantity: remaining, remaining }
    })
    .filter(line => line.remaining > 0)
  auditReason.value = ''
  shipmentError.value = null
  shipmentFormOpen.value = true
}

async function submitShipment() {
  if (shipmentSaving.value || !fulfillOrder.value) return
  const lines = shipmentForm.lines.filter(line => Number(line.quantity) > 0)
  if (!lines.length) {
    shipmentError.value = t('admin.orders.errors.shipmentLinesEmpty')
    return
  }
  shipmentSaving.value = true
  shipmentError.value = null
  try {
    await createShipment({
      code: `SHP-${Date.now().toString(36).toUpperCase()}`,
      orderId: fulfillOrder.value.id,
      status: shipmentForm.status,
      carrier: shipmentForm.carrier,
      trackingNumber: shipmentForm.trackingNumber,
      note: shipmentForm.note,
      shippingAddress: fulfillOrder.value.shippingAddress,
      items: lines.map(line => ({
        itemId: line.itemId,
        variantId: line.variantId,
        itemName: line.itemName,
        sku: line.sku,
        quantity: Number(line.quantity),
      })),
    }, auditReason.value.trim() || undefined)
    toast.add({ title: t('admin.orders.shipments.created'), color: 'success' })
    shipmentFormOpen.value = false
    await Promise.all([refreshFulfillment(), load()])
  } catch (e) {
    shipmentError.value = describeError(e)
  } finally {
    shipmentSaving.value = false
  }
}

const shipmentEditOpen = ref(false)
const shipmentEditSaving = ref(false)
const shipmentEditError = ref<string | null>(null)
const shipmentEditing = ref<AdminShipment | null>(null)
const shipmentEditForm = reactive({ status: 'draft', carrier: '', trackingNumber: '', note: '' })

function openShipmentEdit(shipment: AdminShipment) {
  shipmentEditing.value = shipment
  shipmentEditForm.status = shipment.status
  shipmentEditForm.carrier = shipment.carrier
  shipmentEditForm.trackingNumber = shipment.trackingNumber
  shipmentEditForm.note = shipment.note
  auditReason.value = ''
  shipmentEditError.value = null
  shipmentEditOpen.value = true
}

async function submitShipmentEdit() {
  if (shipmentEditSaving.value || !shipmentEditing.value) return
  shipmentEditSaving.value = true
  shipmentEditError.value = null
  try {
    await updateShipment(shipmentEditing.value.id, {
      revision: shipmentEditing.value.revision,
      status: shipmentEditForm.status,
      carrier: shipmentEditForm.carrier,
      trackingNumber: shipmentEditForm.trackingNumber,
      note: shipmentEditForm.note,
    }, auditReason.value.trim() || undefined)
    toast.add({ title: t('admin.orders.shipments.updated'), color: 'success' })
    shipmentEditOpen.value = false
    await Promise.all([refreshFulfillment(), load()])
  } catch (e) {
    shipmentEditError.value = describeError(e)
  } finally {
    shipmentEditSaving.value = false
  }
}

async function setShipmentStatus(shipment: AdminShipment, status: string) {
  try {
    await updateShipment(shipment.id, { revision: shipment.revision, status })
    toast.add({ title: t('admin.orders.shipments.updated'), color: 'success' })
    await Promise.all([refreshFulfillment(), load()])
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
  }
}

/* ------------------------------ returns --------------------------------- */

const returnFormOpen = ref(false)
const returnSaving = ref(false)
const returnError = ref<string | null>(null)
const returnForm = reactive({
  status: 'draft',
  refundAmount: 0,
  refundMethod: 'cash',
  note: '',
  lines: [] as { itemId: string | null, variantId: string | null, itemName: string, sku: string, unitPrice: number, quantity: number, remaining: number }[],
})

function openReturnCreate() {
  const order = fulfillOrder.value
  if (!order) return
  returnForm.status = 'draft'
  returnForm.refundAmount = 0
  returnForm.refundMethod = 'cash'
  returnForm.note = ''
  returnForm.lines = order.items.map(item => ({
    itemId: item.itemId,
    variantId: item.variantId,
    itemName: item.itemName,
    sku: item.sku,
    unitPrice: item.price,
    quantity: 0,
    remaining: Math.max(0, item.quantity - (item.returnedQuantity ?? 0)),
  })).filter(line => line.remaining > 0)
  auditReason.value = ''
  returnError.value = null
  returnFormOpen.value = true
}

async function submitReturn() {
  if (returnSaving.value || !fulfillOrder.value) return
  const lines = returnForm.lines.filter(line => Number(line.quantity) > 0)
  if (!lines.length) {
    returnError.value = t('admin.orders.errors.returnLinesEmpty')
    return
  }
  returnSaving.value = true
  returnError.value = null
  try {
    await createOrderReturn({
      code: `RTN-${Date.now().toString(36).toUpperCase()}`,
      orderId: fulfillOrder.value.id,
      status: returnForm.status,
      refundAmount: Number(returnForm.refundAmount) || 0,
      refundMethod: returnForm.refundMethod,
      note: returnForm.note,
      items: lines.map(line => ({
        itemId: line.itemId,
        variantId: line.variantId,
        itemName: line.itemName,
        sku: line.sku,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice) || 0,
      })),
    }, auditReason.value.trim() || undefined)
    toast.add({ title: t('admin.orders.returns.created'), color: 'success' })
    returnFormOpen.value = false
    await Promise.all([refreshFulfillment(), load()])
  } catch (e) {
    returnError.value = describeError(e)
  } finally {
    returnSaving.value = false
  }
}

const returnEditOpen = ref(false)
const returnEditSaving = ref(false)
const returnEditError = ref<string | null>(null)
const returnEditing = ref<AdminOrderReturn | null>(null)
const returnEditForm = reactive({ status: 'draft', refundAmount: 0, refundMethod: 'cash', note: '' })

function openReturnEdit(record: AdminOrderReturn) {
  returnEditing.value = record
  returnEditForm.status = record.status
  returnEditForm.refundAmount = record.refundAmount
  returnEditForm.refundMethod = record.refundMethod
  returnEditForm.note = record.note
  auditReason.value = ''
  returnEditError.value = null
  returnEditOpen.value = true
}

async function submitReturnEdit() {
  if (returnEditSaving.value || !returnEditing.value) return
  returnEditSaving.value = true
  returnEditError.value = null
  try {
    await updateOrderReturn(returnEditing.value.id, {
      revision: returnEditing.value.revision,
      status: returnEditForm.status,
      refundAmount: Number(returnEditForm.refundAmount) || 0,
      refundMethod: returnEditForm.refundMethod,
      note: returnEditForm.note,
    }, auditReason.value.trim() || undefined)
    toast.add({ title: t('admin.orders.returns.updated'), color: 'success' })
    returnEditOpen.value = false
    await Promise.all([refreshFulfillment(), load()])
  } catch (e) {
    returnEditError.value = describeError(e)
  } finally {
    returnEditSaving.value = false
  }
}

async function setReturnStatus(record: AdminOrderReturn, status: string) {
  try {
    await updateOrderReturn(record.id, { revision: record.revision, status })
    toast.add({ title: t('admin.orders.returns.updated'), color: 'success' })
    await Promise.all([refreshFulfillment(), load()])
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
  }
}

/* --------------------- fulfillment delete confirm ----------------------- */

const fulfillConfirmOpen = ref(false)
const fulfillConfirmBusy = ref(false)
const fulfillConfirmError = ref<string | null>(null)
const fulfillConfirmKind = ref<'shipment' | 'return'>('shipment')
const fulfillConfirmShipment = ref<AdminShipment | null>(null)
const fulfillConfirmReturn = ref<AdminOrderReturn | null>(null)

function askDeleteShipment(shipment: AdminShipment) {
  fulfillConfirmKind.value = 'shipment'
  fulfillConfirmShipment.value = shipment
  fulfillConfirmReturn.value = null
  auditReason.value = ''
  fulfillConfirmError.value = null
  fulfillConfirmOpen.value = true
}

function askDeleteReturn(record: AdminOrderReturn) {
  fulfillConfirmKind.value = 'return'
  fulfillConfirmReturn.value = record
  fulfillConfirmShipment.value = null
  auditReason.value = ''
  fulfillConfirmError.value = null
  fulfillConfirmOpen.value = true
}

async function runFulfillConfirm() {
  if (fulfillConfirmBusy.value) return
  fulfillConfirmBusy.value = true
  fulfillConfirmError.value = null
  try {
    if (fulfillConfirmKind.value === 'shipment') {
      await deleteShipment(fulfillConfirmShipment.value!.id, fulfillConfirmShipment.value!.revision, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.orders.shipments.deleted'), color: 'success' })
    } else {
      await deleteOrderReturn(fulfillConfirmReturn.value!.id, fulfillConfirmReturn.value!.revision, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.orders.returns.deleted'), color: 'success' })
    }
    fulfillConfirmOpen.value = false
    await Promise.all([refreshFulfillment(), load()])
  } catch (e) {
    fulfillConfirmError.value = describeError(e)
  } finally {
    fulfillConfirmBusy.value = false
  }
}

if (canRead.value) await load()

resetOnClose(formOpen, confirmOpen, fulfillOpen, shipmentFormOpen, shipmentEditOpen, returnFormOpen, returnEditOpen, fulfillConfirmOpen)
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
                icon="i-lucide-truck"
                color="neutral"
                variant="ghost"
                size="xs"
                :title="t('admin.orders.fulfillment.tabs.shipments')"
                @click="openFulfillment(order, 'shipments')"
              />
              <UButton
                icon="i-lucide-undo-2"
                color="neutral"
                variant="ghost"
                size="xs"
                :title="t('admin.orders.fulfillment.tabs.returns')"
                @click="openFulfillment(order, 'returns')"
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

    <!-- Fulfillment: shipments and returns of one order -->
    <UModal
      v-model:open="fulfillOpen"
      :title="t('admin.orders.fulfillment.title', { code: fulfillOrder?.code || '' })"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-3xl' }"
    >
      <template #body>
        <div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto scroll-thin">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap gap-2">
              <UButton
                icon="i-lucide-truck"
                :label="t('admin.orders.fulfillment.tabs.shipments')"
                size="sm"
                :color="fulfillTab === 'shipments' ? 'primary' : 'neutral'"
                :variant="fulfillTab === 'shipments' ? 'soft' : 'ghost'"
                @click="fulfillTab = 'shipments'"
              />
              <UButton
                icon="i-lucide-undo-2"
                :label="t('admin.orders.fulfillment.tabs.returns')"
                size="sm"
                :color="fulfillTab === 'returns' ? 'primary' : 'neutral'"
                :variant="fulfillTab === 'returns' ? 'soft' : 'ghost'"
                @click="fulfillTab = 'returns'"
              />
            </div>
            <UButton
              v-if="canWrite"
              icon="i-lucide-plus"
              color="primary"
              variant="soft"
              size="sm"
              :label="fulfillTab === 'shipments' ? t('admin.orders.shipments.create') : t('admin.orders.returns.create')"
              @click="fulfillTab === 'shipments' ? openShipmentCreate() : openReturnCreate()"
            />
          </div>

          <p v-if="fulfillError" class="text-xs text-error">{{ fulfillError }}</p>
          <p v-else-if="fulfillLoading" class="text-xs text-muted">{{ t('common.loading') }}</p>

          <!-- Shipments -->
          <template v-else-if="fulfillTab === 'shipments'">
            <p v-if="!shipments.length" class="text-xs text-muted">{{ t('admin.orders.fulfillment.emptyShipments') }}</p>
            <div v-else class="overflow-hidden rounded-[4px] border border-default/60">
              <div v-for="shipment in shipments" :key="shipment.id" class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-mono text-xs font-medium text-highlighted">{{ shipment.code }}</span>
                    <UBadge :color="shipmentStatusColor(shipment.status)" variant="subtle" size="sm">
                      {{ t(`admin.orders.shipments.statuses.${shipment.status}`) }}
                    </UBadge>
                  </div>
                  <p class="mt-0.5 truncate text-xs text-muted">
                    <span v-if="shipment.carrier">{{ shipment.carrier }}</span>
                    <span v-if="shipment.trackingNumber"> · {{ shipment.trackingNumber }}</span>
                    <span> · {{ t('admin.orders.shipments.itemsCount', { count: shipment.items.length }) }}</span>
                    <span v-if="shipment.shippedAt"> · {{ new Date(shipment.shippedAt).toLocaleDateString() }}</span>
                  </p>
                </div>
                <div v-if="canWrite" class="flex items-center gap-1">
                  <UButton v-if="shipment.status === 'draft'" icon="i-lucide-truck" color="primary" variant="ghost" size="xs" :title="t('admin.orders.shipments.ship')" @click="setShipmentStatus(shipment, 'shipped')" />
                  <UButton v-if="shipment.status === 'shipped' || shipment.status === 'in_transit'" icon="i-lucide-package-check" color="primary" variant="ghost" size="xs" :title="t('admin.orders.shipments.deliver')" @click="setShipmentStatus(shipment, 'delivered')" />
                  <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="xs" :title="t('common.edit')" @click="openShipmentEdit(shipment)" />
                  <UButton v-if="shipment.status !== 'cancelled' && shipment.status !== 'delivered' && shipment.status !== 'returned'" icon="i-lucide-ban" color="error" variant="ghost" size="xs" :title="t('admin.orders.shipments.cancel')" @click="setShipmentStatus(shipment, 'cancelled')" />
                  <UButton icon="i-lucide-archive" color="error" variant="ghost" size="xs" :title="t('admin.orders.shipments.delete')" @click="askDeleteShipment(shipment)" />
                </div>
              </div>
            </div>
          </template>

          <!-- Returns -->
          <template v-else>
            <p v-if="!returns.length" class="text-xs text-muted">{{ t('admin.orders.fulfillment.emptyReturns') }}</p>
            <div v-else class="overflow-hidden rounded-[4px] border border-default/60">
              <div v-for="record in returns" :key="record.id" class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-mono text-xs font-medium text-highlighted">{{ record.code }}</span>
                    <UBadge :color="returnStatusColor(record.status)" variant="subtle" size="sm">
                      {{ t(`admin.orders.returns.statuses.${record.status}`) }}
                    </UBadge>
                  </div>
                  <p class="mt-0.5 truncate text-xs text-muted">
                    <span>{{ money(record.refundAmount) }}</span>
                    <span> · {{ t('admin.orders.returns.itemsCount', { count: record.items.length }) }}</span>
                    <span> · {{ t(`admin.orders.returns.methods.${record.refundMethod}`) }}</span>
                  </p>
                </div>
                <div v-if="canWrite" class="flex items-center gap-1">
                  <UButton v-if="record.status === 'draft'" icon="i-lucide-check" color="primary" variant="ghost" size="xs" :title="t('admin.orders.returns.approve')" @click="setReturnStatus(record, 'approved')" />
                  <UButton v-if="record.status === 'approved'" icon="i-lucide-banknote" color="primary" variant="ghost" size="xs" :title="t('admin.orders.returns.refund')" @click="setReturnStatus(record, 'refunded')" />
                  <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="xs" :title="t('common.edit')" @click="openReturnEdit(record)" />
                  <UButton v-if="record.status !== 'cancelled' && record.status !== 'refunded'" icon="i-lucide-ban" color="error" variant="ghost" size="xs" :title="t('admin.orders.returns.cancel')" @click="setReturnStatus(record, 'cancelled')" />
                  <UButton icon="i-lucide-archive" color="error" variant="ghost" size="xs" :title="t('admin.orders.returns.delete')" @click="askDeleteReturn(record)" />
                </div>
              </div>
            </div>
          </template>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end">
          <UButton color="neutral" variant="ghost" :label="t('common.close')" @click="fulfillOpen = false" />
        </div>
      </template>
    </UModal>

    <!-- Create shipment -->
    <UModal v-model:open="shipmentFormOpen" :title="t('admin.orders.shipments.createTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-2xl' }">
      <template #body>
        <div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto scroll-thin">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.orders.shipments.carrier')">
              <UInput v-model="shipmentForm.carrier" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.orders.shipments.tracking')">
              <UInput v-model="shipmentForm.trackingNumber" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.orders.shipments.status')">
              <USelect v-model="shipmentForm.status" :items="shipmentStatusItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.orders.shipments.note')">
              <UInput v-model="shipmentForm.note" class="w-full" />
            </UFormField>
          </div>

          <p class="text-sm font-medium text-highlighted">{{ t('admin.orders.shipments.lines') }}</p>
          <p v-if="!shipmentForm.lines.length" class="text-xs text-muted">{{ t('admin.orders.shipments.noLines') }}</p>
          <div v-for="(line, index) in shipmentForm.lines" :key="index" class="flex flex-wrap items-end gap-2 rounded-[4px] border border-default/60 p-2">
            <div class="min-w-40 flex-1">
              <p class="truncate text-sm font-medium text-highlighted">{{ line.itemName }}</p>
              <p class="text-xs text-muted">{{ line.sku || '—' }} · {{ t('admin.orders.shipments.remaining', { count: line.remaining }) }}</p>
            </div>
            <UFormField :label="t('admin.orders.fields.quantity')" class="w-24">
              <UInput v-model.number="line.quantity" type="number" min="0" :max="line.remaining" size="sm" class="w-full" />
            </UFormField>
          </div>

          <AuditReasonField v-model="auditReason" />
          <p v-if="shipmentError" class="text-xs text-error">{{ shipmentError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="shipmentFormOpen = false" />
          <UButton color="primary" variant="soft" :loading="shipmentSaving" :label="t('common.save')" @click="submitShipment" />
        </div>
      </template>
    </UModal>

    <!-- Edit shipment -->
    <UModal v-model:open="shipmentEditOpen" :title="t('admin.orders.shipments.editTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-lg' }">
      <template #body>
        <div class="flex flex-col gap-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.orders.shipments.status')">
              <USelect v-model="shipmentEditForm.status" :items="shipmentStatusItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.orders.shipments.carrier')">
              <UInput v-model="shipmentEditForm.carrier" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.orders.shipments.tracking')">
              <UInput v-model="shipmentEditForm.trackingNumber" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.orders.shipments.note')">
              <UInput v-model="shipmentEditForm.note" class="w-full" />
            </UFormField>
          </div>
          <p v-if="shipmentEditing" class="text-xs text-muted">{{ t('admin.orders.revision', { revision: shipmentEditing.revision }) }}</p>
          <AuditReasonField v-model="auditReason" />
          <p v-if="shipmentEditError" class="text-xs text-error">{{ shipmentEditError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="shipmentEditOpen = false" />
          <UButton color="primary" variant="soft" :loading="shipmentEditSaving" :label="t('common.save')" @click="submitShipmentEdit" />
        </div>
      </template>
    </UModal>

    <!-- Create return -->
    <UModal v-model:open="returnFormOpen" :title="t('admin.orders.returns.createTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-2xl' }">
      <template #body>
        <div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto scroll-thin">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.orders.returns.status')">
              <USelect v-model="returnForm.status" :items="returnStatusItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.orders.returns.refundMethod')">
              <USelect v-model="returnForm.refundMethod" :items="refundMethodItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.orders.returns.refundAmount')">
              <UInput v-model.number="returnForm.refundAmount" type="number" min="0" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.orders.returns.note')">
              <UInput v-model="returnForm.note" class="w-full" />
            </UFormField>
          </div>

          <p class="text-sm font-medium text-highlighted">{{ t('admin.orders.returns.lines') }}</p>
          <p v-if="!returnForm.lines.length" class="text-xs text-muted">{{ t('admin.orders.returns.noLines') }}</p>
          <div v-for="(line, index) in returnForm.lines" :key="index" class="flex flex-wrap items-end gap-2 rounded-[4px] border border-default/60 p-2">
            <div class="min-w-40 flex-1">
              <p class="truncate text-sm font-medium text-highlighted">{{ line.itemName }}</p>
              <p class="text-xs text-muted">{{ line.sku || '—' }} · {{ t('admin.orders.shipments.remaining', { count: line.remaining }) }}</p>
            </div>
            <UFormField :label="t('admin.orders.returns.quantity')" class="w-24">
              <UInput v-model.number="line.quantity" type="number" min="0" :max="line.remaining" size="sm" class="w-full" />
            </UFormField>
          </div>

          <AuditReasonField v-model="auditReason" />
          <p v-if="returnError" class="text-xs text-error">{{ returnError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="returnFormOpen = false" />
          <UButton color="primary" variant="soft" :loading="returnSaving" :label="t('common.save')" @click="submitReturn" />
        </div>
      </template>
    </UModal>

    <!-- Edit return -->
    <UModal v-model:open="returnEditOpen" :title="t('admin.orders.returns.editTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-lg' }">
      <template #body>
        <div class="flex flex-col gap-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.orders.returns.status')">
              <USelect v-model="returnEditForm.status" :items="returnStatusItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.orders.returns.refundMethod')">
              <USelect v-model="returnEditForm.refundMethod" :items="refundMethodItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.orders.returns.refundAmount')">
              <UInput v-model.number="returnEditForm.refundAmount" type="number" min="0" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.orders.returns.note')">
              <UInput v-model="returnEditForm.note" class="w-full" />
            </UFormField>
          </div>
          <p v-if="returnEditing" class="text-xs text-muted">{{ t('admin.orders.revision', { revision: returnEditing.revision }) }}</p>
          <AuditReasonField v-model="auditReason" />
          <p v-if="returnEditError" class="text-xs text-error">{{ returnEditError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="returnEditOpen = false" />
          <UButton color="primary" variant="soft" :loading="returnEditSaving" :label="t('common.save')" @click="submitReturnEdit" />
        </div>
      </template>
    </UModal>

    <!-- Delete shipment / return -->
    <UModal
      v-model:open="fulfillConfirmOpen"
      :title="fulfillConfirmKind === 'shipment' ? t('admin.orders.shipments.delete')
        : t('admin.orders.returns.delete')"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }"
    >
      <template #body>
        <div class="flex flex-col gap-3">
          <p class="text-sm text-toned">
            {{ fulfillConfirmKind === 'shipment'
              ? t('admin.orders.shipments.deleteHint', { code: fulfillConfirmShipment?.code || '' })
              : t('admin.orders.returns.deleteHint', { code: fulfillConfirmReturn?.code || '' }) }}
          </p>
          <AuditReasonField v-model="auditReason" />
          <p v-if="fulfillConfirmError" class="text-xs text-error">{{ fulfillConfirmError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="fulfillConfirmOpen = false" />
          <UButton color="error" variant="soft" :loading="fulfillConfirmBusy" :label="t('admin.orders.shipments.delete')" @click="runFulfillConfirm" />
        </div>
      </template>
    </UModal>
  </div>
</template>
