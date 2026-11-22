<script setup lang="ts">
import type { AdminPurchaseOrder, AdminSupplier, AdminWarehouse, SupplierItemPrice } from '../composables/useOperationsAdmin'
import type { ImportOutcome } from '../utils/import-rows'

const { t } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const ops = useOperationsAdmin()

const canRead = computed(() => hasCapability('content.read'))
const canWrite = computed(() => hasCapability('content.write'))

type Tab = 'suppliers' | 'orders' | 'prices'
const tab = ref<Tab>('suppliers')

const { reason: auditReason, resetOnClose } = useAuditReason()

const money = (value: number) => new Intl.NumberFormat('vi-VN').format(value)

const describeError = (e: unknown) => {
  const code = ops.errorCode(e) ?? ''
  if (/_REVISION_CONFLICT$/.test(code)) return t('admin.purchasing.errors.conflict')
  if (/_REVISION_REQUIRED$/.test(code)) return t('admin.purchasing.errors.revisionRequired')
  if (/_NOT_FOUND$/.test(code)) return t('admin.purchasing.errors.notFound')
  if (/_CODE_EXISTS$/.test(code)) return t('admin.purchasing.errors.codeExists')
  if (/_LOCKED$|_RECEIPT_EXCEEDS_ORDER$|_RECEIPT_REGRESSION$/.test(code)) return t('admin.purchasing.errors.locked')
  if (/_SUPPLIER_DELETED$/.test(code)) return t('admin.purchasing.errors.supplierDeleted')
  if (/_SUPPLIER_NOT_FOUND$/.test(code)) return t('admin.purchasing.errors.supplierNotFound')
  if (/_RECEIPT_TARGET_MISSING$/.test(code)) return t('admin.purchasing.errors.receiptTarget')
  if (/_RECEIPT_STOCK_FAILED$/.test(code)) return t('admin.purchasing.errors.receiptStock')
  if (/_PAYLOAD_INVALID$|_INVALID$|_ITEM_UNKNOWN$/.test(code)) return t('admin.purchasing.errors.invalid')
  const status = (e as { statusCode?: number, status?: number })?.statusCode ?? (e as { status?: number })?.status
  if (status === 401) return t('admin.errors.unauthorized')
  if (status === 403) return t('admin.errors.forbidden')
  if (status === 404) return t('admin.errors.notFound')
  if (!status) return t('admin.errors.network')
  if (status === 503) return t('admin.errors.unavailable')
  return t('admin.errors.generic')
}

/* ------------------------------- import -------------------------------- */

const importOpen = ref(false)
const importBusy = ref(false)
const importError = ref<string | null>(null)
const importResult = ref<ImportOutcome | null>(null)
const importExample = 'code,title,email,phone\nNCC-01,Nhà cung cấp 01,ncc1@example.com,0900000001'

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
    const result = await ops.importSuppliers(payload.rows, payload.reason || undefined)
    importResult.value = result
    toast.add({
      title: t('admin.import.result', { created: result.created, updated: result.updated, failed: result.failed }),
      color: result.failed ? 'warning' : 'success',
    })
    if (!result.failed) auditReason.value = ''
    await loadSuppliers()
  } catch (caught) {
    importError.value = describeError(caught)
  } finally {
    importBusy.value = false
  }
}

const statusColor = (status: string) => {
  if (status === 'received') return 'success'
  if (status === 'cancelled' || status === 'inactive') return 'error'
  if (status === 'partial' || status === 'ordered') return 'primary'
  return 'neutral'
}

/* ------------------------------- suppliers ------------------------------- */

const suppliers = ref<AdminSupplier[]>([])
const supplierQuery = ref('')
const supplierStatus = ref('all')
const supplierIncludeDeleted = ref(false)
const supplierCounts = ref({ all: 0, active: 0, inactive: 0, deleted: 0 })
const supplierCursor = ref<string | null>(null)
const supplierHasMore = ref(false)
const supplierLoading = ref(false)
const supplierListError = ref<string | null>(null)

const supplierStatusOptions = computed(() => [
  { label: t('admin.purchasing.suppliers.allStatuses'), value: 'all' },
  { label: t('admin.purchasing.suppliers.statuses.active'), value: 'active' },
  { label: t('admin.purchasing.suppliers.statuses.inactive'), value: 'inactive' },
])

async function loadSuppliers(reset = true) {
  if (!canRead.value) return
  supplierLoading.value = true
  supplierListError.value = null
  try {
    const page = await ops.listSuppliers({
      q: supplierQuery.value.trim() || undefined,
      status: supplierStatus.value === 'all' ? undefined : supplierStatus.value,
      includeDeleted: supplierIncludeDeleted.value,
      cursor: reset ? null : supplierCursor.value,
      limit: 50,
    })
    suppliers.value = reset ? page.data : [...suppliers.value, ...page.data]
    supplierCursor.value = page.nextCursor
    supplierHasMore.value = page.hasMore
    supplierCounts.value = { ...supplierCounts.value, ...page.counts }
  } catch (e) {
    supplierListError.value = describeError(e)
  } finally {
    supplierLoading.value = false
  }
}

watchDebounced(supplierQuery, () => loadSuppliers(), { debounce: 300 })
watch([supplierStatus, supplierIncludeDeleted], () => loadSuppliers())

const supplierName = (id: string | null | undefined) =>
  suppliers.value.find(supplier => supplier.id === id)?.title ?? (id ? id : '—')

const supplierFormOpen = ref(false)
const supplierSaving = ref(false)
const supplierError = ref<string | null>(null)
const supplierEditing = ref<AdminSupplier | null>(null)
const supplierForm = reactive({
  code: '',
  title: '',
  email: '',
  phone: '',
  status: 'active',
  rating: 0,
  itemsSupplied: '',
  note: '',
})

function openSupplierCreate() {
  supplierEditing.value = null
  Object.assign(supplierForm, { code: '', title: '', email: '', phone: '', status: 'active', rating: 0, itemsSupplied: '', note: '' })
  auditReason.value = ''
  supplierError.value = null
  supplierFormOpen.value = true
}

