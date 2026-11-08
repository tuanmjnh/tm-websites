<script setup lang="ts">
import type { AdminMedia } from '@tm/flow-contracts/media-admin'
import { MEDIA_MAX_BYTES, MEDIA_MIME_TYPES } from '@tm/flow-contracts/media-admin'

const { t, locale } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const { list, upload, update, remove, errorCode } = useMediaAdmin()

const canRead = computed(() => hasCapability('media.read'))
const canUpload = computed(() => hasCapability('media.upload'))
const canDelete = computed(() => hasCapability('media.delete'))

const accept = MEDIA_MIME_TYPES.join(',')
const maxMegabytes = Math.round(MEDIA_MAX_BYTES / (1024 * 1024))

const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const items = ref<AdminMedia[]>([])
const counts = ref<Record<string, number>>({})
const folders = ref<string[]>([])
const nextCursor = ref<string | null>(null)
const hasMore = ref(false)

const filters = reactive({
  kind: 'all' as 'all' | 'image' | 'document',
  folder: 'all',
  q: '',
})

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadError = ref<string | null>(null)
const uploadProgress = ref('')

const editOpen = ref(false)
const editing = ref<AdminMedia | null>(null)
const saving = ref(false)
const editError = ref<string | null>(null)
const editForm = reactive({ title: '', alt: '', folder: '' })

const deleteOpen = ref(false)
const deleting = ref<AdminMedia | null>(null)
const deleteBusy = ref(false)
const deleteError = ref<string | null>(null)

const kindItems = computed(() => [
  { label: t('admin.media.allKinds'), value: 'all' },
  { label: t('admin.media.kinds.image'), value: 'image' },
  { label: t('admin.media.kinds.document'), value: 'document' },
])

const folderItems = computed(() => [
  { label: t('admin.media.allFolders'), value: 'all' },
  { label: t('admin.media.root'), value: 'root' },
  ...folders.value.map(folder => ({ label: folder, value: folder })),
])

const stats = computed(() => [
  { label: t('admin.media.stats.resources'), value: String(counts.value.all ?? 0), icon: 'i-lucide-files' },
  { label: t('admin.media.stats.images'), value: String(counts.value.image ?? 0), icon: 'i-lucide-image' },
  { label: t('admin.media.stats.documents'), value: String(counts.value.document ?? 0), icon: 'i-lucide-file-text' },
  { label: t('admin.media.stats.storage'), value: formatBytes(totalBytes.value), icon: 'i-lucide-hard-drive' },
])

const totalBytes = computed(() => items.value.reduce((sum, entry) => sum + entry.size, 0))

const errorMessages: Record<string, string> = {
  MEDIA_TYPE_NOT_ALLOWED: 'admin.media.errors.typeNotAllowed',
  MEDIA_SIZE_EXCEEDED: 'admin.media.errors.sizeExceeded',
  MEDIA_EMPTY: 'admin.media.errors.empty',
  MEDIA_IN_USE: 'admin.media.errors.inUse',
  MEDIA_REVISION_CONFLICT: 'admin.media.errors.revisionConflict',
  MEDIA_UPDATE_UNCHANGED: 'admin.media.errors.updateUnchanged',
  MEDIA_NOT_FOUND: 'admin.media.errors.notFound',
  MEDIA_FOLDER_INVALID: 'admin.media.errors.folderInvalid',
  MEDIA_TITLE_INVALID: 'admin.media.errors.titleInvalid',
  MEDIA_FILE_REQUIRED: 'admin.media.errors.fileRequired',
  MEDIA_QUERY_INVALID: 'admin.media.errors.queryInvalid',
}

