<script setup lang="ts">
import type { AdminDocumentTemplate } from '../composables/useDocumentTemplatesAdmin'

const { t } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const { list, get, create, update, remove } = useDocumentTemplatesAdmin()

const canRead = computed(() => hasCapability('content.read'))
const canWrite = computed(() => hasCapability('content.write'))

const loading = ref(false)
const error = ref<string | null>(null)
const rows = ref<AdminDocumentTemplate[]>([])
const includeDeleted = ref(false)
const nextCursor = ref<string | null>(null)
const hasMore = ref(false)

const formOpen = ref(false)
const editing = ref<AdminDocumentTemplate | null>(null)
const saving = ref(false)
const formError = ref<string | null>(null)
const auditReason = ref('')

const TABS = ['header', 'table', 'footer', 'style'] as const
type Tab = (typeof TABS)[number]
const activeTab = ref<Tab>('header')

const emptyForm = () => ({
  name: '',
  code: '',
  type: 'quotation',
  isDefault: false,
  primaryColor: '#0284c7',
  showLogo: true,
  title: 'BẢNG BÁO GIÁ',
  subtitle: '',
  companyName: '',
  companyAddress: '',
  companyPhone: '',
  companyEmail: '',
  companyTaxCode: '',
  companyWebsite: '',
  showSku: true,
  showThumbnail: false,
  showUom: true,
  showUnitPrice: true,
  showDiscount: true,
  showTotalInWords: true,
  showBankAccounts: true,
  terms: '',
  notes: '',
  showSignatures: true,
  senderTitle: 'Người lập báo giá',
  receiverTitle: 'Khách hàng xác nhận',
  accountantTitle: 'Kế toán trưởng',
})
const form = reactive(emptyForm())

const load = async (append = false) => {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const result = await list({
      type: 'quotation',
      includeDeleted: includeDeleted.value,
      cursor: append ? nextCursor.value : undefined,
      limit: 20,
    })
    rows.value = append ? [...rows.value, ...result.data] : result.data
    nextCursor.value = result.nextCursor
    hasMore.value = result.hasMore
  } catch {
    error.value = t('admin.documentTemplates.loadFailed')
  } finally {
    loading.value = false
  }
}

watch(includeDeleted, () => { void load() })

const resetForm = () => {
  editing.value = null
  formError.value = null
  auditReason.value = ''
  activeTab.value = 'header'
  Object.assign(form, emptyForm())
}

const openCreate = () => {
  resetForm()
  formOpen.value = true
}

const openEdit = async (row: AdminDocumentTemplate) => {
  resetForm()
  editing.value = row
  try {
    const fresh = await get(row.id)
    Object.assign(form, {
      name: fresh.name,
      code: fresh.code,
      type: fresh.type,
      isDefault: fresh.isDefault,
      primaryColor: fresh.primaryColor,
      showLogo: fresh.showLogo,
      title: fresh.title,
      subtitle: fresh.subtitle,
      companyName: fresh.companyName,
      companyAddress: fresh.companyAddress,
      companyPhone: fresh.companyPhone,
      companyEmail: fresh.companyEmail,
      companyTaxCode: fresh.companyTaxCode,
      companyWebsite: fresh.companyWebsite,
      showSku: fresh.showSku,
      showThumbnail: fresh.showThumbnail,
      showUom: fresh.showUom,
      showUnitPrice: fresh.showUnitPrice,
      showDiscount: fresh.showDiscount,
      showTotalInWords: fresh.showTotalInWords,
      showBankAccounts: fresh.showBankAccounts,
      terms: fresh.terms,
      notes: fresh.notes,
      showSignatures: fresh.showSignatures,
      senderTitle: fresh.senderTitle,
      receiverTitle: fresh.receiverTitle,
      accountantTitle: fresh.accountantTitle,
    })
    formOpen.value = true
  } catch {
    toast.add({ title: t('admin.documentTemplates.loadFailed'), color: 'error' })
  }
}

const buildBody = () => ({
  name: form.name.trim(),
  code: form.code.trim() || form.name.trim(),
  type: form.type,
  isDefault: form.isDefault,
  primaryColor: form.primaryColor,
  showLogo: form.showLogo,
  title: form.title,
  subtitle: form.subtitle,
  companyName: form.companyName,
  companyAddress: form.companyAddress,
  companyPhone: form.companyPhone,
  companyEmail: form.companyEmail,
  companyTaxCode: form.companyTaxCode,
  companyWebsite: form.companyWebsite,
  showSku: form.showSku,
  showThumbnail: form.showThumbnail,
  showUom: form.showUom,
  showUnitPrice: form.showUnitPrice,
  showDiscount: form.showDiscount,
  showTotalInWords: form.showTotalInWords,
  showBankAccounts: form.showBankAccounts,
  terms: form.terms,
  notes: form.notes,
  showSignatures: form.showSignatures,
  senderTitle: form.senderTitle,
  receiverTitle: form.receiverTitle,
  accountantTitle: form.accountantTitle,
})