function openSupplierEdit(supplier: AdminSupplier) {
  supplierEditing.value = supplier
  Object.assign(supplierForm, {
    code: supplier.code,
    title: supplier.title,
    email: supplier.email,
    phone: supplier.phone,
    status: supplier.status,
    rating: supplier.rating,
    itemsSupplied: supplier.itemsSupplied.join(', '),
    note: supplier.note,
  })
  auditReason.value = ''
  supplierError.value = null
  supplierFormOpen.value = true
}

async function submitSupplier() {
  if (supplierSaving.value) return
  if (!supplierForm.title.trim()) {
    supplierError.value = t('admin.purchasing.errors.titleRequired')
    return
  }
  if (!supplierEditing.value && !supplierForm.code.trim()) {
    supplierError.value = t('admin.purchasing.errors.codeRequired')
    return
  }
  supplierSaving.value = true
  supplierError.value = null
  try {
    const payload = {
      title: supplierForm.title.trim(),
      email: supplierForm.email.trim(),
      phone: supplierForm.phone.trim(),
      status: supplierForm.status,
      rating: Number(supplierForm.rating) || 0,
      itemsSupplied: supplierForm.itemsSupplied.split(',').map(entry => entry.trim()).filter(Boolean),
      note: supplierForm.note.trim(),
    }
    if (supplierEditing.value) {
      await ops.updateSupplier(supplierEditing.value.id, { ...payload, revision: supplierEditing.value.revision }, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.purchasing.suppliers.updated'), color: 'success' })
    } else {
      await ops.createSupplier({ ...payload, code: supplierForm.code.trim() }, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.purchasing.suppliers.created'), color: 'success' })
    }
    supplierFormOpen.value = false
    await loadSuppliers()
  } catch (e) {
    supplierError.value = describeError(e)
  } finally {
    supplierSaving.value = false
  }
}

/* ----------------------------- purchase orders --------------------------- */

const orders = ref<AdminPurchaseOrder[]>([])
const orderQuery = ref('')
const orderStatus = ref('all')
const orderSupplier = ref('all')
const orderIncludeDeleted = ref(false)
const orderCounts = ref({ all: 0, active: 0, deleted: 0 })
const orderCursor = ref<string | null>(null)
const orderHasMore = ref(false)
const orderLoading = ref(false)
const orderListError = ref<string | null>(null)

const ORDER_STATUSES = ['draft', 'ordered', 'partial', 'received', 'cancelled'] as const
const PAYMENT_METHODS = ['cash', 'banking', 'cod', 'card', 'other'] as const

const orderStatusOptions = computed(() => [
  { label: t('admin.purchasing.orders.allStatuses'), value: 'all' },
  ...ORDER_STATUSES.map(status => ({ label: t(`admin.purchasing.orders.statuses.${status}`), value: status })),
])

const orderStatusItems = computed<{ label: string, value: string }[]>(() => ORDER_STATUSES.map(status => ({
  label: t(`admin.purchasing.orders.statuses.${status}`),
  value: status,
})))

const paymentMethodItems = computed<{ label: string, value: string }[]>(() => PAYMENT_METHODS.map(method => ({
  label: t(`admin.purchasing.orders.paymentMethods.${method}`),
  value: method,
})))

const supplierOptions = computed(() => [
  { label: t('admin.purchasing.suppliers.none'), value: 'none' },
  ...suppliers.value
    .filter(supplier => !supplier.isDeleted)
    .map(supplier => ({ label: `${supplier.title} (${supplier.code})`, value: supplier.id })),
])

const warehouses = ref<AdminWarehouse[]>([])
const warehouseOptions = computed(() => [
  { label: t('admin.purchasing.orders.noWarehouse'), value: 'none' },
  ...warehouses.value
    .filter(warehouse => !warehouse.isDeleted)
    .map(warehouse => ({ label: `${warehouse.title} (${warehouse.code})`, value: warehouse.id })),
])

async function loadWarehouses() {
  if (!canRead.value) return
  try {
    const page = await ops.listWarehouses({ limit: 100 })
    warehouses.value = page.data
  } catch {
    warehouses.value = []
  }
}

async function loadOrders(reset = true) {
  if (!canRead.value) return
  orderLoading.value = true
  orderListError.value = null
  try {
    const page = await ops.listPurchaseOrders({
      q: orderQuery.value.trim() || undefined,
      status: orderStatus.value === 'all' ? undefined : orderStatus.value,
      supplier: orderSupplier.value === 'all' ? undefined : orderSupplier.value,
      includeDeleted: orderIncludeDeleted.value,
      cursor: reset ? null : orderCursor.value,
      limit: 50,
    })
    orders.value = reset ? page.data : [...orders.value, ...page.data]
    orderCursor.value = page.nextCursor
    orderHasMore.value = page.hasMore
    orderCounts.value = { ...orderCounts.value, ...page.counts }
  } catch (e) {
    orderListError.value = describeError(e)
  } finally {
    orderLoading.value = false
  }
}

watchDebounced(orderQuery, () => loadOrders(), { debounce: 300 })
watch([orderStatus, orderSupplier, orderIncludeDeleted], () => loadOrders())

const orderFormOpen = ref(false)
const orderSaving = ref(false)
const orderError = ref<string | null>(null)
const orderEditing = ref<AdminPurchaseOrder | null>(null)
interface OrderLineForm {
  catalogId: string
  itemId: string | null
  variantId: string | null
  itemName: string
  sku: string
  quantity: number
  unitCost: number
}

const orderForm = reactive({
  supplierId: 'none',
  warehouseId: 'none',
  status: 'draft',
  paymentMethod: 'cash',
  expectedDeliveryDate: '',
  note: '',
  lines: [] as OrderLineForm[],
})

const catalogItems = ref<{ id: string, key: string, sku: string, title: Record<string, string>, basePrice: number }[]>([])

const catalogOptions = computed(() => [
  { label: t('admin.purchasing.orders.noItem'), value: 'none' },
  ...catalogItems.value.map(item => ({
    label: `${item.title.vi || item.title.en || item.key} · ${item.sku}`,
    value: item.id,
  })),
])

async function loadCatalogItems() {
  if (!canRead.value) return
  try {
    catalogItems.value = await ops.listItemOptions('', 50)
  } catch {
    catalogItems.value = []
  }
}

function pickCatalogItem(line: OrderLineForm, catalogId: string) {
  const item = catalogItems.value.find(entry => entry.id === catalogId)
  if (!item) {
    line.catalogId = 'none'
    line.itemId = null
    return
  }
  line.catalogId = item.id
  line.itemId = item.id
  line.variantId = null
  line.itemName = item.title.vi || item.title.en || item.key
  line.sku = item.sku
  if (!Number(line.unitCost)) line.unitCost = item.basePrice
}

const orderItemsLocked = computed(() =>
  Boolean(orderEditing.value) && ['received', 'cancelled'].includes(orderEditing.value!.status))

const orderTotal = computed(() =>
  orderForm.lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0), 0))

