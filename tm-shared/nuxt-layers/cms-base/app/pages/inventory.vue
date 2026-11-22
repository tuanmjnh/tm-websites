<script setup lang="ts">
import type { AdminSerialNumber, AdminStocktake, AdminTransfer, AdminWarehouse } from '../composables/useOperationsAdmin'

const { t } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const ops = useOperationsAdmin()

const canRead = computed(() => hasCapability('content.read'))
const canWrite = computed(() => hasCapability('content.write'))

type Tab = 'balances' | 'warehouses' | 'transfers' | 'stocktakes' | 'serials'
const tab = ref<Tab>('balances')

const { reason: auditReason, resetOnClose } = useAuditReason()

const money = (value: number) => new Intl.NumberFormat('vi-VN').format(value)

const describeError = (e: unknown) => {
  const code = ops.errorCode(e) ?? ''
  if (/_REVISION_CONFLICT$/.test(code)) return t('admin.inventory.errors.conflict')
  if (/_REVISION_REQUIRED$/.test(code)) return t('admin.inventory.errors.revisionRequired')
  if (/_NOT_FOUND$/.test(code)) return t('admin.inventory.errors.notFound')
  if (/_CODE_EXISTS$|_CODE_TAKEN$/.test(code)) return t('admin.inventory.errors.codeExists')
  if (/_STOCK_FAILED$/.test(code)) return t('admin.inventory.errors.stockFailed')
  if (/_SAME_WAREHOUSE$/.test(code)) return t('admin.inventory.errors.sameWarehouse')
  if (/_LOCKED$|_NOT_DRAFT$|_NOT_IN_TRANSIT$|_NOT_IN_STOCK$|_NOT_SOLD$/.test(code)) return t('admin.inventory.errors.locked')
  if (/_DUPLICATE$/.test(code)) return t('admin.inventory.errors.duplicate')
  if (/_PAYLOAD_INVALID$|_INVALID$|_DUPLICATE_LINE$/.test(code)) return t('admin.inventory.errors.invalid')
  const status = (e as { statusCode?: number, status?: number })?.statusCode ?? (e as { status?: number })?.status
  if (status === 401) return t('admin.errors.unauthorized')
  if (status === 403) return t('admin.errors.forbidden')
  if (status === 404) return t('admin.errors.notFound')
  if (!status) return t('admin.errors.network')
  if (status === 503) return t('admin.errors.unavailable')
  return t('admin.errors.generic')
}

/* ------------------------------ warehouses ------------------------------ */

const warehouses = ref<AdminWarehouse[]>([])
const warehouseName = (id: string | null | undefined) => warehouses.value.find(warehouse => warehouse.id === id)?.title ?? id ?? '—'

async function loadWarehouses() {
  if (!canRead.value) return
  try {
    const page = await ops.listWarehouses({ limit: 100 })
    warehouses.value = page.data
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
  }
}

const warehouseOptions = computed(() => warehouses.value
  .filter(warehouse => !warehouse.isDeleted)
  .map(warehouse => ({ label: `${warehouse.title} (${warehouse.code})`, value: warehouse.id })))

const warehouseFormOpen = ref(false)
const warehouseSaving = ref(false)
const warehouseError = ref<string | null>(null)
const warehouseEditing = ref<AdminWarehouse | null>(null)
const warehouseForm = reactive({ code: '', title: '', address: '', phone: '', status: 'active', description: '', sort: 0 })

function openWarehouseCreate() {
  warehouseEditing.value = null
  Object.assign(warehouseForm, { code: '', title: '', address: '', phone: '', status: 'active', description: '', sort: 0 })
  auditReason.value = ''
  warehouseError.value = null
  warehouseFormOpen.value = true
}

function openWarehouseEdit(warehouse: AdminWarehouse) {
  warehouseEditing.value = warehouse
  Object.assign(warehouseForm, {
    code: warehouse.code,
    title: warehouse.title,
    address: warehouse.address,
    phone: warehouse.phone,
    status: warehouse.status,
    description: warehouse.description,
    sort: warehouse.sort,
  })
  auditReason.value = ''
  warehouseError.value = null
  warehouseFormOpen.value = true
}