const submit = async () => {
  if (!canWrite.value || saving.value) return
  if (!form.name.trim()) {
    formError.value = t('admin.documentTemplates.nameRequired')
    return
  }
  saving.value = true
  formError.value = null
  try {
    if (editing.value) {
      await update(editing.value.id, { ...buildBody(), revision: editing.value.revision }, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.documentTemplates.updated'), color: 'success' })
    } else {
      await create(buildBody(), auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.documentTemplates.created'), color: 'success' })
    }
    formOpen.value = false
    await load()
  } catch {
    formError.value = t('admin.documentTemplates.saveFailed')
  } finally {
    saving.value = false
  }
}

const askDelete = (row: AdminDocumentTemplate) => {
  // simple confirm via window.confirm to keep minimal
  if (!window.confirm(t('admin.documentTemplates.confirmDelete'))) return
  void doDelete(row)
}

const doDelete = async (row: AdminDocumentTemplate) => {
  try {
    await remove(row.id, row.revision)
    toast.add({ title: t('admin.documentTemplates.deleted'), color: 'success' })
    await load()
  } catch {
    toast.add({ title: t('admin.documentTemplates.deleteFailed'), color: 'error' })
  }
}

const restoreRow = async (row: AdminDocumentTemplate) => {
  // restore not exposed in composable remove; use update with isDeleted false? Backend has restore endpoint? No dedicated route. Skip.
}

onMounted(() => { if (canRead.value) void load() })
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-highlighted">{{ t('admin.documentTemplates.title') }}</h1>
        <p class="mt-1 text-sm text-muted">{{ t('admin.documentTemplates.description') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <label class="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" v-model="includeDeleted" />
          {{ t('admin.documentTemplates.includeDeleted') }}
        </label>
        <UButton v-if="canWrite" icon="i-lucide-plus" color="primary" variant="soft" size="sm" :label="t('admin.documentTemplates.create')" @click="openCreate" />
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" :label="t('common.refresh')" :disabled="!canRead || loading" @click="load()" />
      </div>
    </header>

    <p v-if="!canRead" class="rounded-md border border-default p-4 text-sm text-muted">{{ t('admin.documentTemplates.noAccess') }}</p>

    <template v-else>
      <p v-if="error" class="rounded-md border border-error/40 bg-error/10 p-3 text-sm text-error">{{ error }}</p>

      <div class="overflow-hidden rounded-md border border-default">
        <table class="w-full text-left text-sm">
          <thead class="bg-elevated/40 text-xs uppercase text-muted">
            <tr>
              <th class="px-3 py-2 font-medium">{{ t('admin.documentTemplates.name') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.documentTemplates.code') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.documentTemplates.type') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.documentTemplates.default') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.documentTemplates.color') }}</th>
              <th class="px-3 py-2" />
            </tr>
          </thead>
          <tbody class="divide-y divide-default/60">
            <tr v-for="row in rows" :key="row.id" class="hover:bg-elevated/20" :class="{ 'opacity-50': row.isDeleted }">
              <td class="px-3 py-2 font-medium text-highlighted">{{ row.name }}</td>
              <td class="px-3 py-2 font-mono text-xs text-muted">{{ row.code }}</td>
              <td class="px-3 py-2 text-muted">{{ row.type }}</td>
              <td class="px-3 py-2">
                <UBadge v-if="row.isDefault" color="success" variant="subtle" size="sm">{{ t('admin.documentTemplates.default') }}</UBadge>
              </td>
              <td class="px-3 py-2">
                <span class="inline-block h-4 w-8 rounded border border-default" :style="{ backgroundColor: row.primaryColor }" />
              </td>
              <td class="px-3 py-2 text-right">
                <div class="flex items-center justify-end gap-1">
                  <UButton v-if="canWrite && !row.isDeleted" icon="i-lucide-pencil" color="neutral" variant="ghost" size="xs" @click="openEdit(row)" />
                  <UButton v-if="canWrite && !row.isDeleted" icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" @click="askDelete(row)" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!rows.length && !loading" class="p-6 text-center text-sm text-muted">{{ t('admin.documentTemplates.empty') }}</p>
      </div>

      <div v-if="hasMore" class="flex justify-center">
        <UButton variant="ghost" :loading="loading" :label="t('common.loadMore')" @click="load(true)" />
      </div>
    </template>

    <UModal v-model:open="formOpen" :title="editing ? t('admin.documentTemplates.editTitle') : t('admin.documentTemplates.createTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-3xl' }">
      <template #body>
        <div class="flex flex-col gap-4">
          <div class="flex gap-2 border-b border-default pb-2">
            <UButton v-for="tab in TABS" :key="tab" size="xs" :variant="activeTab === tab ? 'soft' : 'ghost'" :color="activeTab === tab ? 'primary' : 'neutral'" :label="t(`admin.documentTemplates.tabs.${tab}`)" @click="activeTab = tab" />
          </div>

          <div v-show="activeTab === 'header'" class="space-y-3">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <UFormField :label="t('admin.documentTemplates.name')"><UInput v-model="form.name" class="w-full" /></UFormField>
              <UFormField :label="t('admin.documentTemplates.code')"><UInput v-model="form.code" class="w-full font-mono" /></UFormField>
            </div>
            <UFormField :label="t('admin.documentTemplates.titleField')"><UInput v-model="form.title" class="w-full" /></UFormField>
            <UFormField :label="t('admin.documentTemplates.subtitle')"><UInput v-model="form.subtitle" class="w-full" /></UFormField>
            <div class="flex items-center justify-between py-2 border-b border-default/60">
              <span class="text-xs text-muted">{{ t('admin.documentTemplates.showLogo') }}</span>
              <USwitch v-model="form.showLogo" size="sm" />
            </div>
            <div class="flex items-center justify-between py-2 border-b border-default/60">
              <span class="text-xs text-muted">{{ t('admin.documentTemplates.default') }}</span>
              <USwitch v-model="form.isDefault" size="sm" />
            </div>
            <div class="pt-2 space-y-3">
              <h4 class="text-xs font-bold uppercase text-highlighted">{{ t('admin.documentTemplates.companyInfo') }}</h4>
              <UFormField :label="t('admin.documentTemplates.companyName')"><UInput v-model="form.companyName" class="w-full" /></UFormField>
              <UFormField :label="t('admin.documentTemplates.companyAddress')"><UInput v-model="form.companyAddress" class="w-full" /></UFormField>
              <div class="grid grid-cols-2 gap-2">
                <UFormField :label="t('admin.documentTemplates.companyPhone')"><UInput v-model="form.companyPhone" class="w-full" /></UFormField>
                <UFormField :label="t('admin.documentTemplates.companyTaxCode')"><UInput v-model="form.companyTaxCode" class="w-full" /></UFormField>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <UFormField :label="t('admin.documentTemplates.companyEmail')"><UInput v-model="form.companyEmail" class="w-full" /></UFormField>
                <UFormField :label="t('admin.documentTemplates.companyWebsite')"><UInput v-model="form.companyWebsite" class="w-full" /></UFormField>
              </div>
            </div>
          </div>

          <div v-show="activeTab === 'table'" class="space-y-3">
            <div v-for="flag in (['showSku','showThumbnail','showUom','showUnitPrice','showDiscount'] as const)" :key="flag" class="flex items-center justify-between py-2 border-b border-default/60">
              <span class="text-xs text-muted">{{ t(`admin.documentTemplates.flags.${flag}`) }}</span>
              <USwitch v-model="form[flag]" size="sm" />
            </div>
          </div>

          <div v-show="activeTab === 'footer'" class="space-y-3">
            <div v-for="flag in (['showTotalInWords','showBankAccounts','showSignatures'] as const)" :key="flag" class="flex items-center justify-between py-2 border-b border-default/60">
              <span class="text-xs text-muted">{{ t(`admin.documentTemplates.flags.${flag}`) }}</span>
              <USwitch v-model="form[flag]" size="sm" />
            </div>
            <UFormField :label="t('admin.documentTemplates.terms')"><UTextarea v-model="form.terms" :rows="4" class="w-full text-xs" /></UFormField>
            <UFormField :label="t('admin.documentTemplates.notes')"><UTextarea v-model="form.notes" :rows="3" class="w-full text-xs" /></UFormField>
            <div v-if="form.showSignatures" class="space-y-2">
              <UFormField :label="t('admin.documentTemplates.senderTitle')"><UInput v-model="form.senderTitle" class="w-full" /></UFormField>
              <UFormField :label="t('admin.documentTemplates.receiverTitle')"><UInput v-model="form.receiverTitle" class="w-full" /></UFormField>
              <UFormField :label="t('admin.documentTemplates.accountantTitle')"><UInput v-model="form.accountantTitle" class="w-full" /></UFormField>
            </div>
          </div>

          <div v-show="activeTab === 'style'" class="space-y-3">
            <UFormField :label="t('admin.documentTemplates.primaryColor')">
              <div class="flex items-center gap-3">
                <input v-model="form.primaryColor" type="color" class="h-8 w-12 rounded border border-default cursor-pointer bg-transparent" />
                <UInput v-model="form.primaryColor" class="w-32" size="sm" />
              </div>
            </UFormField>
          </div>

          <p v-if="formError" class="rounded-md border border-error/40 bg-error/10 p-2 text-xs text-error">{{ formError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :label="t('common.cancel')" @click="formOpen = false" />
          <UButton color="primary" size="sm" :loading="saving" :label="t('common.save')" @click="submit" />
        </div>
      </template>
    </UModal>
  </div>
</template>