function addOrderLine() {
  orderForm.lines.push({ catalogId: 'none', itemId: null, variantId: null, itemName: '', sku: '', quantity: 1, unitCost: 0 })
}

function removeOrderLine(index: number) {
  orderForm.lines.splice(index, 1)
}

function openOrderCreate() {
  orderEditing.value = null
  Object.assign(orderForm, {
    supplierId: orderSupplier.value === 'all' ? 'none' : orderSupplier.value,
    warehouseId: 'none',
    status: 'draft',
    paymentMethod: 'cash',
    expectedDeliveryDate: '',
    note: '',
    lines: [{ catalogId: 'none', itemId: null, variantId: null, itemName: '', sku: '', quantity: 1, unitCost: 0 }],
  })
  auditReason.value = ''
  orderError.value = null
  orderFormOpen.value = true
  void loadCatalogItems()
}

function openOrderEdit(order: AdminPurchaseOrder) {
  orderEditing.value = order
  Object.assign(orderForm, {
    supplierId: order.supplierId ?? 'none',
    warehouseId: order.warehouseId ?? 'none',
    status: order.status,
    paymentMethod: order.paymentMethod,
    expectedDeliveryDate: order.expectedDeliveryDate ?? '',
    note: order.note,
    lines: order.items.map(item => ({
      catalogId: item.itemId ?? 'none',
      itemId: item.itemId,
      variantId: item.variantId,
      itemName: item.itemName,
      sku: item.sku,
      quantity: item.quantity,
      unitCost: item.unitCost,
    })),
  })
  auditReason.value = ''
  orderError.value = null
  orderFormOpen.value = true
  void loadCatalogItems()
}

