<script setup lang="ts">
import type { AdminRedirect, AdminRedirectDraft } from '@tm/flow-contracts/redirect-admin'

const { t } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const { list, create, update, remove, errorCode } = useRedirects()

const canRead = computed(() => hasCapability('content.read'))
const canWrite = computed(() => hasCapability('content.write'))

const loading = ref(false)
const error = ref<string | null>(null)
const rows = ref<AdminRedirect[]>([])
const total = ref(0)
const query = ref('')
const busyId = ref<string | null>(null)
const auditReason = ref('')

const errorMessages: Record<string, string> = {
  REDIRECT_PATH_INVALID: 'admin.redirects.errors.pathInvalid',
  REDIRECT_PATH_REQUIRED: 'admin.redirects.errors.pathInvalid',
  REDIRECT_PATH_SAME: 'admin.redirects.errors.pathSame',
  REDIRECT_EXISTS: 'admin.redirects.errors.exists',
  REDIRECT_LOOP: 'admin.redirects.errors.loop',
  REDIRECT_NOT_FOUND: 'admin.redirects.errors.notFound',
  REDIRECT_REVISION_CONFLICT: 'admin.redirects.errors.revisionConflict',
  REDIRECT_PAYLOAD_INVALID: 'admin.redirects.errors.pathInvalid',
}

const describeError = (e: unknown) => {
  const code = errorCode(e)
  if (code && errorMessages[code]) return t(errorMessages[code]!)
  const status = (e as { statusCode?: number, status?: number })?.statusCode ?? (e as { status?: number })?.status
  if (status === 401) return t('admin.errors.unauthorized')
  if (status === 403) return t('admin.errors.forbidden')
  if (status === 404) return t('admin.errors.notFound')
  if (!status) return t('admin.errors.network')
  return t('admin.errors.generic')
}

async function load() {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const result = await list(query.value)
    rows.value = result.data
    total.value = result.total
  } catch (e) {
    error.value = describeError(e)
  } finally {
    loading.value = false
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined
watch(query, () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => void load(), 400)
})

const statusItems = computed(() => [
  { label: t('admin.redirects.status.permanent'), value: 301 },
  { label: t('admin.redirects.status.temporary'), value: 302 },
  // "410 Gone" reads the same in both CMS locales, so it stays a literal until
  // the locale files carry a key of its own.
  { label: '410 Gone', value: 410 },
])

const emptyForm = () => ({
  from: '',
  to: '',
  statusCode: 301 as 301 | 302 | 410,
  isActive: true,
  note: '',
})

const formOpen = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)
const editingId = ref<string | null>(null)
const editingRevision = ref(0)
const form = reactive(emptyForm())

function openCreate() {
  auditReason.value = ''
  Object.assign(form, emptyForm())
  editingId.value = null
  editingRevision.value = 0
  formError.value = null
  formOpen.value = true
}

function openEdit(row: AdminRedirect) {
  auditReason.value = ''
  Object.assign(form, {
    from: row.from,
    to: row.to,
    statusCode: row.statusCode,
    isActive: row.isActive,
    note: row.note,
  })
  editingId.value = row.id
  editingRevision.value = row.revision
  formError.value = null
  formOpen.value = true
}

