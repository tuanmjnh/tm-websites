<script setup lang="ts">
import type { AdminTag } from '@tm/flow-contracts/tag-admin'
import { ADMIN_TAG_MAX_LENGTH } from '@tm/flow-contracts/tag-admin'

const { t } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const { list, rename, errorCode } = useTagAdmin()

const canRead = computed(() => hasCapability('content.read'))
const canWrite = computed(() => hasCapability('content.write'))

const loading = ref(false)
const error = ref<string | null>(null)
const tags = ref<AdminTag[]>([])
const query = ref('')

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return tags.value
  return tags.value.filter(tag => tag.name.toLowerCase().includes(needle))
})

const totalRecords = computed(() => tags.value.reduce((sum, tag) => sum + tag.count, 0))

const formOpen = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)
const source = ref<AdminTag | null>(null)
const target = ref('')
const auditReason = ref('')

const detachOpen = ref(false)
const detaching = ref(false)
const detachError = ref<string | null>(null)
const detachTarget = ref<AdminTag | null>(null)

/** The tag typed in the dialog, when it already exists: the command merges. */
const mergeTarget = computed(() => {
  const name = target.value.trim()
  if (!name) return null
  return tags.value.find(tag => tag.name === name && tag.name !== source.value?.name) ?? null
})

const errorMessages: Record<string, string> = {
  TAG_REQUIRED: 'admin.tags.errors.required',
  TAG_TOO_LONG: 'admin.tags.errors.tooLong',
  TAG_RENAME_SAME: 'admin.tags.errors.sameName',
  TAG_NOT_FOUND: 'admin.tags.errors.notFound',
  TAG_INVALID: 'admin.tags.errors.invalid',
  TAG_PAYLOAD_INVALID: 'admin.tags.errors.invalid',
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
    tags.value = await list()
  } catch (e) {
    error.value = describeError(e)
  } finally {
    loading.value = false
  }
}

function openRename(tag: AdminTag) {
  source.value = tag
  target.value = tag.name
  auditReason.value = ''
  formError.value = null
  formOpen.value = true
}

async function submitRename() {
  if (!source.value || saving.value) return
  const name = target.value.trim()
  if (!name) {
    formError.value = t('admin.tags.errors.required')
    return
  }

  saving.value = true
  formError.value = null
  try {
    const result = await rename({ from: source.value.name, to: name }, auditReason.value.trim() || undefined)
    auditReason.value = ''
    formOpen.value = false
    toast.add({
      title: mergeTarget.value === null && result.updated > 1
        ? t('admin.tags.renamedMany', { count: result.updated })
        : t('admin.tags.renamed'),
      color: 'success',
    })
    // A concurrent editor save is reported instead of hidden: the command can be
    // run again and will only touch the records that were left behind.
    if (result.skipped > 0) {
      toast.add({ title: t('admin.tags.skipped', { count: result.skipped }), color: 'warning' })
    }
    await load()
  } catch (e) {
    formError.value = describeError(e)
    if (errorCode(e) === 'TAG_NOT_FOUND') await load()
  } finally {
    saving.value = false
  }
}

function askDetach(tag: AdminTag) {
  detachTarget.value = tag
  auditReason.value = ''
  detachError.value = null
  detachOpen.value = true
}

async function confirmDetach() {
  if (!detachTarget.value || detaching.value) return
  detaching.value = true
  detachError.value = null
  try {
    const result = await rename({ from: detachTarget.value.name, to: null }, auditReason.value.trim() || undefined)
    auditReason.value = ''
    detachOpen.value = false
    toast.add({ title: t('admin.tags.detached', { count: result.updated }), color: 'success' })
    if (result.skipped > 0) {
      toast.add({ title: t('admin.tags.skipped', { count: result.skipped }), color: 'warning' })
    }
    await load()
  } catch (e) {
    detachError.value = describeError(e)
    toast.add({ title: detachError.value, color: 'error' })
  } finally {
    detaching.value = false
  }
}

if (canRead.value) await load()
</script>