async function submitOrder() {
  if (orderSaving.value) return
  const lines = orderForm.lines.filter(line => line.itemName.trim() && Number(line.quantity) > 0)
  if (!lines.length) {
    orderError.value = t('admin.purchasing.errors.linesRequired')
    return
  }
  orderSaving.value = true
  orderError.value = null
  try {
    const payload = {
      supplierId: orderForm.supplierId === 'none' ? null : orderForm.supplierId,
      warehouseId: orderForm.warehouseId === 'none' ? null : orderForm.warehouseId,
      status: orderForm.status,
      paymentMethod: orderForm.paymentMethod,
      expectedDeliveryDate: orderForm.expectedDeliveryDate.trim() || null,
      note: orderForm.note.trim(),
      items: lines.map(line => ({
        itemId: line.itemId,
        variantId: line.variantId,
        itemName: line.itemName.trim(),
        sku: line.sku.trim(),
        quantity: Math.trunc(Number(line.quantity)) || 1,
        unitCost: Number(line.unitCost) || 0,
      })),
    }
    if (orderEditing.value) {
      await ops.updatePurchaseOrder(orderEditing.value.id, { ...payload, revision: orderEditing.value.revision }, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.purchasing.orders.updated'), color: 'success' })
    } else {
      await ops.createPurchaseOrder(payload, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.purchasing.orders.created'), color: 'success' })
    }
    orderFormOpen.value = false
    await loadOrders()
  } catch (e) {
    orderError.value = describeError(e)
  } finally {
    orderSaving.value = false
  }
}

/* -------------------------------- receipt -------------------------------- */

const receiveOpen = ref(false)
const receiveSaving = ref(false)
const receiveError = ref<string | null>(null)
const receiveTarget = ref<AdminPurchaseOrder | null>(null)
const receiveLines = ref<{ itemId: string | null, variantId: string | null, itemName: string, ordered: number, alreadyReceived: number, alreadyRejected: number, received: number, rejected: number }[]>([])

function openReceive(order: AdminPurchaseOrder) {
  receiveTarget.value = order
  receiveLines.value = order.items.map(item => ({
    itemId: item.itemId,
    variantId: item.variantId,
    itemName: item.itemName,
    ordered: item.quantity,
    alreadyReceived: item.receivedQuantity,
    alreadyRejected: item.rejectedQuantity,
    received: 0,
    rejected: 0,
  }))
  auditReason.value = ''
  receiveError.value = null
  receiveOpen.value = true
}

const receiveRemaining = (line: { ordered: number, alreadyReceived: number, alreadyRejected: number }) =>
  Math.max(0, line.ordered - line.alreadyReceived - line.alreadyRejected)

const receiveBlocked = computed(() => {
  const order = receiveTarget.value
  if (!order) return null
  if (!order.warehouseId) return t('admin.purchasing.orders.receiveNeedsWarehouse')
  if (order.items.some(line => !line.itemId)) return t('admin.purchasing.orders.receiveNeedsItem')
  return null
})

async function submitReceive() {
  if (receiveSaving.value || !receiveTarget.value) return
  const lines = receiveLines.value.filter(line => Number(line.received) > 0 || Number(line.rejected) > 0)
  if (!lines.length) {
    receiveError.value = t('admin.purchasing.errors.receiptEmpty')
    return
  }
  receiveSaving.value = true
  receiveError.value = null
  try {
    await ops.receivePurchaseOrder(receiveTarget.value.id, {
      revision: receiveTarget.value.revision,
      lines: lines.map(line => ({
        itemId: line.itemId,
        variantId: line.variantId,
        receivedQuantity: Math.trunc(Number(line.received)) || 0,
        rejectedQuantity: Math.trunc(Number(line.rejected)) || 0,
      })),
    }, auditReason.value.trim() || undefined)
    toast.add({ title: t('admin.purchasing.orders.received'), color: 'success' })
    receiveOpen.value = false
    await Promise.all([loadOrders(), loadWarehouses()])
  } catch (e) {
    receiveError.value = describeError(e)
  } finally {
    receiveSaving.value = false
  }
}

/* ------------------------- hide / restore confirm ------------------------ */

const confirmOpen = ref(false)
const confirmBusy = ref(false)
const confirmError = ref<string | null>(null)
const confirmKind = ref<'supplier-hide' | 'supplier-restore' | 'order-hide' | 'order-restore'>('supplier-hide')
const confirmSupplier = ref<AdminSupplier | null>(null)
const confirmOrder = ref<AdminPurchaseOrder | null>(null)

function askSupplier(supplier: AdminSupplier, mode: 'hide' | 'restore') {
  confirmKind.value = mode === 'hide' ? 'supplier-hide' : 'supplier-restore'
  confirmSupplier.value = supplier
  confirmOrder.value = null
  auditReason.value = ''
  confirmError.value = null
  confirmOpen.value = true
}

function askOrder(order: AdminPurchaseOrder, mode: 'hide' | 'restore') {
  confirmKind.value = mode === 'hide' ? 'order-hide' : 'order-restore'
  confirmOrder.value = order
  confirmSupplier.value = null
  auditReason.value = ''
  confirmError.value = null
  confirmOpen.value = true
}

const confirmTitle = computed(() => {
  switch (confirmKind.value) {
    case 'supplier-hide': return t('admin.purchasing.suppliers.hide')
    case 'supplier-restore': return t('admin.purchasing.suppliers.restore')
    case 'order-hide': return t('admin.purchasing.orders.hide')
    default: return t('admin.purchasing.orders.restore')
  }
})

const confirmDescription = computed(() => {
  switch (confirmKind.value) {
    case 'supplier-hide': return t('admin.purchasing.suppliers.hideHint', { code: confirmSupplier.value?.code || '' })
    case 'supplier-restore': return t('admin.purchasing.suppliers.restoreHint', { code: confirmSupplier.value?.code || '' })
    case 'order-hide': return t('admin.purchasing.orders.hideHint', { code: confirmOrder.value?.code || '' })
    default: return t('admin.purchasing.orders.restoreHint', { code: confirmOrder.value?.code || '' })
  }
})

async function runConfirm() {
  if (confirmBusy.value) return
  confirmBusy.value = true
  confirmError.value = null
  try {
    const note = auditReason.value.trim() || undefined
    switch (confirmKind.value) {
      case 'supplier-hide':
        await ops.deleteSupplier(confirmSupplier.value!.id, confirmSupplier.value!.revision, note)
        toast.add({ title: t('admin.purchasing.suppliers.hidden'), color: 'success' })
        await loadSuppliers()
        break
      case 'supplier-restore':
        await ops.restoreSupplier(confirmSupplier.value!.id, confirmSupplier.value!.revision, note)
        toast.add({ title: t('admin.purchasing.suppliers.restored'), color: 'success' })
        await loadSuppliers()
        break
      case 'order-hide':
        await ops.deletePurchaseOrder(confirmOrder.value!.id, confirmOrder.value!.revision, note)
        toast.add({ title: t('admin.purchasing.orders.hidden'), color: 'success' })
        await loadOrders()
        break
      case 'order-restore':
        await ops.restorePurchaseOrder(confirmOrder.value!.id, confirmOrder.value!.revision, note)
        toast.add({ title: t('admin.purchasing.orders.restored'), color: 'success' })
        await loadOrders()
        break
    }
    confirmOpen.value = false
  } catch (e) {
    confirmError.value = describeError(e)
  } finally {
    confirmBusy.value = false
  }
}

/* ---------------------------- supplier prices --------------------------- */

const priceRows = ref<SupplierItemPrice[]>([])
const priceRange = ref({ from: '', to: '' })
const priceSummary = ref({ suppliers: 0, items: 0, observations: 0 })
const priceSupplier = ref('all')
const priceItem = ref('all')
const priceFrom = ref(new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10))
const priceTo = ref(new Date().toISOString().slice(0, 10))
const priceLoading = ref(false)
const priceError = ref<string | null>(null)
const expandedPrices = ref<string[]>([])

const supplierLabel = (id: string | null) => suppliers.value.find(entry => entry.id === id)?.title ?? '—'

async function loadPrices() {
  if (!canRead.value) return
  priceLoading.value = true
  priceError.value = null
  try {
    const result = await ops.supplierPriceHistory({
      supplierId: priceSupplier.value === 'all' ? undefined : priceSupplier.value,
      itemId: priceItem.value === 'all' ? undefined : priceItem.value,
      from: priceFrom.value || undefined,
      to: priceTo.value || undefined,
      limit: 100,
    })
    priceRows.value = result.data
    priceRange.value = result.range
    priceSummary.value = result.summary
  } catch (e) {
    priceError.value = describeError(e)
  } finally {
    priceLoading.value = false
  }
}

watch([priceSupplier, priceItem, priceFrom, priceTo], () => loadPrices())

const priceCheckItem = ref('')
const priceCheckSupplier = ref('')
const priceCheckCost = ref<number | null>(null)
const priceCheckQuantity = ref<number | null>(null)
const priceCheckThreshold = ref(10)
const priceCheckBusy = ref(false)
const priceCheckError = ref<string | null>(null)
const priceCheckResult = ref<Awaited<ReturnType<typeof ops.checkSupplierPrice>> | null>(null)

const checkItemOptions = computed(() => catalogItems.value.map(item => ({
  label: item.title.vi || item.title.en || item.key,
  value: item.id,
})))
const checkSupplierOptions = computed(() => supplierOptions.value.filter(option => option.value !== 'none'))
const priceCheckChange = computed(() => {
  const change = priceCheckResult.value?.changePercent
  if (change === null || change === undefined) return null
  return `${change > 0 ? '+' : ''}${change}%`
})

async function runPriceCheck() {
  if (!canRead.value || priceCheckBusy.value) return
  const cost = Number(priceCheckCost.value)
  if (!priceCheckItem.value || !priceCheckSupplier.value) {
    priceCheckError.value = t('admin.purchasing.prices.check.incomplete')
    return
  }
  if (!Number.isFinite(cost) || cost < 0) {
    priceCheckError.value = t('admin.purchasing.prices.check.costInvalid')
    return
  }
  priceCheckBusy.value = true
  priceCheckError.value = null
  try {
    priceCheckResult.value = await ops.checkSupplierPrice({
      supplierId: priceCheckSupplier.value,
      itemId: priceCheckItem.value,
      unitCost: cost,
      quantity: priceCheckQuantity.value === null ? undefined : Number(priceCheckQuantity.value),
      thresholdPercent: Number(priceCheckThreshold.value),
    })
  } catch (e) {
    priceCheckError.value = describeError(e)
  } finally {
    priceCheckBusy.value = false
  }
}

function togglePriceHistory(key: string) {
  expandedPrices.value = expandedPrices.value.includes(key)
    ? expandedPrices.value.filter(entry => entry !== key)
    : [...expandedPrices.value, key]
}

if (canRead.value) await Promise.all([loadSuppliers(), loadOrders(), loadWarehouses(), loadCatalogItems(), loadPrices()])

resetOnClose(supplierFormOpen, orderFormOpen, receiveOpen, confirmOpen)
</script>

<template>
  <div>
    <CmsBasePage
      :title="t('admin.purchasing.title')"
      :description="t('admin.purchasing.description')"
      :loading="(supplierLoading && !suppliers.length) || (orderLoading && !orders.length)"
      :error="supplierListError || orderListError"
      :empty="false"
    >
      <template #right>
        <UButton
          v-if="canWrite && tab === 'suppliers'"
          icon="i-lucide-upload"
          color="neutral"
          variant="ghost"
          size="sm"
          :label="t('admin.import.button')"
          @click="openImport"
        />
        <UButton
          v-if="canWrite && tab !== 'prices'"
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          size="sm"
          :label="tab === 'suppliers' ? t('admin.purchasing.suppliers.create') : t('admin.purchasing.orders.create')"
          @click="tab === 'suppliers' ? openSupplierCreate() : openOrderCreate()"
        />
      </template>

      <div v-if="canRead" class="flex flex-col gap-3">
        <div class="flex flex-wrap gap-2">
          <UButton
            icon="i-lucide-truck"
            :label="t('admin.purchasing.tabs.suppliers')"
            size="sm"
            :color="tab === 'suppliers' ? 'primary' : 'neutral'"
            :variant="tab === 'suppliers' ? 'soft' : 'ghost'"
            @click="tab = 'suppliers'"
          />
          <UButton
            icon="i-lucide-clipboard-list"
            :label="t('admin.purchasing.tabs.orders')"
            size="sm"
            :color="tab === 'orders' ? 'primary' : 'neutral'"
            :variant="tab === 'orders' ? 'soft' : 'ghost'"
            @click="tab = 'orders'"
          />
          <UButton
            icon="i-lucide-line-chart"
            :label="t('admin.purchasing.tabs.prices')"
            size="sm"
            :color="tab === 'prices' ? 'primary' : 'neutral'"
            :variant="tab === 'prices' ? 'soft' : 'ghost'"
            @click="tab = 'prices'"
          />
        </div>

        <!-- Suppliers -->
        <template v-if="tab === 'suppliers'">
          <div class="flex flex-wrap items-center gap-3">
            <UInput
              v-model="supplierQuery"
              icon="i-lucide-search"
              size="sm"
              class="w-full sm:w-64"
              :placeholder="t('admin.purchasing.suppliers.searchPlaceholder')"
            />
            <USelect v-model="supplierStatus" :items="supplierStatusOptions" value-key="value" size="sm" class="w-full sm:w-44" />
            <USwitch v-model="supplierIncludeDeleted" size="sm" :label="t('admin.purchasing.includeDeleted')" />
            <p class="text-xs text-muted">
              {{ t('admin.purchasing.summary', { all: supplierCounts.all, active: supplierCounts.active, deleted: supplierCounts.deleted }) }}
            </p>
          </div>

          <p v-if="!supplierLoading && !suppliers.length" class="text-xs text-muted">
            {{ supplierQuery || supplierStatus !== 'all' || supplierIncludeDeleted
              ? t('admin.purchasing.noMatch') : t('admin.purchasing.suppliers.empty') }}
          </p>

          <div v-if="suppliers.length" class="overflow-hidden rounded-[4px] border border-default/60">
            <div
              v-for="supplier in suppliers"
              :key="supplier.id"
              class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs font-medium text-highlighted">{{ supplier.code }}</span>
                  <span class="truncate font-medium text-highlighted">{{ supplier.title }}</span>
                  <UBadge :color="statusColor(supplier.status)" variant="subtle" size="sm">
                    {{ t(`admin.purchasing.suppliers.statuses.${supplier.status}`) }}
                  </UBadge>
                  <UBadge v-if="supplier.isDeleted" color="error" variant="subtle" size="sm">
                    {{ t('admin.purchasing.badgeHidden') }}
                  </UBadge>
                </div>
                <p class="mt-0.5 truncate text-xs text-muted">
                  <span v-if="supplier.email">{{ supplier.email }}</span>
                  <span v-if="supplier.phone"> · {{ supplier.phone }}</span>
                  <span> · {{ t('admin.purchasing.suppliers.rating', { value: supplier.rating }) }}</span>
                  <span> · {{ t('admin.purchasing.suppliers.itemsCount', { count: supplier.itemsSupplied.length }) }}</span>
                </p>
              </div>

              <div v-if="canWrite" class="flex items-center gap-1">
                <UButton
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :title="t('common.edit')"
                  @click="openSupplierEdit(supplier)"
                />
                <UButton
                  v-if="supplier.isDeleted"
                  icon="i-lucide-rotate-ccw"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :title="t('admin.purchasing.suppliers.restore')"
                  @click="askSupplier(supplier, 'restore')"
                />
                <UButton
                  v-else
                  icon="i-lucide-archive"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :title="t('admin.purchasing.suppliers.hide')"
                  @click="askSupplier(supplier, 'hide')"
                />
              </div>
            </div>
          </div>

          <div v-if="supplierHasMore" class="flex justify-center">
            <UButton color="neutral" variant="ghost" size="sm" :loading="supplierLoading" :label="t('admin.purchasing.loadMore')" @click="loadSuppliers(false)" />
          </div>
        </template>

        <!-- Purchase orders -->
        <template v-else-if="tab === 'orders'">
          <div class="flex flex-wrap items-center gap-3">
            <UInput
              v-model="orderQuery"
              icon="i-lucide-search"
              size="sm"
              class="w-full sm:w-64"
              :placeholder="t('admin.purchasing.orders.searchPlaceholder')"
            />
            <USelect v-model="orderStatus" :items="orderStatusOptions" value-key="value" size="sm" class="w-full sm:w-44" />
            <USelect v-model="orderSupplier" :items="[{ label: t('admin.purchasing.orders.allSuppliers'), value: 'all' }, ...supplierOptions.filter(option => option.value !== 'none')]" value-key="value" size="sm" class="w-full sm:w-52" />
            <USwitch v-model="orderIncludeDeleted" size="sm" :label="t('admin.purchasing.includeDeleted')" />
            <p class="text-xs text-muted">
              {{ t('admin.purchasing.summary', { all: orderCounts.all, active: orderCounts.active, deleted: orderCounts.deleted }) }}
            </p>
          </div>

          <p v-if="!orderLoading && !orders.length" class="text-xs text-muted">
            {{ orderQuery || orderStatus !== 'all' || orderSupplier !== 'all' || orderIncludeDeleted
              ? t('admin.purchasing.noMatch') : t('admin.purchasing.orders.empty') }}
          </p>

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
                    {{ t(`admin.purchasing.orders.statuses.${order.status}`) }}
                  </UBadge>
                  <UBadge color="neutral" variant="subtle" size="sm">
                    {{ t(`admin.purchasing.orders.paymentStatuses.${order.paymentStatus}`) }}
                  </UBadge>
                  <UBadge v-if="order.isDeleted" color="error" variant="subtle" size="sm">
                    {{ t('admin.purchasing.badgeHidden') }}
                  </UBadge>
                </div>
                <p class="mt-0.5 truncate text-xs text-muted">
                  <span>{{ supplierName(order.supplierId) }}</span>
                  <span> · {{ money(order.totalAmount) }}</span>
                  <span> · {{ t('admin.purchasing.orders.itemsCount', { count: order.items.length }) }}</span>
                  <span v-if="order.expectedDeliveryDate"> · {{ order.expectedDeliveryDate }}</span>
                </p>
              </div>

              <div v-if="canWrite" class="flex items-center gap-1">
                <UButton
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :title="t('common.edit')"
                  @click="openOrderEdit(order)"
                />
                <UButton
                  v-if="!order.isDeleted && !['received', 'cancelled'].includes(order.status)"
                  icon="i-lucide-package-plus"
                  color="primary"
                  variant="ghost"
                  size="xs"
                  :title="t('admin.purchasing.orders.receive')"
                  @click="openReceive(order)"
                />
                <UButton
                  v-if="order.isDeleted"
                  icon="i-lucide-rotate-ccw"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :title="t('admin.purchasing.orders.restore')"
                  @click="askOrder(order, 'restore')"
                />
                <UButton
                  v-else
                  icon="i-lucide-archive"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :title="t('admin.purchasing.orders.hide')"
                  @click="askOrder(order, 'hide')"
                />
              </div>
            </div>
          </div>

          <div v-if="orderHasMore" class="flex justify-center">
            <UButton color="neutral" variant="ghost" size="sm" :loading="orderLoading" :label="t('admin.purchasing.loadMore')" @click="loadOrders(false)" />
          </div>
        </template>

        <!-- Supplier prices -->
        <template v-else>
          <div class="rounded-[4px] border border-default/60 p-3">
            <p class="text-sm font-medium text-highlighted">{{ t('admin.purchasing.prices.check.title') }}</p>
            <p class="mt-0.5 text-xs text-muted">{{ t('admin.purchasing.prices.check.hint') }}</p>
            <div class="mt-2 flex flex-wrap items-end gap-2">
              <UFormField :label="t('admin.purchasing.prices.check.item')" class="w-full sm:w-56">
                <USelect v-model="priceCheckItem" :items="checkItemOptions" value-key="value" size="sm" class="w-full" />
              </UFormField>
              <UFormField :label="t('admin.purchasing.prices.check.supplier')" class="w-full sm:w-52">
                <USelect v-model="priceCheckSupplier" :items="checkSupplierOptions" value-key="value" size="sm" class="w-full" />
              </UFormField>
              <UFormField :label="t('admin.purchasing.prices.check.unitCost')" class="w-full sm:w-40">
                <UInput v-model.number="priceCheckCost" type="number" min="0" size="sm" class="w-full" />
              </UFormField>
              <UFormField :label="t('admin.purchasing.prices.check.quantity')" class="w-full sm:w-28">
                <UInput v-model.number="priceCheckQuantity" type="number" min="0" size="sm" class="w-full" />
              </UFormField>
              <UFormField :label="t('admin.purchasing.prices.check.threshold')" class="w-full sm:w-28">
                <UInput v-model.number="priceCheckThreshold" type="number" min="0" max="100" size="sm" class="w-full" />
              </UFormField>
              <UButton
                icon="i-lucide-shield-check"
                color="primary"
                variant="soft"
                size="sm"
                :loading="priceCheckBusy"
                :label="t('admin.purchasing.prices.check.run')"
                @click="runPriceCheck"
              />
            </div>
            <p v-if="priceCheckError" class="mt-2 text-xs text-error">{{ priceCheckError }}</p>
            <div v-if="priceCheckResult" class="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <UBadge
                :color="priceCheckResult.needsReview ? 'warning' : priceCheckResult.hasHistory ? 'success' : 'neutral'"
                variant="subtle"
                size="sm"
              >
                {{ priceCheckResult.needsReview
                  ? t('admin.purchasing.prices.check.flagged', { change: priceCheckChange })
                  : priceCheckResult.hasHistory
                    ? t('admin.purchasing.prices.check.within', { threshold: priceCheckResult.thresholdPercent })
                    : t('admin.purchasing.prices.check.noHistory') }}
              </UBadge>
              <span v-if="priceCheckResult.hasHistory" class="text-muted">
                {{ t('admin.purchasing.prices.check.last', { amount: money(priceCheckResult.lastUnitCost ?? 0), date: priceCheckResult.lastReceivedAt?.slice(0, 10) ?? '—' }) }}
              </span>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <USelect
              v-model="priceSupplier"
              :items="[{ label: t('admin.purchasing.prices.allSuppliers'), value: 'all' }, ...supplierOptions.filter(option => option.value !== 'none')]"
              value-key="value"
              size="sm"
              class="w-full sm:w-52"
            />
            <USelect
              v-model="priceItem"
              :items="[{ label: t('admin.purchasing.prices.allItems'), value: 'all' }, ...catalogItems.map(item => ({ label: item.title.vi || item.title.en || item.key, value: item.id }))]"
              value-key="value"
              size="sm"
              class="w-full sm:w-56"
            />
            <UInput v-model="priceFrom" type="date" size="sm" class="w-full sm:w-40" />
            <UInput v-model="priceTo" type="date" size="sm" class="w-full sm:w-40" />
            <p class="text-xs text-muted">
              {{ t('admin.purchasing.prices.summary', { suppliers: priceSummary.suppliers, items: priceSummary.items, observations: priceSummary.observations }) }}
            </p>
          </div>

          <p class="text-xs text-muted">
            {{ priceRange.from ? t('admin.purchasing.prices.range', { from: priceRange.from, to: priceRange.to }) : t('admin.purchasing.prices.window', { from: priceFrom, to: priceTo }) }}
          </p>
          <p v-if="priceError" class="text-xs text-error">{{ priceError }}</p>
          <p v-else-if="!priceLoading && !priceRows.length" class="text-xs text-muted">
            {{ t('admin.purchasing.prices.empty') }}
          </p>

          <div v-if="priceRows.length" class="flex flex-col gap-2">
            <div v-for="row in priceRows" :key="row.key" class="overflow-hidden rounded-[4px] border border-default/60">
              <div class="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-mono text-xs text-highlighted">{{ row.sku || row.itemName }}</span>
                    <span class="truncate font-medium text-highlighted">{{ row.itemName }}</span>
                    <UBadge color="neutral" variant="subtle" size="sm">{{ supplierLabel(row.supplierId) }}</UBadge>
                    <UBadge v-if="row.changePercent !== null && row.changePercent !== 0" :color="row.changePercent > 0 ? 'error' : 'success'" variant="subtle" size="sm">
                      {{ row.changePercent > 0 ? '+' : '' }}{{ row.changePercent }}%
                    </UBadge>
                  </div>
                  <p class="mt-0.5 truncate text-xs text-muted">
                    <span>{{ t('admin.purchasing.prices.lastCost', { amount: money(row.lastUnitCost), date: row.lastReceivedAt.slice(0, 10) }) }}</span>
                    <span> · {{ t('admin.purchasing.prices.spread', { min: money(row.minUnitCost), max: money(row.maxUnitCost) }) }}</span>
                    <span> · {{ t('admin.purchasing.prices.average', { amount: money(row.averageUnitCost) }) }}</span>
                    <span> · {{ t('admin.purchasing.prices.quantity', { quantity: money(row.totalQuantity), observations: row.observations }) }}</span>
                  </p>
                </div>
                <UButton
                  icon="i-lucide-history"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :title="t('admin.purchasing.prices.historyTitle')"
                  @click="togglePriceHistory(row.key)"
                />
              </div>
              <div v-if="expandedPrices.includes(row.key)" class="border-t border-default/40 bg-elevated/20 px-3 py-2">
                <div class="grid grid-cols-[7rem_1fr_5rem_7rem_7rem] gap-2 text-xs text-muted">
                  <span>{{ t('admin.purchasing.prices.date') }}</span>
                  <span>{{ t('admin.purchasing.prices.order') }}</span>
                  <span class="text-right">{{ t('admin.purchasing.prices.qty') }}</span>
                  <span class="text-right">{{ t('admin.purchasing.prices.unitCost') }}</span>
                  <span class="text-right">{{ t('admin.purchasing.prices.value') }}</span>
                </div>
                <div v-for="entry in row.history" :key="`${row.key}-${entry.receivedAt}`" class="mt-1 grid grid-cols-[7rem_1fr_5rem_7rem_7rem] gap-2 text-xs text-toned">
                  <span class="font-mono">{{ entry.date }}</span>
                  <span class="truncate">{{ entry.purchaseOrderCode }}</span>
                  <span class="text-right">{{ money(entry.quantity) }}</span>
                  <span class="text-right">{{ money(entry.unitCost) }}</span>
                  <span class="text-right">{{ money(entry.totalValue) }}</span>
                </div>
              </div>
            </div>
          </div>

          <p class="text-xs text-muted">{{ t('admin.purchasing.prices.hint') }}</p>
        </template>
      </div>
    </CmsBasePage>

    <!-- Supplier form -->
    <UModal
      v-model:open="supplierFormOpen"
      :title="supplierEditing ? t('admin.purchasing.suppliers.editTitle') : t('admin.purchasing.suppliers.createTitle')"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-2xl' }"
    >
      <template #body>
        <div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto scroll-thin">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.purchasing.suppliers.fields.code')">
              <UInput v-model="supplierForm.code" class="w-full" :disabled="Boolean(supplierEditing)" />
            </UFormField>
            <UFormField :label="t('admin.purchasing.suppliers.fields.title')">
              <UInput v-model="supplierForm.title" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.purchasing.suppliers.fields.email')">
              <UInput v-model="supplierForm.email" type="email" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.purchasing.suppliers.fields.phone')">
              <UInput v-model="supplierForm.phone" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.purchasing.suppliers.fields.status')">
              <USelect
                v-model="supplierForm.status"
                :items="[{ label: t('admin.purchasing.suppliers.statuses.active'), value: 'active' }, { label: t('admin.purchasing.suppliers.statuses.inactive'), value: 'inactive' }]"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="t('admin.purchasing.suppliers.fields.rating')">
              <UInput v-model.number="supplierForm.rating" type="number" min="0" max="5" step="0.5" class="w-full" />
            </UFormField>
          </div>
          <UFormField :label="t('admin.purchasing.suppliers.fields.itemsSupplied')" :hint="t('admin.purchasing.suppliers.itemsSuppliedHint')">
            <UInput v-model="supplierForm.itemsSupplied" class="w-full" />
          </UFormField>
          <UFormField :label="t('admin.purchasing.suppliers.fields.note')">
            <UTextarea v-model="supplierForm.note" :rows="2" class="w-full" />
          </UFormField>
          <AuditReasonField v-model="auditReason" />
          <p v-if="supplierError" class="text-xs text-error">{{ supplierError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="supplierFormOpen = false" />
          <UButton color="primary" variant="soft" :loading="supplierSaving" :label="t('common.save')" @click="submitSupplier" />
        </div>
      </template>
    </UModal>

    <!-- Purchase order form -->
    <UModal
      v-model:open="orderFormOpen"
      :title="orderEditing ? t('admin.purchasing.orders.editTitle') : t('admin.purchasing.orders.createTitle')"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-3xl' }"
    >
      <template #body>
        <div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto scroll-thin">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.purchasing.orders.fields.supplier')">
              <USelect v-model="orderForm.supplierId" :items="supplierOptions" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.purchasing.orders.fields.warehouse')">
              <USelect v-model="orderForm.warehouseId" :items="warehouseOptions" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.purchasing.orders.fields.status')">
              <USelect v-model="orderForm.status" :items="orderStatusItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.purchasing.orders.fields.paymentMethod')">
              <USelect v-model="orderForm.paymentMethod" :items="paymentMethodItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.purchasing.orders.fields.expectedDeliveryDate')">
              <UInput v-model="orderForm.expectedDeliveryDate" type="date" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.purchasing.orders.fields.note')">
              <UInput v-model="orderForm.note" class="w-full" />
            </UFormField>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm font-medium text-highlighted">{{ t('admin.purchasing.orders.lines') }}</p>
            <UButton
              v-if="!orderItemsLocked"
              icon="i-lucide-plus"
              color="neutral"
              variant="ghost"
              size="xs"
              :label="t('admin.purchasing.orders.addLine')"
              @click="addOrderLine"
            />
          </div>
          <p v-if="orderItemsLocked" class="text-xs text-muted">{{ t('admin.purchasing.orders.linesLocked') }}</p>

          <div
            v-for="(line, index) in orderForm.lines"
            :key="index"
            class="grid gap-2 rounded-[4px] border border-default/60 p-2 sm:grid-cols-[10rem_1fr_7rem_5rem_6rem_auto]"
          >
            <USelect
              :model-value="line.catalogId"
              :items="catalogOptions"
              value-key="value"
              size="sm"
              :disabled="orderItemsLocked"
              @update:model-value="pickCatalogItem(line, String($event))"
            />
            <UInput v-model="line.itemName" :placeholder="t('admin.purchasing.orders.fields.itemName')" size="sm" :disabled="orderItemsLocked" />
            <UInput v-model="line.sku" :placeholder="t('admin.purchasing.orders.fields.sku')" size="sm" :disabled="orderItemsLocked" />
            <UInput v-model.number="line.quantity" type="number" min="1" size="sm" :disabled="orderItemsLocked" />
            <UInput v-model.number="line.unitCost" type="number" min="0" size="sm" :disabled="orderItemsLocked" />
            <UButton
              v-if="!orderItemsLocked"
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              :title="t('admin.purchasing.orders.removeLine')"
              @click="removeOrderLine(index)"
            />
          </div>

          <p class="text-xs text-muted">{{ t('admin.purchasing.orders.total', { total: money(orderTotal) }) }}</p>

          <AuditReasonField v-model="auditReason" />
          <p v-if="orderError" class="text-xs text-error">{{ orderError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="orderFormOpen = false" />
          <UButton color="primary" variant="soft" :loading="orderSaving" :label="t('common.save')" @click="submitOrder" />
        </div>
      </template>
    </UModal>

    <!-- Receipt -->
    <UModal
      v-model:open="receiveOpen"
      :title="t('admin.purchasing.orders.receiveTitle', { code: receiveTarget?.code || '' })"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-2xl' }"
    >
      <template #body>
        <div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto scroll-thin">
          <p class="text-xs text-muted">{{ t('admin.purchasing.orders.receiveHint') }}</p>
          <p v-if="receiveBlocked" class="text-xs text-warning">{{ receiveBlocked }}</p>
          <div v-for="(line, index) in receiveLines" :key="index" class="flex flex-wrap items-end gap-2 rounded-[4px] border border-default/60 p-2">
            <div class="min-w-40 flex-1">
              <p class="truncate text-sm font-medium text-highlighted">{{ line.itemName }}</p>
              <p class="text-xs text-muted">
                {{ t('admin.purchasing.orders.receiveLine', { ordered: line.ordered, received: line.alreadyReceived, rejected: line.alreadyRejected }) }}
                · {{ t('admin.purchasing.orders.remaining', { count: receiveRemaining(line) }) }}
              </p>
            </div>
            <UFormField :label="t('admin.purchasing.orders.receivedQty')" class="w-24">
              <UInput v-model.number="line.received" type="number" min="0" :max="receiveRemaining(line)" size="sm" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.purchasing.orders.rejectedQty')" class="w-24">
              <UInput v-model.number="line.rejected" type="number" min="0" :max="receiveRemaining(line)" size="sm" class="w-full" />
            </UFormField>
          </div>
          <AuditReasonField v-model="auditReason" />
          <p v-if="receiveError" class="text-xs text-error">{{ receiveError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="receiveOpen = false" />
          <UButton
            color="primary"
            variant="soft"
            :loading="receiveSaving"
            :disabled="Boolean(receiveBlocked)"
            :label="t('admin.purchasing.orders.receiveSubmit')"
            @click="submitReceive"
          />
        </div>
      </template>
    </UModal>

    <!-- Hide / restore -->
    <UModal v-model:open="confirmOpen" :title="confirmTitle" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }">
      <template #body>
        <div class="flex flex-col gap-3">
          <p class="text-sm text-toned">{{ confirmDescription }}</p>
          <AuditReasonField v-model="auditReason" />
          <p v-if="confirmError" class="text-xs text-error">{{ confirmError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="confirmOpen = false" />
          <UButton color="primary" variant="soft" :loading="confirmBusy" :label="t('common.save')" @click="runConfirm" />
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
