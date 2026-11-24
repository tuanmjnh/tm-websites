<script setup lang="ts">
import type { AdminSupplier, AdminPurchaseOrder } from '../composables/useOperationsAdmin'

const { t } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const ops = useOperationsAdmin()

const canRead = computed(() => hasCapability('content.read'))
const canWrite = computed(() => hasCapability('content.write'))

const loading = ref(false)
const error = ref<string | null>(null)
const suppliers = ref<AdminSupplier[]>([])
const selectedSupplier = ref<string>('')
const orders = ref<AdminPurchaseOrder[]>([])

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.round(value))} ₫`

const loadSuppliers = async () => {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const page = await ops.listSuppliers({ limit: 100 })
    suppliers.value = page.data
    if (!selectedSupplier.value && suppliers.value.length) selectedSupplier.value = suppliers.value[0]?.id ?? ''
    await loadOrders()
  } catch (e) {
    error.value = (e as Error)?.message ?? 'Load failed'
  } finally {
    loading.value = false
  }
}

const loadOrders = async () => {
  if (!selectedSupplier.value) { orders.value = []; return }
  loading.value = true
  try {
    const page = await ops.listPurchaseOrders({ supplier: selectedSupplier.value, limit: 100 })
    orders.value = page.data
  } catch (e) {
    error.value = (e as Error)?.message ?? 'Load failed'
  } finally {
    loading.value = false
  }
}

watch(selectedSupplier, () => { void loadOrders() })
onMounted(() => { void loadSuppliers() })

const receive = async (row: AdminPurchaseOrder) => {
  if (!canWrite.value) return
  try {
    await ops.receivePurchaseOrder(row.id, { revision: row.revision })
    toast.add({ title: t('admin.supplierPortal.received'), color: 'success' })
    await loadOrders()
  } catch (e) {
    toast.add({ title: (e as Error)?.message ?? 'Receive failed', color: 'error' })
  }
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-semibold text-highlighted">{{ t('admin.supplierPortal.title') }}</h1>

    <p v-if="error" class="text-sm text-error">{{ error }}</p>

    <div class="flex flex-wrap items-center gap-2">
      <USelect v-model="selectedSupplier" :items="suppliers.map((s) => ({ label: s.title || s.code, value: s.id }))" value-key="value" class="w-64" />
      <UButton color="primary" :loading="loading" :label="t('admin.supplierPortal.refresh')" @click="loadOrders" />
    </div>

    <div class="overflow-hidden rounded-md border border-default">
      <table class="w-full text-left text-sm">
        <thead class="bg-elevated/40 text-xs uppercase text-muted">
          <tr>
            <th class="px-3 py-2 font-medium">{{ t('admin.supplierPortal.code') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('admin.supplierPortal.status') }}</th>
            <th class="px-3 py-2 text-right font-medium">{{ t('admin.supplierPortal.total') }}</th>
            <th class="px-3 py-2" />
          </tr>
        </thead>
        <tbody class="divide-y divide-default/60">
          <tr v-for="row in orders" :key="row.id">
            <td class="px-3 py-2 font-medium text-highlighted">{{ row.code }}</td>
            <td class="px-3 py-2 text-muted">{{ row.status }}</td>
            <td class="px-3 py-2 text-right">{{ money(row.totalAmount ?? 0) }}</td>
            <td class="px-3 py-2 text-right">
              <UButton v-if="canWrite" size="xs" color="primary" :label="t('admin.supplierPortal.receive')" @click="receive(row)" />
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!orders.length && !loading" class="p-6 text-center text-sm text-muted">{{ t('admin.supplierPortal.empty') }}</p>
    </div>
  </div>
</template>