async function submit() {
  if (saving.value) return
  saving.value = true
  formError.value = null
  try {
    const draft: AdminRedirectDraft = {
      from: form.from.trim(),
      to: form.statusCode === 410 ? '' : form.to.trim(),
      statusCode: form.statusCode,
      isActive: form.isActive,
      note: form.note.trim(),
    }
    if (editingId.value) {
      await update(editingId.value, { ...draft, revision: editingRevision.value }, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.redirects.saved'), color: 'success' })
    } else {
      await create(draft, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.redirects.created'), color: 'success' })
    }
    auditReason.value = ''
    formOpen.value = false
    await load()
  } catch (e) {
    formError.value = describeError(e)
  } finally {
    saving.value = false
  }
}

async function toggleActive(row: AdminRedirect) {
  if (busyId.value) return
  busyId.value = row.id
  try {
    await update(row.id, {
      from: row.from,
      to: row.to,
      statusCode: row.statusCode,
      isActive: !row.isActive,
      note: row.note,
      revision: row.revision,
    })
    toast.add({ title: row.isActive ? t('admin.redirects.disabled') : t('admin.redirects.enabled'), color: 'success' })
    await load()
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
    if (errorCode(e) === 'REDIRECT_REVISION_CONFLICT') await load()
  } finally {
    busyId.value = null
  }
}

const deleteOpen = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)
const deleteTarget = ref<AdminRedirect | null>(null)

function askDelete(row: AdminRedirect) {
  deleteTarget.value = row
  deleteError.value = null
  auditReason.value = ''
  deleteOpen.value = true
}

async function confirmDelete() {
  if (!deleteTarget.value || deleting.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await remove(deleteTarget.value.id, deleteTarget.value.revision, auditReason.value.trim() || undefined)
    auditReason.value = ''
    deleteOpen.value = false
    toast.add({ title: t('admin.redirects.deleted'), color: 'success' })
    await load()
  } catch (e) {
    deleteError.value = describeError(e)
  } finally {
    deleting.value = false
  }
}

if (canRead.value) await load()
</script>

<template>
  <div>
    <CmsBasePage
      :title="t('admin.redirects.title')"
      :description="t('admin.redirects.description')"
      :loading="loading"
      :error="error"
      :empty="canRead && !loading && !rows.length"
      :empty-text="canRead
        ? (query ? t('admin.redirects.noMatch') : t('admin.redirects.empty'))
        : t('admin.redirects.permissionDenied')"
      empty-icon="i-lucide-corner-down-right"
    >
      <template #right>
        <div class="flex items-center gap-2">
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            size="sm"
            :label="t('common.refresh')"
            :disabled="!canRead || loading"
            @click="load()"
          />
          <UButton
            v-if="canWrite"
            icon="i-lucide-plus"
            size="sm"
            :label="t('admin.redirects.add')"
            @click="openCreate"
          />
        </div>
      </template>

      <div v-if="canRead && (rows.length || query)" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-3">
          <UInput
            v-model="query"
            icon="i-lucide-search"
            size="sm"
            class="w-full sm:w-64"
            :placeholder="t('admin.redirects.searchPlaceholder')"
            :maxlength="80"
          />
          <p class="text-xs text-muted">{{ t('admin.redirects.summary', { count: total }) }}</p>
        </div>

        <div class="overflow-hidden rounded-[4px] border border-default/60">
          <div
            v-for="row in rows"
            :key="row.id"
            class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0"
          >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2 font-mono text-xs">
                <span class="truncate text-highlighted">{{ row.from }}</span>
                <UIcon name="i-lucide-arrow-right" class="size-3.5 text-muted" />
                <span class="truncate text-default">{{ row.to || '—' }}</span>
              </div>
              <div class="mt-1 flex flex-wrap items-center gap-2">
                <UBadge color="neutral" variant="subtle" size="sm">{{ row.statusCode }}</UBadge>
                <UBadge :color="row.isActive ? 'success' : 'neutral'" variant="subtle" size="sm">
                  {{ row.isActive ? t('admin.redirects.active') : t('admin.redirects.inactive') }}
                </UBadge>
                <span v-if="row.note" class="truncate text-[11px] text-muted">{{ row.note }}</span>
              </div>
            </div>

            <div v-if="canWrite" class="flex items-center gap-1">
              <UButton
                :icon="row.isActive ? 'i-lucide-toggle-right' : 'i-lucide-toggle-left'"
                color="neutral"
                variant="ghost"
                size="xs"
                :loading="busyId === row.id"
                :title="row.isActive ? t('admin.redirects.disable') : t('admin.redirects.enable')"
                @click="toggleActive(row)"
              />
              <UButton
                icon="i-lucide-pencil"
                color="neutral"
                variant="ghost"
                size="xs"
                :title="t('admin.redirects.edit')"
                @click="openEdit(row)"
              />
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                :title="t('admin.redirects.delete')"
                @click="askDelete(row)"
              />
            </div>
          </div>
        </div>
      </div>
    </CmsBasePage>

    <UModal
      v-model:open="formOpen"
      :title="editingId ? t('admin.redirects.editTitle') : t('admin.redirects.createTitle')"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-lg' }"
    >
      <template #body>
        <div class="flex flex-col gap-3">
          <p class="text-xs text-muted">{{ t('admin.redirects.formHint') }}</p>
          <UFormField :label="t('admin.redirects.fields.from')" name="redirect-from">
            <UInput v-model="form.from" class="w-full font-mono" placeholder="/bai-viet/cu" autofocus />
          </UFormField>
          <UFormField v-if="form.statusCode !== 410" :label="t('admin.redirects.fields.to')" name="redirect-to">
            <UInput v-model="form.to" class="w-full font-mono" placeholder="/bai-viet/moi" />
          </UFormField>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.redirects.fields.statusCode')" name="redirect-status">
              <USelect v-model="form.statusCode" :items="statusItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.redirects.fields.active')" name="redirect-active">
              <div class="flex h-8 items-center gap-2">
                <USwitch v-model="form.isActive" />
                <span class="text-xs text-muted">{{ form.isActive ? t('admin.redirects.active') : t('admin.redirects.inactive') }}</span>
              </div>
            </UFormField>
          </div>
          <UFormField :label="t('admin.redirects.fields.note')" name="redirect-note">
            <UInput v-model="form.note" class="w-full" :maxlength="200" :placeholder="t('admin.redirects.fields.noteHint')" />
          </UFormField>
          <UInput
            v-model="auditReason"
            class="w-full"
            :placeholder="t('common.auditReasonPlaceholder')"
            :aria-label="t('common.auditReason')"
          />
          <p v-if="formError" class="rounded-sm border border-error/40 bg-error/10 p-2 text-xs text-error">{{ formError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :label="t('common.cancel')" @click="formOpen = false" />
          <UButton color="primary" size="sm" :loading="saving" :label="t('common.save')" @click="submit" />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="deleteOpen"
      :title="t('admin.redirects.deleteTitle')"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }"
    >
      <template #body>
        <p class="text-sm text-default">
          {{ t('admin.redirects.deleteHint', { from: deleteTarget?.from ?? '' }) }}
        </p>
        <UInput
          v-model="auditReason"
          class="mt-3 w-full"
          :placeholder="t('common.auditReasonPlaceholder')"
          :aria-label="t('common.auditReason')"
        />
        <p v-if="deleteError" class="mt-3 rounded-sm border border-error/40 bg-error/10 p-2 text-xs text-error">
          {{ deleteError }}
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :label="t('common.cancel')" @click="deleteOpen = false" />
          <UButton color="error" size="sm" :loading="deleting" :label="t('admin.redirects.delete')" @click="confirmDelete" />
        </div>
      </template>
    </UModal>
  </div>
</template>