async function submitWarehouse() {
  if (warehouseSaving.value) return
  if (!warehouseForm.title.trim()) {
    warehouseError.value = t('admin.inventory.errors.titleRequired')
    return
  }
  warehouseSaving.value = true
  warehouseError.value = null
  try {
    const payload = {
      code: warehouseForm.code.trim() || undefined,
      title: warehouseForm.title.trim(),
      address: warehouseForm.address.trim(),
      phone: warehouseForm.phone.trim(),
      status: warehouseForm.status,
      description: warehouseForm.description.trim(),
      sort: Number(warehouseForm.sort) || 0,
    }
    if (warehouseEditing.value) {
      await ops.updateWarehouse(warehouseEditing.value.id, { ...payload, revision: warehouseEditing.value.revision }, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.inventory.warehouses.updated'), color: 'success' })
    } else {
      await ops.createWarehouse(payload, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.inventory.warehouses.created'), color: 'success' })
    }
    warehouseFormOpen.value = false
    await Promise.all([loadWarehouses(), loadBalances()])
  } catch (e) {
    warehouseError.value = describeError(e)
  } finally {
    warehouseSaving.value = false
  }
}

/* ------------------------------ balances -------------------------------- */

const balances = ref<Awaited<ReturnType<typeof ops.listInventories>>['data']>([])
const balanceQuery = ref('')
const balanceWarehouse = ref('all')
const balanceCounts = ref({ all: 0, lowStock: 0, deleted: 0 })
const balanceCursor = ref<string | null>(null)
const balanceHasMore = ref(false)
const balanceLoading = ref(false)
const balanceError = ref<string | null>(null)

async function loadBalances(reset = true) {
  if (!canRead.value) return
  balanceLoading.value = true
  balanceError.value = null
  try {
    const page = await ops.listInventories({
      q: balanceQuery.value.trim() || undefined,
      warehouse: balanceWarehouse.value === 'all' ? undefined : balanceWarehouse.value,
      cursor: reset ? null : balanceCursor.value,
    })
    balances.value = reset ? page.data : [...balances.value, ...page.data]
    balanceCursor.value = page.nextCursor
    balanceHasMore.value = page.hasMore
    balanceCounts.value = { ...balanceCounts.value, ...page.counts }
  } catch (e) {
    balanceError.value = describeError(e)
  } finally {
    balanceLoading.value = false
  }
}

watchDebounced(balanceQuery, () => loadBalances(), { debounce: 300 })
watch(balanceWarehouse, () => loadBalances())

/* ------------------------------ transfers ------------------------------- */

const transfers = ref<AdminTransfer[]>([])
const transferStatus = ref('all')
const transferHasMore = ref(false)
const transferCursor = ref<string | null>(null)
const transferLoading = ref(false)
const transferCounts = ref({ all: 0, draft: 0, inTransit: 0, received: 0, cancelled: 0 })

const transferStatusOptions = computed(() => [
  { label: t('admin.inventory.transfers.allStatuses'), value: 'all' },
  ...['draft', 'in_transit', 'received', 'cancelled'].map(status => ({ label: t(`admin.inventory.transfers.statuses.${status}`), value: status })),
])

async function loadTransfers(reset = true) {
  if (!canRead.value) return
  transferLoading.value = true
  try {
    const page = await ops.listTransfers({
      status: transferStatus.value === 'all' ? undefined : transferStatus.value,
      cursor: reset ? null : transferCursor.value,
    })
    transfers.value = reset ? page.data : [...transfers.value, ...page.data]
    transferCursor.value = page.nextCursor
    transferHasMore.value = page.hasMore
    transferCounts.value = { ...transferCounts.value, ...page.counts }
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
  } finally {
    transferLoading.value = false
  }
}

watch(transferStatus, () => loadTransfers())

/* ------------------------------- catalog -------------------------------- */

const itemOptions = ref<{ label: string, value: string }[]>([])
const pickerItems = ref<{ id: string, key: string, sku: string, title: Record<string, string> }[]>([])

async function searchItems(term: string) {
  try {
    pickerItems.value = await ops.listItemOptions(term)
    itemOptions.value = pickerItems.value.map(item => ({
      label: `${item.title.vi || item.title.en || item.key}${item.sku ? ` · ${item.sku}` : ''}`,
      value: item.id,
    }))
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
  }
}

/* --------------------------- transfer create ---------------------------- */

const transferFormOpen = ref(false)
const transferSaving = ref(false)
const transferError = ref<string | null>(null)
const pickedTransferItem = ref('')
const transferForm = reactive({ from: '', to: '', note: '', lines: [] as { itemId: string, itemName: string, sku: string, quantity: number }[] })

function openTransferCreate() {
  Object.assign(transferForm, { from: '', to: '', note: '', lines: [] })
  pickedTransferItem.value = ''
  auditReason.value = ''
  transferError.value = null
  void searchItems('')
  transferFormOpen.value = true
}

function addTransferLine() {
  const item = pickerItems.value.find(entry => entry.id === pickedTransferItem.value)
  if (!item) return
  transferForm.lines.push({
    itemId: item.id,
    itemName: item.title.vi || item.title.en || item.key,
    sku: item.sku,
    quantity: 1,
  })
  pickedTransferItem.value = ''
}

async function submitTransfer() {
  if (transferSaving.value) return
  if (!transferForm.from || !transferForm.to || !transferForm.lines.length) {
    transferError.value = t('admin.inventory.errors.transferIncomplete')
    return
  }
  transferSaving.value = true
  transferError.value = null
  try {
    await ops.createTransfer({
      fromWarehouseId: transferForm.from,
      toWarehouseId: transferForm.to,
      note: transferForm.note,
      lines: transferForm.lines.map(line => ({
        itemId: line.itemId,
        variantId: null,
        sku: line.sku,
        itemName: line.itemName,
        quantity: Number(line.quantity) || 1,
      })),
    }, auditReason.value.trim() || undefined)
    toast.add({ title: t('admin.inventory.transfers.created'), color: 'success' })
    transferFormOpen.value = false
    await loadTransfers()
  } catch (e) {
    transferError.value = describeError(e)
  } finally {
    transferSaving.value = false
  }
}

/* ------------------------------ stocktakes ------------------------------ */

const stocktakes = ref<AdminStocktake[]>([])
const stocktakeStatus = ref('all')
const stocktakeCounts = ref({ draft: 0, completed: 0, cancelled: 0 })

const stocktakeStatusOptions = computed(() => [
  { label: t('admin.inventory.stocktakes.allStatuses'), value: 'all' },
  ...['draft', 'completed', 'cancelled'].map(status => ({ label: t(`admin.inventory.stocktakes.statuses.${status}`), value: status })),
])

async function loadStocktakes() {
  if (!canRead.value) return
  try {
    const result = await ops.listStocktakes({ status: stocktakeStatus.value === 'all' ? undefined : stocktakeStatus.value })
    stocktakes.value = result.data
    stocktakeCounts.value = { ...stocktakeCounts.value, ...result.counts }
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
  }
}

watch(stocktakeStatus, () => loadStocktakes())

const stocktakeFormOpen = ref(false)
const stocktakeSaving = ref(false)
const stocktakeError = ref<string | null>(null)
const pickedStocktakeItem = ref('')
const stocktakeForm = reactive({ code: '', warehouseId: '', note: '', lines: [] as { itemId: string, itemName: string, sku: string, countedQuantity: number }[] })

function openStocktakeCreate() {
  Object.assign(stocktakeForm, {
    code: `ST-${Date.now().toString(36).toUpperCase()}`,
    warehouseId: '',
    note: '',
    lines: [],
  })
  pickedStocktakeItem.value = ''
  auditReason.value = ''
  stocktakeError.value = null
  void searchItems('')
  stocktakeFormOpen.value = true
}

function addStocktakeLine() {
  const item = pickerItems.value.find(entry => entry.id === pickedStocktakeItem.value)
  if (!item) return
  stocktakeForm.lines.push({
    itemId: item.id,
    itemName: item.title.vi || item.title.en || item.key,
    sku: item.sku,
    countedQuantity: 0,
  })
  pickedStocktakeItem.value = ''
}

async function submitStocktake() {
  if (stocktakeSaving.value) return
  if (!stocktakeForm.code.trim() || !stocktakeForm.warehouseId || !stocktakeForm.lines.length) {
    stocktakeError.value = t('admin.inventory.errors.stocktakeIncomplete')
    return
  }
  stocktakeSaving.value = true
  stocktakeError.value = null
  try {
    await ops.createStocktake({
      code: stocktakeForm.code.trim(),
      warehouseId: stocktakeForm.warehouseId,
      note: stocktakeForm.note,
      lines: stocktakeForm.lines.map(line => ({
        itemId: line.itemId,
        variantId: null,
        sku: line.sku,
        itemName: line.itemName,
        expectedQuantity: 0,
        countedQuantity: Number(line.countedQuantity) || 0,
      })),
    }, auditReason.value.trim() || undefined)
    toast.add({ title: t('admin.inventory.stocktakes.created'), color: 'success' })
    stocktakeFormOpen.value = false
    await loadStocktakes()
  } catch (e) {
    stocktakeError.value = describeError(e)
  } finally {
    stocktakeSaving.value = false
  }
}

/* ---------------------------- serial numbers ---------------------------- */

const serials = ref<AdminSerialNumber[]>([])
const serialStatus = ref('all')
const serialQuery = ref('')
const serialWarehouse = ref('all')
const serialIncludeDeleted = ref(false)
const serialCounts = ref<Record<string, number>>({ all: 0, in_stock: 0, sold: 0, returned: 0, scrapped: 0, deleted: 0 })
const serialCursor = ref<string | null>(null)
const serialHasMore = ref(false)
const serialLoading = ref(false)
const serialError = ref<string | null>(null)

const serialStatusOptions = computed(() => [
  { label: t('admin.inventory.serials.allStatuses'), value: 'all' },
  ...['in_stock', 'sold', 'returned', 'scrapped'].map(status => ({ label: t(`admin.inventory.serials.statuses.${status}`), value: status })),
])

const serialStatusColor = (status: string) => {
  if (status === 'in_stock') return 'success'
  if (status === 'sold') return 'primary'
  if (status === 'returned') return 'warning'
  return 'error'
}

const serialItemLabel = (itemId: string) =>
  itemOptions.value.find(option => option.value === itemId)?.label ?? itemId

async function loadSerials(reset = true) {
  if (!canRead.value) return
  serialLoading.value = true
  serialError.value = null
  try {
    const page = await ops.listSerialNumbers({
      status: serialStatus.value === 'all' ? undefined : serialStatus.value,
      q: serialQuery.value.trim() || undefined,
      warehouseId: serialWarehouse.value === 'all' ? undefined : serialWarehouse.value,
      includeDeleted: serialIncludeDeleted.value,
      cursor: reset ? null : serialCursor.value,
    })
    serials.value = reset ? page.data : [...serials.value, ...page.data]
    serialCursor.value = page.nextCursor
    serialHasMore.value = page.hasMore
    serialCounts.value = { ...serialCounts.value, ...page.counts }
  } catch (e) {
    serialError.value = describeError(e)
  } finally {
    serialLoading.value = false
  }
}

watchDebounced(serialQuery, () => loadSerials(), { debounce: 300 })
watch([serialStatus, serialWarehouse, serialIncludeDeleted], () => loadSerials())

const serialFormOpen = ref(false)
const serialSaving = ref(false)
const serialFormError = ref<string | null>(null)
const pickedSerialItem = ref('')
// USelect rejects an option whose value is '', so "no warehouse" needs its own sentinel.
const NO_WAREHOUSE = '__none__'
const serialForm = reactive({ warehouseId: NO_WAREHOUSE, note: '', serials: '' })

function openSerialCreate() {
  Object.assign(serialForm, { warehouseId: NO_WAREHOUSE, note: '', serials: '' })
  pickedSerialItem.value = ''
  auditReason.value = ''
  serialFormError.value = null
  void searchItems('')
  serialFormOpen.value = true
}

async function submitSerials() {
  if (serialSaving.value) return
  const rows = serialForm.serials.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean)
  if (!pickedSerialItem.value || !rows.length) {
    serialFormError.value = t('admin.inventory.errors.serialIncomplete')
    return
  }
  serialSaving.value = true
  serialFormError.value = null
  try {
    const result = await ops.registerSerialNumbers(rows.map(serial => ({
      serial,
      itemId: pickedSerialItem.value,
      warehouseId: serialForm.warehouseId === NO_WAREHOUSE ? null : serialForm.warehouseId,
      note: serialForm.note.trim(),
    })), auditReason.value.trim() || undefined)
    toast.add({ title: t('admin.inventory.serials.registered', { count: result.data.length }), color: 'success' })
    serialFormOpen.value = false
    await loadSerials()
  } catch (e) {
    serialFormError.value = describeError(e)
  } finally {
    serialSaving.value = false
  }
}

type SerialAction = 'sold' | 'returned' | 'scrap' | 'move' | 'hide' | 'restore'

const serialActionOpen = ref(false)
const serialActionBusy = ref(false)
const serialActionError = ref<string | null>(null)
const serialActionKind = ref<SerialAction>('sold')
const serialTarget = ref<AdminSerialNumber | null>(null)
const serialActionOrderId = ref('')
const serialActionWarehouse = ref('')

const serialActionTitle = computed(() => t(`admin.inventory.serials.actions.${serialActionKind.value}`))

function askSerial(serial: AdminSerialNumber, kind: SerialAction) {
  serialTarget.value = serial
  serialActionKind.value = kind
  serialActionOrderId.value = serial.orderId ?? ''
  serialActionWarehouse.value = ''
  auditReason.value = ''
  serialActionError.value = null
  serialActionOpen.value = true
}

async function runSerialAction() {
  if (serialActionBusy.value || !serialTarget.value) return
  const target = serialTarget.value
  if (serialActionKind.value === 'sold' && !serialActionOrderId.value.trim()) {
    serialActionError.value = t('admin.inventory.errors.orderRequired')
    return
  }
  if (serialActionKind.value === 'move' && !serialActionWarehouse.value) {
    serialActionError.value = t('admin.inventory.errors.warehouseRequired')
    return
  }
  serialActionBusy.value = true
  serialActionError.value = null
  try {
    const note = auditReason.value.trim() || undefined
    switch (serialActionKind.value) {
      case 'sold':
        await ops.markSerialSold(target.id, serialActionOrderId.value.trim(), target.revision, note)
        break
      case 'returned':
        await ops.markSerialReturned(target.id, target.revision, note)
        break
      case 'scrap':
        await ops.scrapSerialNumber(target.id, target.revision, note)
        break
      case 'move':
        await ops.moveSerialNumber(target.id, serialActionWarehouse.value, target.revision, note)
        break
      case 'hide':
        await ops.deleteSerialNumber(target.id, target.revision, note)
        break
      case 'restore':
        await ops.restoreSerialNumber(target.id, target.revision, note)
        break
    }
    toast.add({ title: t(`admin.inventory.serials.done.${serialActionKind.value}`), color: 'success' })
    serialActionOpen.value = false
    await loadSerials()
  } catch (e) {
    serialActionError.value = describeError(e)
  } finally {
    serialActionBusy.value = false
  }
}

/* ---------------------------- confirm actions --------------------------- */

type ConfirmKind =
  | 'warehouse-delete'
  | 'warehouse-restore'
  | 'transfer-ship'
  | 'transfer-receive'
  | 'transfer-cancel'
  | 'stocktake-complete'
  | 'stocktake-cancel'

const confirmOpen = ref(false)
const confirmBusy = ref(false)
const confirmError = ref<string | null>(null)
const confirmKind = ref<ConfirmKind>('warehouse-delete')
const confirmWarehouse = ref<AdminWarehouse | null>(null)
const confirmTransfer = ref<AdminTransfer | null>(null)
const confirmStocktake = ref<AdminStocktake | null>(null)

const confirmTitle = computed(() => {
  const map: Record<ConfirmKind, string> = {
    'warehouse-delete': t('admin.inventory.warehouses.hideTitle'),
    'warehouse-restore': t('admin.inventory.warehouses.restoreTitle'),
    'transfer-ship': t('admin.inventory.transfers.shipTitle'),
    'transfer-receive': t('admin.inventory.transfers.receiveTitle'),
    'transfer-cancel': t('admin.inventory.transfers.cancelTitle'),
    'stocktake-complete': t('admin.inventory.stocktakes.completeTitle'),
    'stocktake-cancel': t('admin.inventory.stocktakes.cancelTitle'),
  }
  return map[confirmKind.value]
})

function askWarehouse(warehouse: AdminWarehouse, kind: 'warehouse-delete' | 'warehouse-restore') {
  confirmKind.value = kind
  confirmWarehouse.value = warehouse
  confirmTransfer.value = null
  confirmStocktake.value = null
  auditReason.value = ''
  confirmError.value = null
  confirmOpen.value = true
}

function askTransfer(transfer: AdminTransfer, kind: 'transfer-ship' | 'transfer-receive' | 'transfer-cancel') {
  confirmKind.value = kind
  confirmTransfer.value = transfer
  confirmWarehouse.value = null
  confirmStocktake.value = null
  auditReason.value = ''
  confirmError.value = null
  confirmOpen.value = true
}

function askStocktake(stocktake: AdminStocktake, kind: 'stocktake-complete' | 'stocktake-cancel') {
  confirmKind.value = kind
  confirmStocktake.value = stocktake
  confirmWarehouse.value = null
  confirmTransfer.value = null
  auditReason.value = ''
  confirmError.value = null
  confirmOpen.value = true
}

async function runConfirm() {
  if (confirmBusy.value) return
  confirmBusy.value = true
  confirmError.value = null
  try {
    const note = auditReason.value.trim() || undefined
    switch (confirmKind.value) {
      case 'warehouse-delete':
        await ops.deleteWarehouse(confirmWarehouse.value!.id, confirmWarehouse.value!.revision, note)
        toast.add({ title: t('admin.inventory.warehouses.hidden'), color: 'success' })
        await loadWarehouses()
        break
      case 'warehouse-restore':
        await ops.restoreWarehouse(confirmWarehouse.value!.id, confirmWarehouse.value!.revision, note)
        toast.add({ title: t('admin.inventory.warehouses.restored'), color: 'success' })
        await loadWarehouses()
        break
      case 'transfer-ship':
        await ops.shipTransfer(confirmTransfer.value!.id, { revision: confirmTransfer.value!.revision }, note)
        toast.add({ title: t('admin.inventory.transfers.shipped'), color: 'success' })
        await Promise.all([loadTransfers(), loadBalances()])
        break
      case 'transfer-receive':
        await ops.receiveTransfer(confirmTransfer.value!.id, {
          revision: confirmTransfer.value!.revision,
          lines: confirmTransfer.value!.lines.map(line => ({
            itemId: line.itemId,
            variantId: line.variantId,
            receivedQuantity: line.quantity,
          })),
        }, note)
        toast.add({ title: t('admin.inventory.transfers.received'), color: 'success' })
        await Promise.all([loadTransfers(), loadBalances()])
        break
      case 'transfer-cancel':
        await ops.cancelTransfer(confirmTransfer.value!.id, {
          revision: confirmTransfer.value!.revision,
          reason: note ?? '',
        }, note)
        toast.add({ title: t('admin.inventory.transfers.cancelled'), color: 'success' })
        await Promise.all([loadTransfers(), loadBalances()])
        break
      case 'stocktake-complete':
        await ops.completeStocktake(confirmStocktake.value!.id, {
          revision: confirmStocktake.value!.revision,
          lines: confirmStocktake.value!.lines.map(line => ({
            itemId: line.itemId,
            variantId: line.variantId,
            countedQuantity: line.countedQuantity,
          })),
        }, note)
        toast.add({ title: t('admin.inventory.stocktakes.completed'), color: 'success' })
        await Promise.all([loadStocktakes(), loadBalances()])
        break
      case 'stocktake-cancel':
        await ops.cancelStocktake(confirmStocktake.value!.id, note)
        toast.add({ title: t('admin.inventory.stocktakes.cancelled'), color: 'success' })
        await loadStocktakes()
        break
    }
    confirmOpen.value = false
  } catch (e) {
    confirmError.value = describeError(e)
  } finally {
    confirmBusy.value = false
  }
}

const tabs = computed(() => [
  { key: 'balances' as Tab, label: t('admin.inventory.tabs.balances'), icon: 'i-lucide-boxes' },
  { key: 'warehouses' as Tab, label: t('admin.inventory.tabs.warehouses'), icon: 'i-lucide-warehouse' },
  { key: 'transfers' as Tab, label: t('admin.inventory.tabs.transfers'), icon: 'i-lucide-arrow-left-right' },
  { key: 'stocktakes' as Tab, label: t('admin.inventory.tabs.stocktakes'), icon: 'i-lucide-clipboard-check' },
  { key: 'serials' as Tab, label: t('admin.inventory.tabs.serials'), icon: 'i-lucide-barcode' },
])

if (canRead.value) {
  await loadWarehouses()
  await Promise.all([loadBalances(), loadTransfers(), loadStocktakes(), loadSerials()])
}

resetOnClose(warehouseFormOpen, transferFormOpen, stocktakeFormOpen, serialFormOpen, serialActionOpen, confirmOpen)
</script>

<template>
  <div>
    <CmsBasePage
      :title="t('admin.inventory.title')"
      :description="t('admin.inventory.description')"
      :empty="!canRead"
      :empty-text="t('admin.inventory.permissionDenied')"
      empty-icon="i-lucide-boxes"
    >
      <template #right>
        <UButton
          v-if="canWrite && tab === 'warehouses'"
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          size="sm"
          :label="t('admin.inventory.warehouses.create')"
          @click="openWarehouseCreate"
        />
        <UButton
          v-if="canWrite && tab === 'transfers'"
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          size="sm"
          :label="t('admin.inventory.transfers.create')"
          @click="openTransferCreate"
        />
        <UButton
          v-if="canWrite && tab === 'stocktakes'"
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          size="sm"
          :label="t('admin.inventory.stocktakes.create')"
          @click="openStocktakeCreate"
        />
        <UButton
          v-if="canWrite && tab === 'serials'"
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          size="sm"
          :label="t('admin.inventory.serials.create')"
          @click="openSerialCreate"
        />
      </template>

      <div v-if="canRead" class="flex flex-col gap-4">
        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="entry in tabs"
            :key="entry.key"
            :icon="entry.icon"
            :label="entry.label"
            size="sm"
            :color="tab === entry.key ? 'primary' : 'neutral'"
            :variant="tab === entry.key ? 'soft' : 'ghost'"
            @click="tab = entry.key"
          />
        </div>

        <!-- Balances -->
        <div v-if="tab === 'balances'" class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <UInput v-model="balanceQuery" icon="i-lucide-search" size="sm" class="w-full sm:w-64" :placeholder="t('admin.inventory.balances.searchPlaceholder')" />
            <USelect v-model="balanceWarehouse" :items="[{ label: t('admin.inventory.allWarehouses'), value: 'all' }, ...warehouseOptions]" value-key="value" size="sm" class="w-full sm:w-56" />
            <p class="text-xs text-muted">{{ t('admin.inventory.balances.summary', { all: balanceCounts.all, lowStock: balanceCounts.lowStock }) }}</p>
          </div>

          <p v-if="balanceError" class="text-xs text-error">{{ balanceError }}</p>
          <p v-else-if="balanceLoading && !balances.length" class="text-xs text-muted">{{ t('common.loading') }}</p>
          <p v-else-if="!balances.length" class="text-xs text-muted">{{ t('admin.inventory.balances.empty') }}</p>

          <div v-else class="overflow-hidden rounded-[4px] border border-default/60">
            <div v-for="balance in balances" :key="balance.id" class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs font-medium text-highlighted">{{ balance.sku || balance.itemId }}</span>
                  <UBadge v-if="balance.lowStockThreshold > 0 && balance.quantityAvailable <= balance.lowStockThreshold" color="warning" variant="subtle" size="sm">
                    {{ t('admin.inventory.balances.lowStock') }}
                  </UBadge>
                  <UBadge v-if="balance.binLocation" color="neutral" variant="subtle" size="sm">{{ balance.binLocation }}</UBadge>
                </div>
                <p class="mt-0.5 truncate text-xs text-muted">{{ warehouseName(balance.warehouseId) }}</p>
              </div>
              <div class="flex items-center gap-4 text-xs">
                <span>{{ t('admin.inventory.balances.onHand') }}: <strong>{{ money(balance.quantityOnHand) }}</strong></span>
                <span>{{ t('admin.inventory.balances.reserved') }}: <strong>{{ money(balance.quantityReserved) }}</strong></span>
                <span>{{ t('admin.inventory.balances.available') }}: <strong>{{ money(balance.quantityAvailable) }}</strong></span>
              </div>
            </div>
          </div>

          <div v-if="balanceHasMore" class="flex justify-center">
            <UButton color="neutral" variant="ghost" size="sm" :loading="balanceLoading" :label="t('admin.inventory.loadMore')" @click="loadBalances(false)" />
          </div>
        </div>

        <!-- Warehouses -->
        <div v-else-if="tab === 'warehouses'" class="flex flex-col gap-3">
          <p v-if="!warehouses.length" class="text-xs text-muted">{{ t('admin.inventory.warehouses.empty') }}</p>
          <div v-else class="overflow-hidden rounded-[4px] border border-default/60">
            <div v-for="warehouse in warehouses" :key="warehouse.id" class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="truncate font-medium text-highlighted">{{ warehouse.title }}</span>
                  <UBadge color="neutral" variant="subtle" size="sm">{{ warehouse.code }}</UBadge>
                  <UBadge :color="warehouse.status === 'active' ? 'success' : 'neutral'" variant="subtle" size="sm">
                    {{ t(`admin.inventory.warehouses.statuses.${warehouse.status}`) }}
                  </UBadge>
                  <UBadge v-if="warehouse.isDeleted" color="error" variant="subtle" size="sm">{{ t('admin.inventory.warehouses.hiddenBadge') }}</UBadge>
                </div>
                <p class="mt-0.5 truncate text-xs text-muted">
                  <span v-if="warehouse.address">{{ warehouse.address }}</span>
                  <span v-if="warehouse.phone"> · {{ warehouse.phone }}</span>
                  <span> · {{ t('admin.inventory.warehouses.revision', { revision: warehouse.revision }) }}</span>
                </p>
              </div>
              <div v-if="canWrite" class="flex items-center gap-1">
                <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="xs" :title="t('common.edit')" @click="openWarehouseEdit(warehouse)" />
                <UButton
                  v-if="warehouse.isDeleted"
                  icon="i-lucide-rotate-ccw"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :title="t('admin.inventory.warehouses.restore')"
                  @click="askWarehouse(warehouse, 'warehouse-restore')"
                />
                <UButton
                  v-else
                  icon="i-lucide-archive"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :title="t('admin.inventory.warehouses.hide')"
                  @click="askWarehouse(warehouse, 'warehouse-delete')"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Transfers -->
        <div v-else-if="tab === 'transfers'" class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <USelect v-model="transferStatus" :items="transferStatusOptions" value-key="value" size="sm" class="w-full sm:w-48" />
            <p class="text-xs text-muted">{{ t('admin.inventory.transfers.summary', { all: transferCounts.all, draft: transferCounts.draft, inTransit: transferCounts.inTransit }) }}</p>
          </div>

          <p v-if="!transfers.length" class="text-xs text-muted">{{ t('admin.inventory.transfers.empty') }}</p>
          <div v-else class="overflow-hidden rounded-[4px] border border-default/60">
            <div v-for="transfer in transfers" :key="transfer.id" class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs font-medium text-highlighted">{{ transfer.code }}</span>
                  <UBadge color="neutral" variant="subtle" size="sm">{{ t(`admin.inventory.transfers.statuses.${transfer.status}`) }}</UBadge>
                </div>
                <p class="mt-0.5 truncate text-xs text-muted">
                  {{ warehouseName(transfer.fromWarehouseId) }} → {{ warehouseName(transfer.toWarehouseId) }}
                  <span> · {{ t('admin.inventory.transfers.lineCount', { count: transfer.lines.length }) }}</span>
                </p>
              </div>
              <div v-if="canWrite" class="flex items-center gap-1">
                <UButton v-if="transfer.status === 'draft'" icon="i-lucide-truck" color="primary" variant="ghost" size="xs" :title="t('admin.inventory.transfers.ship')" @click="askTransfer(transfer, 'transfer-ship')" />
                <UButton v-if="transfer.status === 'in_transit'" icon="i-lucide-package-check" color="primary" variant="ghost" size="xs" :title="t('admin.inventory.transfers.receive')" @click="askTransfer(transfer, 'transfer-receive')" />
                <UButton v-if="transfer.status === 'draft' || transfer.status === 'in_transit'" icon="i-lucide-x" color="error" variant="ghost" size="xs" :title="t('admin.inventory.transfers.cancel')" @click="askTransfer(transfer, 'transfer-cancel')" />
              </div>
            </div>
          </div>

          <div v-if="transferHasMore" class="flex justify-center">
            <UButton color="neutral" variant="ghost" size="sm" :loading="transferLoading" :label="t('admin.inventory.loadMore')" @click="loadTransfers(false)" />
          </div>
        </div>

        <!-- Stocktakes -->
        <div v-else-if="tab === 'stocktakes'" class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <USelect v-model="stocktakeStatus" :items="stocktakeStatusOptions" value-key="value" size="sm" class="w-full sm:w-48" />
            <p class="text-xs text-muted">{{ t('admin.inventory.stocktakes.summary', { draft: stocktakeCounts.draft, completed: stocktakeCounts.completed }) }}</p>
          </div>

          <p v-if="!stocktakes.length" class="text-xs text-muted">{{ t('admin.inventory.stocktakes.empty') }}</p>
          <div v-else class="overflow-hidden rounded-[4px] border border-default/60">
            <div v-for="stocktake in stocktakes" :key="stocktake.id" class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs font-medium text-highlighted">{{ stocktake.code }}</span>
                  <UBadge color="neutral" variant="subtle" size="sm">{{ t(`admin.inventory.stocktakes.statuses.${stocktake.status}`) }}</UBadge>
                </div>
                <p class="mt-0.5 truncate text-xs text-muted">
                  {{ warehouseName(stocktake.warehouseId) }}
                  <span> · {{ t('admin.inventory.stocktakes.lineCount', { count: stocktake.lines.length }) }}</span>
                  <span v-if="stocktake.completedAt"> · {{ new Date(stocktake.completedAt).toLocaleString() }}</span>
                </p>
              </div>
              <div v-if="canWrite && stocktake.status === 'draft'" class="flex items-center gap-1">
                <UButton icon="i-lucide-check-check" color="primary" variant="ghost" size="xs" :title="t('admin.inventory.stocktakes.complete')" @click="askStocktake(stocktake, 'stocktake-complete')" />
                <UButton icon="i-lucide-x" color="error" variant="ghost" size="xs" :title="t('admin.inventory.stocktakes.cancel')" @click="askStocktake(stocktake, 'stocktake-cancel')" />
              </div>
            </div>
          </div>
        </div>
        <!-- Serials / IMEI -->
        <div v-else class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <UInput v-model="serialQuery" icon="i-lucide-search" size="sm" class="w-full sm:w-56" :placeholder="t('admin.inventory.serials.searchPlaceholder')" />
            <USelect v-model="serialStatus" :items="serialStatusOptions" value-key="value" size="sm" class="w-full sm:w-44" />
            <USelect v-model="serialWarehouse" :items="[{ label: t('admin.inventory.allWarehouses'), value: 'all' }, ...warehouseOptions]" value-key="value" size="sm" class="w-full sm:w-52" />
            <UCheckbox v-model="serialIncludeDeleted" :label="t('admin.inventory.serials.includeDeleted')" />
          </div>
          <p class="text-xs text-muted">
            {{ t('admin.inventory.serials.summary', { all: serialCounts.all, inStock: serialCounts.in_stock, sold: serialCounts.sold, returned: serialCounts.returned, scrapped: serialCounts.scrapped }) }}
          </p>

          <p v-if="serialError" class="text-xs text-error">{{ serialError }}</p>
          <p v-else-if="serialLoading && !serials.length" class="text-xs text-muted">{{ t('common.loading') }}</p>
          <p v-else-if="!serials.length" class="text-xs text-muted">{{ t('admin.inventory.serials.empty') }}</p>

          <div v-else class="overflow-hidden rounded-[4px] border border-default/60">
            <div v-for="serial in serials" :key="serial.id" class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs font-medium text-highlighted">{{ serial.serial }}</span>
                  <UBadge :color="serialStatusColor(serial.status)" variant="subtle" size="sm">
                    {{ t(`admin.inventory.serials.statuses.${serial.status}`) }}
                  </UBadge>
                  <UBadge v-if="serial.isDeleted" color="error" variant="subtle" size="sm">{{ t('admin.inventory.warehouses.hiddenBadge') }}</UBadge>
                </div>
                <p class="mt-0.5 truncate text-xs text-muted">
                  {{ serialItemLabel(serial.itemId) }} · {{ warehouseName(serial.warehouseId) }}
                  <span v-if="serial.orderId"> · {{ t('admin.inventory.serials.order', { order: serial.orderId }) }}</span>
                  <span> · {{ t('admin.inventory.warehouses.revision', { revision: serial.revision }) }}</span>
                </p>
                <p v-if="serial.note" class="mt-0.5 truncate text-xs text-muted">{{ serial.note }}</p>
              </div>
              <div v-if="canWrite" class="flex items-center gap-1">
                <template v-if="serial.isDeleted">
                  <UButton icon="i-lucide-rotate-ccw" color="neutral" variant="ghost" size="xs" :title="t('admin.inventory.serials.actions.restore')" @click="askSerial(serial, 'restore')" />
                </template>
                <template v-else>
                  <UButton v-if="serial.status === 'in_stock'" icon="i-lucide-badge-check" color="primary" variant="ghost" size="xs" :title="t('admin.inventory.serials.actions.sold')" @click="askSerial(serial, 'sold')" />
                  <UButton v-if="serial.status === 'in_stock'" icon="i-lucide-arrow-left-right" color="neutral" variant="ghost" size="xs" :title="t('admin.inventory.serials.actions.move')" @click="askSerial(serial, 'move')" />
                  <UButton v-if="serial.status === 'sold'" icon="i-lucide-undo-2" color="warning" variant="ghost" size="xs" :title="t('admin.inventory.serials.actions.returned')" @click="askSerial(serial, 'returned')" />
                  <UButton v-if="serial.status !== 'scrapped'" icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" :title="t('admin.inventory.serials.actions.scrap')" @click="askSerial(serial, 'scrap')" />
                  <UButton icon="i-lucide-archive" color="error" variant="ghost" size="xs" :title="t('admin.inventory.serials.actions.hide')" @click="askSerial(serial, 'hide')" />
                </template>
              </div>
            </div>
          </div>

          <div v-if="serialHasMore" class="flex justify-center">
            <UButton color="neutral" variant="ghost" size="sm" :loading="serialLoading" :label="t('admin.inventory.loadMore')" @click="loadSerials(false)" />
          </div>
        </div>
      </div>
    </CmsBasePage>

    <!-- Warehouse form -->
    <UModal v-model:open="warehouseFormOpen" :title="warehouseEditing ? t('admin.inventory.warehouses.editTitle') : t('admin.inventory.warehouses.createTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-lg' }">
      <template #body>
        <div class="flex flex-col gap-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.inventory.warehouses.fields.code')">
              <UInput v-model="warehouseForm.code" class="w-full" :disabled="Boolean(warehouseEditing)" :placeholder="t('admin.inventory.warehouses.codePlaceholder')" />
            </UFormField>
            <UFormField :label="t('admin.inventory.warehouses.fields.title')">
              <UInput v-model="warehouseForm.title" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.inventory.warehouses.fields.phone')">
              <UInput v-model="warehouseForm.phone" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.inventory.warehouses.fields.status')">
              <USelect v-model="warehouseForm.status" :items="[{ label: t('admin.inventory.warehouses.statuses.active'), value: 'active' }, { label: t('admin.inventory.warehouses.statuses.inactive'), value: 'inactive' }]" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.inventory.warehouses.fields.address')" class="sm:col-span-2">
              <UInput v-model="warehouseForm.address" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.inventory.warehouses.fields.description')" class="sm:col-span-2">
              <UTextarea v-model="warehouseForm.description" :rows="2" class="w-full" />
            </UFormField>
          </div>
          <AuditReasonField v-model="auditReason" />
          <p v-if="warehouseError" class="text-xs text-error">{{ warehouseError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="warehouseFormOpen = false" />
          <UButton color="primary" variant="soft" :loading="warehouseSaving" :label="t('common.save')" @click="submitWarehouse" />
        </div>
      </template>
    </UModal>

    <!-- Transfer create -->
    <UModal v-model:open="transferFormOpen" :title="t('admin.inventory.transfers.createTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-2xl' }">
      <template #body>
        <div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto scroll-thin">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.inventory.transfers.fields.from')">
              <USelect v-model="transferForm.from" :items="warehouseOptions" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.inventory.transfers.fields.to')">
              <USelect v-model="transferForm.to" :items="warehouseOptions" value-key="value" class="w-full" />
            </UFormField>
          </div>

          <div class="flex flex-wrap items-end gap-2">
            <USelectMenu
              v-model="pickedTransferItem"
              :items="itemOptions"
              value-key="value"
              searchable
              class="min-w-56 flex-1"
              :placeholder="t('admin.inventory.transfers.pickItem')"
              @update:search-term="searchItems"
            />
            <UButton icon="i-lucide-plus" color="neutral" variant="soft" size="sm" :label="t('admin.inventory.transfers.addLine')" :disabled="!pickedTransferItem" @click="addTransferLine" />
          </div>

          <p v-if="!transferForm.lines.length" class="text-xs text-muted">{{ t('admin.inventory.transfers.noLines') }}</p>

          <div v-for="(line, index) in transferForm.lines" :key="index" class="flex flex-wrap items-end gap-2 rounded-[4px] border border-default/60 p-2">
            <div class="min-w-40 flex-1">
              <p class="truncate text-sm font-medium text-highlighted">{{ line.itemName }}</p>
              <p class="text-xs text-muted">{{ line.sku || '—' }}</p>
            </div>
            <UFormField :label="t('admin.inventory.transfers.fields.quantity')" class="w-24">
              <UInput v-model.number="line.quantity" type="number" min="1" size="sm" class="w-full" />
            </UFormField>
            <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" @click="transferForm.lines.splice(index, 1)" />
          </div>

          <UFormField :label="t('admin.inventory.transfers.fields.note')">
            <UTextarea v-model="transferForm.note" :rows="2" class="w-full" />
          </UFormField>

          <AuditReasonField v-model="auditReason" />
          <p v-if="transferError" class="text-xs text-error">{{ transferError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="transferFormOpen = false" />
          <UButton color="primary" variant="soft" :loading="transferSaving" :label="t('common.save')" @click="submitTransfer" />
        </div>
      </template>
    </UModal>

    <!-- Stocktake create -->
    <UModal v-model:open="stocktakeFormOpen" :title="t('admin.inventory.stocktakes.createTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-2xl' }">
      <template #body>
        <div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto scroll-thin">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.inventory.stocktakes.fields.code')">
              <UInput v-model="stocktakeForm.code" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.inventory.stocktakes.fields.warehouse')">
              <USelect v-model="stocktakeForm.warehouseId" :items="warehouseOptions" value-key="value" class="w-full" />
            </UFormField>
          </div>

          <div class="flex flex-wrap items-end gap-2">
            <USelectMenu
              v-model="pickedStocktakeItem"
              :items="itemOptions"
              value-key="value"
              searchable
              class="min-w-56 flex-1"
              :placeholder="t('admin.inventory.stocktakes.pickItem')"
              @update:search-term="searchItems"
            />
            <UButton icon="i-lucide-plus" color="neutral" variant="soft" size="sm" :label="t('admin.inventory.stocktakes.addLine')" :disabled="!pickedStocktakeItem" @click="addStocktakeLine" />
          </div>

          <p v-if="!stocktakeForm.lines.length" class="text-xs text-muted">{{ t('admin.inventory.stocktakes.noLines') }}</p>

          <div v-for="(line, index) in stocktakeForm.lines" :key="index" class="flex flex-wrap items-end gap-2 rounded-[4px] border border-default/60 p-2">
            <div class="min-w-40 flex-1">
              <p class="truncate text-sm font-medium text-highlighted">{{ line.itemName }}</p>
              <p class="text-xs text-muted">{{ line.sku || '—' }}</p>
            </div>
            <UFormField :label="t('admin.inventory.stocktakes.fields.counted')" class="w-24">
              <UInput v-model.number="line.countedQuantity" type="number" min="0" size="sm" class="w-full" />
            </UFormField>
            <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" @click="stocktakeForm.lines.splice(index, 1)" />
          </div>

          <UFormField :label="t('admin.inventory.stocktakes.fields.note')">
            <UTextarea v-model="stocktakeForm.note" :rows="2" class="w-full" />
          </UFormField>

          <AuditReasonField v-model="auditReason" />
          <p v-if="stocktakeError" class="text-xs text-error">{{ stocktakeError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="stocktakeFormOpen = false" />
          <UButton color="primary" variant="soft" :loading="stocktakeSaving" :label="t('common.save')" @click="submitStocktake" />
        </div>
      </template>
    </UModal>

    <!-- Serial register -->
    <UModal v-model:open="serialFormOpen" :title="t('admin.inventory.serials.createTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-xl' }">
      <template #body>
        <div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto scroll-thin">
          <UFormField :label="t('admin.inventory.serials.fields.item')">
            <USelectMenu
              v-model="pickedSerialItem"
              :items="itemOptions"
              value-key="value"
              searchable
              class="w-full"
              :placeholder="t('admin.inventory.transfers.pickItem')"
              @update:search-term="searchItems"
            />
          </UFormField>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.inventory.serials.fields.warehouse')">
              <USelect
                v-model="serialForm.warehouseId"
                :items="[{ label: t('admin.inventory.serials.noWarehouse'), value: NO_WAREHOUSE }, ...warehouseOptions]"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="t('admin.inventory.serials.fields.note')">
              <UInput v-model="serialForm.note" class="w-full" />
            </UFormField>
          </div>
          <UFormField :label="t('admin.inventory.serials.fields.serials')">
            <UTextarea v-model="serialForm.serials" :rows="4" class="w-full" :placeholder="t('admin.inventory.serials.fields.serialsPlaceholder')" />
          </UFormField>
          <AuditReasonField v-model="auditReason" />
          <p v-if="serialFormError" class="text-xs text-error">{{ serialFormError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="serialFormOpen = false" />
          <UButton color="primary" variant="soft" :loading="serialSaving" :label="t('common.save')" @click="submitSerials" />
        </div>
      </template>
    </UModal>

    <!-- Serial status action -->
    <UModal v-model:open="serialActionOpen" :title="serialActionTitle" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }">
      <template #body>
        <div class="flex flex-col gap-3">
          <p class="text-sm text-toned">
            <span class="font-mono">{{ serialTarget?.serial }}</span>
            <span v-if="serialTarget"> · {{ warehouseName(serialTarget.warehouseId) }}</span>
          </p>
          <UFormField v-if="serialActionKind === 'sold'" :label="t('admin.inventory.serials.fields.orderId')">
            <UInput v-model="serialActionOrderId" class="w-full" />
          </UFormField>
          <UFormField v-if="serialActionKind === 'move'" :label="t('admin.inventory.serials.fields.warehouse')">
            <USelect v-model="serialActionWarehouse" :items="warehouseOptions" value-key="value" class="w-full" />
          </UFormField>
          <AuditReasonField v-model="auditReason" />
          <p v-if="serialActionError" class="text-xs text-error">{{ serialActionError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="serialActionOpen = false" />
          <UButton color="primary" variant="soft" :loading="serialActionBusy" :label="t('common.confirm')" @click="runSerialAction" />
        </div>
      </template>
    </UModal>

    <!-- Confirm warehouse / transfer / stocktake actions -->
    <UModal v-model:open="confirmOpen" :title="confirmTitle" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }">
      <template #body>
        <div class="flex flex-col gap-3">
          <p class="text-sm text-toned">
            <template v-if="confirmWarehouse">{{ confirmWarehouse.title }} ({{ confirmWarehouse.code }})</template>
            <template v-else-if="confirmTransfer">
              {{ confirmTransfer.code }} · {{ warehouseName(confirmTransfer.fromWarehouseId) }} → {{ warehouseName(confirmTransfer.toWarehouseId) }}
            </template>
            <template v-else-if="confirmStocktake">
              {{ confirmStocktake.code }} · {{ warehouseName(confirmStocktake.warehouseId) }}
            </template>
          </p>
          <p v-if="confirmKind === 'stocktake-complete'" class="text-xs text-muted">{{ t('admin.inventory.stocktakes.completeHint') }}</p>
          <AuditReasonField v-model="auditReason" />
          <p v-if="confirmError" class="text-xs text-error">{{ confirmError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="confirmOpen = false" />
          <UButton color="primary" variant="soft" :loading="confirmBusy" :label="t('common.confirm')" @click="runConfirm" />
        </div>
      </template>
    </UModal>
  </div>
</template>
