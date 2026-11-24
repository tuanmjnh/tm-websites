<script setup lang="ts">
import type { AdminKeyword } from '../composables/useKeywordsAdmin'

const { t } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const { list, create, update, remove, restore } = useKeywordsAdmin()

const canRead = computed(() => hasCapability('content.read'))
const canWrite = computed(() => hasCapability('content.write'))

const loading = ref(false)
const error = ref<string | null>(null)
const rows = ref<AdminKeyword[]>([])
const includeDeleted = ref(false)
const nextCursor = ref<string | null>(null)
const hasMore = ref(false)

const formOpen = ref(false)
const editing = ref<AdminKeyword | null>(null)
const saving = ref(false)
const formError = ref<string | null>(null)

const emptyForm = () => ({ slug: '', title: '', color: '', scope: 'share', count: 0, isActive: true })
const form = reactive(emptyForm())

const load = async (append = false) => {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const page = await list({ includeDeleted: includeDeleted.value, cursor: append ? nextCursor.value : null, limit: 50 })
    rows.value = append ? [...rows.value, ...page.data] : page.data
    nextCursor.value = page.nextCursor
    hasMore.value = page.hasMore
  } catch (e) {
    error.value = (e as Error)?.message ?? 'Load failed'
  } finally {
    loading.value = false
  }
}

watch(includeDeleted, () => { void load(false) })
onMounted(() => { void load(false) })

const openCreate = () => { editing.value = null; Object.assign(form, emptyForm()); formOpen.value = true }
const openEdit = (row: AdminKeyword) => {
  editing.value = row
  form.slug = row.slug; form.title = row.title; form.color = row.color; form.scope = row.scope; form.count = row.count; form.isActive = row.isActive
  formOpen.value = true
}
const closeForm = () => { formOpen.value = false; editing.value = null; formError.value = null }

const submit = async () => {
  if (!canWrite.value) return
  saving.value = true
  formError.value = null
  try {
    const body = { slug: form.slug, title: form.title, color: form.color, scope: form.scope, count: Number(form.count) || 0, isActive: form.isActive }
    if (editing.value) { await update(editing.value.id, body); toast.add({ title: t('admin.keywords.updated'), color: 'success' }) }
    else { await create(body); toast.add({ title: t('admin.keywords.created'), color: 'success' }) }
    closeForm(); await load(false)
  } catch (e) { formError.value = (e as Error)?.message ?? 'Save failed' }
  finally { saving.value = false }
}

const removeRow = async (row: AdminKeyword) => {
  if (!canWrite.value) return
  try { await remove(row.id, row.revision); toast.add({ title: t('admin.keywords.deleted'), color: 'success' }); await load(false) }
  catch (e) { toast.add({ title: (e as Error)?.message ?? 'Delete failed', color: 'error' }) }
}

const restoreRow = async (row: AdminKeyword) => {
  if (!canWrite.value) return
  try { await restore(row.id); toast.add({ title: t('admin.keywords.restored'), color: 'success' }); await load(false) }
  catch (e) { toast.add({ title: (e as Error)?.message ?? 'Restore failed', color: 'error' }) }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-highlighted">{{ t('admin.keywords.title') }}</h1>
      <div class="flex items-center gap-2">
        <UCheckbox v-model="includeDeleted" :label="t('admin.common.includeDeleted')" />
        <UButton v-if="canWrite" color="primary" icon="i-lucide-plus" :label="t('admin.keywords.create')" @click="openCreate" />
      </div>
    </div>
    <p v-if="error" class="text-sm text-error">{{ error }}</p>
    <div class="overflow-hidden rounded-md border border-default">
      <table class="w-full text-left text-sm">
        <thead class="bg-elevated/40 text-xs uppercase text-muted">
          <tr>
            <th class="px-3 py-2 font-medium">{{ t('admin.keywords.slug') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('admin.keywords.titleCol') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('admin.keywords.color') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('admin.keywords.count') }}</th>
            <th class="px-3 py-2" />
          </tr>
        </thead>
        <tbody class="divide-y divide-default/60">
          <tr v-for="row in rows" :key="row.id">
            <td class="px-3 py-2 font-medium text-highlighted">{{ row.slug }}</td>
            <td class="px-3 py-2">{{ row.title }}</td>
            <td class="px-3 py-2 text-muted">{{ row.color }}</td>
            <td class="px-3 py-2 text-muted">{{ row.count }}</td>
            <td class="px-3 py-2 text-right">
              <div class="flex justify-end gap-1">
                <UButton v-if="canWrite && !row.isDeleted" size="xs" variant="ghost" icon="i-lucide-pencil" @click="openEdit(row)" />
                <UButton v-if="canWrite && row.isDeleted" size="xs" variant="ghost" icon="i-lucide-rotate-ccw" @click="restoreRow(row)" />
                <UButton v-if="canWrite && !row.isDeleted" size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeRow(row)" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rows.length && !loading" class="p-6 text-center text-sm text-muted">{{ t('admin.keywords.empty') }}</p>
    </div>
    <UButton v-if="hasMore" variant="ghost" :loading="loading" :label="t('admin.common.loadMore')" @click="load(true)" />

    <UModal v-model="formOpen">
      <template #header><h3 class="text-base font-semibold">{{ editing ? t('admin.keywords.edit') : t('admin.keywords.create') }}</h3></template>
      <template #body>
        <div class="space-y-3">
          <UFormField :label="t('admin.keywords.slug')"><UInput v-model="form.slug" class="w-full" :disabled="!!editing" /></UFormField>
          <UFormField :label="t('admin.keywords.titleCol')"><UInput v-model="form.title" class="w-full" /></UFormField>
          <UFormField :label="t('admin.keywords.color')"><UInput v-model="form.color" class="w-full" /></UFormField>
          <UFormField :label="t('admin.keywords.scope')"><UInput v-model="form.scope" class="w-full" /></UFormField>
          <UFormField :label="t('admin.keywords.count')"><UInput v-model="form.count" type="number" class="w-full" /></UFormField>
          <UCheckbox v-model="form.isActive" :label="t('admin.common.active')" />
          <p v-if="formError" class="text-sm text-error">{{ formError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" :label="t('admin.common.cancel')" @click="closeForm" />
          <UButton color="primary" :loading="saving" :label="t('admin.common.save')" @click="submit" />
        </div>
      </template>
    </UModal>
  </div>
</template>