<template>
  <div>
    <CmsBasePage
      :title="t('admin.tags.title')"
      :description="t('admin.tags.description')"
      :loading="loading"
      :error="error"
      :empty="canRead && !loading && !filtered.length"
      :empty-text="canRead
        ? (query ? t('admin.tags.noMatch') : t('admin.tags.empty'))
        : t('admin.tags.permissionDenied')"
      empty-icon="i-lucide-tags"
    >
      <template #right>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          size="sm"
          :label="t('common.refresh')"
          :disabled="!canRead || loading"
          @click="load()"
        />
      </template>

      <div v-if="canRead && tags.length" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-3">
          <UInput
            v-model="query"
            icon="i-lucide-search"
            size="sm"
            class="w-full sm:w-64"
            :placeholder="t('admin.tags.searchPlaceholder')"
          />
          <p class="text-xs text-muted">
            {{ t('admin.tags.summary', { tags: tags.length, records: totalRecords }) }}
          </p>
        </div>

        <div class="overflow-hidden rounded-[4px] border border-default/60">
          <div
            v-for="tag in filtered"
            :key="tag.name"
            class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0"
          >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <UBadge color="neutral" variant="subtle" size="sm">{{ tag.name }}</UBadge>
                <span class="text-[11px] text-muted">{{ t('admin.tags.records', { count: tag.count }) }}</span>
              </div>
            </div>

            <div v-if="canWrite" class="flex items-center gap-1">
              <UButton
                icon="i-lucide-pencil"
                color="neutral"
                variant="ghost"
                size="xs"
                :title="t('admin.tags.rename')"
                @click="openRename(tag)"
              />
              <UButton
                icon="i-lucide-tag-off"
                color="error"
                variant="ghost"
                size="xs"
                :title="t('admin.tags.detach')"
                @click="askDetach(tag)"
              />
            </div>
          </div>
        </div>
      </div>
    </CmsBasePage>

    <UModal
      v-model:open="formOpen"
      :title="t('admin.tags.renameTitle')"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }"
    >
      <template #body>
        <div class="flex flex-col gap-3">
          <p class="text-xs text-muted">{{ t('admin.tags.renameHint', { name: source?.name ?? '' }) }}</p>
          <UFormField :label="t('admin.tags.fields.name')" name="tag-name">
            <UInput v-model="target" class="w-full" :maxlength="ADMIN_TAG_MAX_LENGTH" autofocus @keyup.enter="submitRename" />
          </UFormField>
          <UInput
            v-model="auditReason"
            class="w-full"
            :placeholder="t('common.auditReasonPlaceholder')"
            :aria-label="t('common.auditReason')"
          />
          <p v-if="mergeTarget" class="rounded-sm border border-warning/40 bg-warning/10 p-2 text-xs text-default">
            {{ t('admin.tags.mergeHint', { name: mergeTarget.name, count: mergeTarget.count }) }}
          </p>
          <p v-if="formError" class="rounded-sm border border-error/40 bg-error/10 p-2 text-xs text-error">{{ formError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :label="t('common.cancel')" @click="formOpen = false" />
          <UButton color="primary" size="sm" :loading="saving" :label="t('common.save')" @click="submitRename" />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="detachOpen"
      :title="t('admin.tags.detachTitle')"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }"
    >
      <template #body>
        <p class="text-sm text-default">
          {{ t('admin.tags.detachHint', { name: detachTarget?.name ?? '', count: detachTarget?.count ?? 0 }) }}
        </p>
        <p class="mt-2 text-xs text-muted">{{ t('admin.tags.detachGuard') }}</p>
        <UInput
          v-model="auditReason"
          class="mt-3 w-full"
          :placeholder="t('common.auditReasonPlaceholder')"
          :aria-label="t('common.auditReason')"
        />
        <p v-if="detachError" class="mt-3 rounded-sm border border-error/40 bg-error/10 p-2 text-xs text-error">
          {{ detachError }}
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :label="t('common.cancel')" @click="detachOpen = false" />
          <UButton color="error" size="sm" :loading="detaching" :label="t('admin.tags.detach')" @click="confirmDetach" />
        </div>
      </template>
    </UModal>
  </div>
</template>