const describeError = (cause: unknown) => {
  const code = errorCode(cause)
  if (code && errorMessages[code]) return t(errorMessages[code]!)
  const status = (cause as { statusCode?: number, status?: number })?.statusCode
    ?? (cause as { status?: number })?.status
  if (status === 401) return t('admin.errors.unauthorized')
  if (status === 403) return t('admin.errors.forbidden')
  if (status === 404) return t('admin.errors.notFound')
  if (!status) return t('admin.errors.network')
  return t('admin.errors.generic')
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

const displayName = (entry: AdminMedia) => entry.title || entry.originalName

const folderLabel = (entry: AdminMedia) => entry.folder || t('admin.media.root')

function query(reset: boolean) {
  return {
    kind: filters.kind === 'all' ? undefined : filters.kind,
    folder: filters.folder === 'all' ? undefined : filters.folder,
    q: filters.q.trim() || undefined,
    cursor: reset ? undefined : nextCursor.value ?? undefined,
    limit: 24,
  }
}

async function load(reset = true) {
  if (!canRead.value) return
  if (reset) loading.value = true
  else loadingMore.value = true
  error.value = null
  try {
    const payload = await list(query(reset))
    items.value = reset ? payload.data : [...items.value, ...payload.data]
    counts.value = payload.meta?.counts ?? {}
    folders.value = payload.meta?.folders ?? []
    nextCursor.value = payload.meta?.nextCursor ?? null
    hasMore.value = Boolean(payload.meta?.hasMore)
  } catch (cause) {
    error.value = describeError(cause)
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || !canUpload.value) return

  uploading.value = true
  uploadError.value = null
  try {
    for (const [index, file] of files.entries()) {
      uploadProgress.value = `${index + 1}/${files.length}`
      await upload({
        file,
        folder: filters.folder === 'all' || filters.folder === 'root' ? undefined : filters.folder,
      })
    }
    toast.add({ title: t('admin.media.uploaded'), color: 'success' })
    await load()
  } catch (cause) {
    // File-level failures are shown next to the control: the picker is closed by
    // then, so a toast alone would leave no trace of the rejected file.
    uploadError.value = describeError(cause)
  } finally {
    uploading.value = false
    uploadProgress.value = ''
  }
}

function openEdit(entry: AdminMedia) {
  editing.value = entry
  editError.value = null
  editForm.title = entry.title
  editForm.alt = entry.alt
  editForm.folder = entry.folder
  editOpen.value = true
}

async function submitEdit() {
  if (!editing.value || saving.value) return
  editError.value = null
  saving.value = true
  try {
    await update(editing.value.id, {
      title: editForm.title,
      alt: editForm.alt,
      folder: editForm.folder,
      revision: editing.value.revision,
    })
    toast.add({ title: t('admin.media.updated'), color: 'success' })
    editOpen.value = false
    await load()
  } catch (cause) {
    editError.value = describeError(cause)
    if (errorCode(cause) === 'MEDIA_REVISION_CONFLICT') await load()
  } finally {
    saving.value = false
  }
}

function askDelete(entry: AdminMedia) {
  deleting.value = entry
  deleteError.value = null
  deleteOpen.value = true
}

async function confirmDelete() {
  if (!deleting.value || deleteBusy.value) return
  deleteBusy.value = true
  deleteError.value = null
  try {
    await remove(deleting.value.id, deleting.value.revision)
    toast.add({ title: t('admin.media.deleted'), color: 'success' })
    deleteOpen.value = false
    await load()
  } catch (cause) {
    deleteError.value = describeError(cause)
  } finally {
    deleteBusy.value = false
  }
}

async function copyUrl(entry: AdminMedia) {
  try {
    await navigator.clipboard.writeText(entry.url)
    toast.add({ title: t('admin.media.urlCopied'), color: 'success' })
  } catch {
    toast.add({ title: entry.url, color: 'neutral' })
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(() => filters.q, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void load(), 300)
})
watch([() => filters.kind, () => filters.folder], () => void load())

if (canRead.value) await load()
</script>

<template>
  <div>
    <CmsBasePage
      :title="t('admin.media.title')"
      :description="t('admin.media.description')"
      :loading="loading"
      :error="error"
      :empty="canRead && !loading && !items.length"
      :empty-text="canRead ? t('admin.media.empty') : t('admin.media.permissionDenied')"
      empty-icon="i-lucide-images"
    >
      <template #right>
        <UButton
          v-if="canUpload"
          icon="i-lucide-upload"
          color="primary"
          variant="soft"
          size="sm"
          :loading="uploading"
          :label="uploading ? `${t('admin.media.uploading')} ${uploadProgress}` : t('admin.media.upload')"
          @click="fileInput?.click()"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          size="sm"
          :label="t('common.refresh')"
          :disabled="!canRead || loading"
          @click="load()"
        />
        <input
          ref="fileInput"
          type="file"
          :accept="accept"
          multiple
          class="hidden"
          @change="onFiles"
        >
      </template>

      <template #toolbar>
        <div class="mx-auto mt-2 flex w-full max-w-7xl flex-wrap items-center gap-2">
          <UInput
            v-model="filters.q"
            icon="i-lucide-search"
            size="sm"
            class="w-full sm:w-64"
            :placeholder="t('admin.media.search')"
          />
          <USelect v-model="filters.kind" :items="kindItems" value-key="value" size="sm" class="w-36" />
          <USelect v-model="filters.folder" :items="folderItems" value-key="value" size="sm" class="w-44" />
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <span
              v-for="stat in stats"
              :key="stat.label"
              class="flex items-center gap-1.5 rounded-sm border border-default/60 px-2 py-1 text-[11px] text-muted"
            >
              <UIcon :name="stat.icon" class="size-3.5" />
              {{ stat.label }}: <span class="font-medium text-highlighted">{{ stat.value }}</span>
            </span>
          </div>
        </div>
        <p v-if="uploadError" class="mx-auto mt-2 w-full max-w-7xl rounded-sm border border-error/40 bg-error/10 p-2 text-xs text-error">
          {{ uploadError }}
        </p>
        <p v-else-if="canUpload" class="mx-auto mt-1 w-full max-w-7xl text-[11px] text-muted">
          {{ t('admin.media.uploadHint', { size: maxMegabytes }) }}
        </p>
      </template>

      <template #emptyAction>
        <UButton
          v-if="canRead && canUpload"
          icon="i-lucide-upload"
          color="primary"
          variant="soft"
          size="sm"
          :label="t('admin.media.upload')"
          @click="fileInput?.click()"
        />
      </template>

      <div v-if="canRead && items.length" class="flex flex-col gap-4">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <div
            v-for="entry in items"
            :key="entry.id"
            class="flex flex-col overflow-hidden rounded-[4px] border border-default/60"
          >
            <div class="flex h-32 items-center justify-center bg-elevated/40">
              <img
                v-if="entry.kind === 'image'"
                :src="entry.url"
                :alt="entry.alt || displayName(entry)"
                class="h-full w-full object-cover"
                loading="lazy"
              >
              <UIcon v-else name="i-lucide-file-text" class="size-8 text-muted" />
            </div>

            <div class="flex min-w-0 flex-1 flex-col gap-1 p-3">
              <p class="truncate text-sm font-medium text-highlighted" :title="displayName(entry)">
                {{ displayName(entry) }}
              </p>
              <p class="truncate font-mono text-[11px] text-muted">{{ entry.originalName }}</p>
              <p class="text-[11px] text-muted">
                {{ formatBytes(entry.size) }} · {{ folderLabel(entry) }} · {{ t('admin.categories.revision') }} {{ entry.revision }}
              </p>
              <p class="text-[11px] text-muted">
                {{ entry.mimeType }} · {{ entry.createdAt ? new Date(entry.createdAt).toLocaleDateString(locale) : '—' }}
              </p>
            </div>

            <div class="flex items-center gap-1 border-t border-default/40 px-2 py-1.5">
              <UButton
                icon="i-lucide-link"
                color="neutral"
                variant="ghost"
                size="xs"
                :title="t('admin.media.copyUrl')"
                @click="copyUrl(entry)"
              />
              <UButton
                v-if="canUpload"
                icon="i-lucide-pencil"
                color="neutral"
                variant="ghost"
                size="xs"
                :title="t('common.edit')"
                @click="openEdit(entry)"
              />
              <UButton
                v-if="canDelete"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                :title="t('common.delete')"
                @click="askDelete(entry)"
              />
            </div>
          </div>
        </div>

        <div v-if="hasMore" class="flex justify-center">
          <UButton
            color="neutral"
            variant="soft"
            size="sm"
            :loading="loadingMore"
            :label="t('admin.media.loadMore')"
            @click="load(false)"
          />
        </div>
      </div>
    </CmsBasePage>

    <UModal v-model:open="editOpen" :title="t('admin.media.editTitle')">
      <template #body>
        <div class="flex flex-col gap-3">
          <UFormField :label="t('admin.media.fields.title')">
            <UInput v-model="editForm.title" class="w-full" :placeholder="editing?.originalName" />
          </UFormField>
          <UFormField :label="t('admin.media.fields.alt')">
            <UInput v-model="editForm.alt" class="w-full" />
          </UFormField>
          <UFormField :label="t('admin.media.fields.folder')">
            <UInput v-model="editForm.folder" class="w-full font-mono" placeholder="landing/hero" />
          </UFormField>
          <p v-if="editError" class="rounded-sm border border-error/40 bg-error/10 p-2 text-xs text-error">{{ editError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :label="t('common.cancel')" @click="editOpen = false" />
          <UButton color="primary" size="sm" :loading="saving" :label="t('common.save')" @click="submitEdit" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="deleteOpen" :title="t('admin.media.deleteTitle')">
      <template #body>
        <div class="flex flex-col gap-3 text-sm">
          <p class="text-muted">{{ t('admin.media.deleteDescription') }}</p>
          <p class="font-mono text-xs text-highlighted">{{ deleting?.originalName }}</p>
          <p v-if="deleteError" class="rounded-sm border border-error/40 bg-error/10 p-2 text-xs text-error">{{ deleteError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :label="t('common.cancel')" @click="deleteOpen = false" />
          <UButton color="error" size="sm" :loading="deleteBusy" :label="t('common.delete')" @click="confirmDelete" />
        </div>
      </template>
    </UModal>
  </div>
</template>
