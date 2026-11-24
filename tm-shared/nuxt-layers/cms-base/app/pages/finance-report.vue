<script setup lang="ts">
import type { AdminOrder, AdminPayment, AdminPayable } from '../composables/useOperationsAdmin'

const { t } = useI18n()
const { hasCapability } = useHub()
const ops = useOperationsAdmin()

const canRead = computed(() => hasCapability('content.read'))

const loading = ref(false)
const error = ref<string | null>(null)
const orders = ref<AdminOrder[]>([])
const payments = ref<AdminPayment[]>([])
const payables = ref<AdminPayable[]>([])

const fromDate = ref('')
const toDate = ref('')

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.round(value))} ₫`

const inRange = (iso: string | null | undefined) => {
  if (!iso) return true
  const d = new Date(iso)
  if (fromDate.value && d < new Date(fromDate.value)) return false
  if (toDate.value) {
    const end = new Date(toDate.value)
    end.setHours(23, 59, 59, 999)
    if (d > end) return false
  }
  return true
}

const filteredOrders = computed(() => orders.value.filter((o) => inRange(o.createdAt)))
const filteredPayments = computed(() => payments.value.filter((p) => inRange(p.createdAt)))
const filteredPayables = computed(() => payables.value.filter((p) => inRange(p.createdAt)))

const totalOrders = computed(() => filteredOrders.value.length)
const totalRevenue = computed(() => filteredOrders.value.reduce((s, o) => s + (o.totalAmount ?? 0), 0))
const totalItemsPrice = computed(() => filteredOrders.value.reduce((s, o) => s + (o.itemsPrice ?? 0), 0))

const ordersByStatus = computed(() => {
  const map: Record<string, number> = {}
  for (const o of filteredOrders.value) map[o.status ?? 'unknown'] = (map[o.status ?? 'unknown'] ?? 0) + 1
  return map
})

const receivablePosted = computed(() => filteredPayments.value.filter((p) => p.direction === 'receivable' && p.state === 'posted').reduce((s, p) => s + (p.amount ?? 0), 0))
const payablePosted = computed(() => filteredPayments.value.filter((p) => p.direction === 'payable' && p.state === 'posted').reduce((s, p) => s + (p.amount ?? 0), 0))

const openPayables = computed(() => filteredPayables.value.filter((p) => p.status !== 'voided' && p.status !== 'paid').reduce((s, p) => s + (p.amount ?? 0), 0))

const loadAll = async () => {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    // orders
    const allOrders: AdminOrder[] = []
    let cursor: string | null = null
    for (let i = 0; i < 20; i++) {
      const page = await ops.listOrders({ cursor, limit: 100 })
      allOrders.push(...page.data)
      cursor = page.nextCursor
      if (!page.hasMore) break
    }
    orders.value = allOrders

    // payments
    const allPayments: AdminPayment[] = []
    cursor = null
    for (let i = 0; i < 20; i++) {
      const page = await ops.listPayments({ cursor, limit: 100 })
      allPayments.push(...page.data)
      cursor = page.nextCursor
      if (!page.hasMore) break
    }
    payments.value = allPayments

    // payables
    const allPayables: AdminPayable[] = []
    cursor = null
    for (let i = 0; i < 20; i++) {
      const page = await ops.listPayables({ cursor, limit: 100 })
      allPayables.push(...page.data)
      cursor = page.nextCursor
      if (!page.hasMore) break
    }
    payables.value = allPayables
  } catch (e) {
    error.value = (e as Error)?.message ?? 'Load failed'
  } finally {
    loading.value = false
  }
}

onMounted(() => { void loadAll() })
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-xl font-semibold text-highlighted">{{ t('admin.financeReport.title') }}</h1>
      <div class="flex flex-wrap items-center gap-2">
        <UInput v-model="fromDate" type="date" />
        <UInput v-model="toDate" type="date" />
        <UButton color="primary" :loading="loading" :label="t('admin.financeReport.refresh')" @click="loadAll" />
      </div>
    </div>

    <p v-if="error" class="text-sm text-error">{{ error }}</p>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-md border border-default p-4">
        <p class="text-xs text-muted">{{ t('admin.financeReport.totalOrders') }}</p>
        <p class="text-lg font-semibold">{{ totalOrders }}</p>
      </div>
      <div class="rounded-md border border-default p-4">
        <p class="text-xs text-muted">{{ t('admin.financeReport.totalRevenue') }}</p>
        <p class="text-lg font-semibold">{{ money(totalRevenue) }}</p>
      </div>
      <div class="rounded-md border border-default p-4">
        <p class="text-xs text-muted">{{ t('admin.financeReport.receivablePosted') }}</p>
        <p class="text-lg font-semibold">{{ money(receivablePosted) }}</p>
      </div>
      <div class="rounded-md border border-default p-4">
        <p class="text-xs text-muted">{{ t('admin.financeReport.payablePosted') }}</p>
        <p class="text-lg font-semibold">{{ money(payablePosted) }}</p>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div class="rounded-md border border-default p-4">
        <p class="text-xs text-muted">{{ t('admin.financeReport.itemsPrice') }}</p>
        <p class="text-lg font-semibold">{{ money(totalItemsPrice) }}</p>
      </div>
      <div class="rounded-md border border-default p-4">
        <p class="text-xs text-muted">{{ t('admin.financeReport.openPayables') }}</p>
        <p class="text-lg font-semibold">{{ money(openPayables) }}</p>
      </div>
    </div>

    <div class="rounded-md border border-default p-4">
      <h2 class="mb-2 text-sm font-semibold text-highlighted">{{ t('admin.financeReport.ordersByStatus') }}</h2>
      <div class="flex flex-wrap gap-2">
        <span v-for="(count, status) in ordersByStatus" :key="status" class="rounded bg-elevated/40 px-2 py-1 text-xs">
          {{ status }}: {{ count }}
        </span>
      </div>
    </div>
  </div>
</template>