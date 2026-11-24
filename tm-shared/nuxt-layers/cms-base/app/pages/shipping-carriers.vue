<script setup lang="ts">
import type { AdminShippingCarrier } from '../composables/useShippingCarriersAdmin'

const { t } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const api = useShippingCarriersAdmin()

const canRead = computed(() => hasCapability('content.read'))
const canWrite = computed(() => hasCapability('content.write'))

const loading = ref(false)
const error = ref<string | null>(null)
const rows = ref<AdminShippingCarrier[]>([])

const showForm = ref(false)
const editing = ref<AdminShippingCarrier | null>(null)
const form = reactive({
  code: '',
  name: '',
  trackingUrl: '',
  phone: '',
  note: '',
  isActive: true,
  sort: 0,
})

const resetForm = () => {
  form.code = ''
  form.name = ''
  form.trackingUrl = ''
  form.phone = ''
  form.note = ''
  form.isActive = true
  form.sort = 0
  editing.value = null
}

const load = async () => {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const page = await api.list({ limit: 100 })
    rows.value = page.data
  } catch (e) {
    error.value = (e as Error)?.message ?? 'Load failed'
  } finally {
    loading.value = false
  }
}

const openCreate = () => {
  resetForm()
  showForm.value = true
}

const openEdit = (row: AdminShippingCarrier) => {
  editing.value = row
  form.code = row.code
  form.name = row.name
  form.trackingUrl = row.trackingUrl
  form.phone = row.phone
  form.note = row.note
  form.isActive = row.isActive
  form.sort = row.sort
  showForm.value = true
}

const save = async () => {
  if (!canWrite.value) return
  const body = { ...form }
  try {
    if (editing.value) {
      await api.update(editing.value.id, body)
    } else {
      await api.create(body)
    }
    toast.add({ title: t('admin.shippingCarriers.saved'), color: 'success' })
    showForm.value = false
    resetForm()
    await load()
  } catch (e) {
    toast.add({ title: (e as Error)?.message ?? 'Save failed', color: 'error' })
  }
}

const remove = async (row: AdminShippingCarrier) => {
  if (!canWrite.value) return
  try {
    await api.remove(row.id, row.revision)
    toast.add({ title: t('admin.shippingCarriers.deleted'), color: 'success' })
    await load()
  } catch (e) {
    toast.add({ title: (e as Error)?.message ?? 'Delete failed', color: 'error' })
  }
}

const restore = async (row: AdminShippingCarrier) => {
  if (!canWrite.value) return
  try {
    await api.restore(row.id)
    toast.add({ title: t('admin.shippingCarriers.restored'), color: 'success' })
    await load()
  } catch (e) {
    toast.add({ title: (e as Error)?.message ?? 'Restore failed', color: 'error' })
  }
}

onMounted(() => { void load() })
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-highlighted">{{ t('admin.shippingCarriers.title') }}</h1>
      <UButton v-if="canWrite" color="primary" :label="t('admin.shippingCarriers.create')" @click="openCreate" />
    </div>

    <p v-if="error" class="text-sm text-error">{{ error }}</p>

    <div class="overflow-hidden rounded-md border border-default">
      <table class="w-full text-left text-sm">
        <thead class="bg-elevated/40 text-xs uppercase text-muted">
          <tr>
            <th class="px-3 py-2 font-medium">{{ t('admin.shippingCarriers.code') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('admin.shippingCarriers.name') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('admin.shippingCarriers.trackingUrl') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('admin.shippingCarriers.status') }}</th>
            <th class="px-3 py-2" />
          </tr>
        </thead>
        <tbody class="divide-y divide-default/60">
          <tr v-for="row in rows" :key="row.id">
            <td class="px-3 py-2 font-medium text-highlighted">{{ row.code }}</td>
            <td class="px-3 py-2">{{ row.name }}</td>
            <td class="px-3 py-2 text-muted">{{ row.trackingUrl || '—' }}</td>
            <td class="px-3 py-2">
              <UBadge :color="row.isDeleted ? 'neutral' : (row.isActive ? 'success' : 'warning')" variant="subtle" size="sm">
                {{ row.isDeleted ? t('common.deleted') : (row.isActive ? t('common.active') : t('common.inactive')) }}
              </UBadge>
            </td>
            <td class="px-3 py-2 text-right">
              <div class="flex justify-end gap-1">
                <UButton v-if="canWrite && !row.isDeleted" size="xs" variant="ghost" :label="t('common.edit')" @click="openEdit(row)" />
                <UButton v-if="canWrite && !row.isDeleted" size="xs" color="error" variant="ghost" :label="t('common.delete')" @click="remove(row)" />
                <UButton v-if="canWrite && row.isDeleted" size="xs" color="primary" variant="ghost" :label="t('common.restore')" @click="restore(row)" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rows.length && !loading" class="p-6 text-center text-sm text-muted">{{ t('admin.shippingCarriers.empty') }}</p>
    </div>

    <UModal v-model:open="showForm" :title="editing ? t('admin.shippingCarriers.edit') : t('admin.shippingCarriers.create')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-lg' }">
      <template #body>
        <div class="space-y-3 p-4">
          <h2 class="text-lg font-semibold text-highlighted">{{ editing ? t('admin.shippingCarriers.edit') : t('admin.shippingCarriers.create') }}</h2>
          <UFormField :label="t('admin.shippingCarriers.code')">
            <UInput v-model="form.code" size="sm" :disabled="!!editing" />
          </UFormField>
          <UFormField :label="t('admin.shippingCarriers.name')">
            <UInput v-model="form.name" size="sm" />
          </UFormField>
          <UFormField :label="t('admin.shippingCarriers.trackingUrl')">
            <UInput v-model="form.trackingUrl" size="sm" />
          </UFormField>
          <UFormField :label="t('admin.shippingCarriers.phone')">
            <UInput v-model="form.phone" size="sm" />
          </UFormField>
          <UFormField :label="t('admin.shippingCarriers.note')">
            <UInput v-model="form.note" size="sm" />
          </UFormField>
          <UFormField :label="t('admin.shippingCarriers.sort')">
            <UInput v-model.number="form.sort" size="sm" type="number" />
          </UFormField>
          <USwitch v-model="form.isActive" :label="t('admin.shippingCarriers.active')" />
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="showForm = false" />
            <UButton color="primary" :label="t('common.save')" @click="save" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>