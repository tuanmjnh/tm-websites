<script setup lang="ts">
import type { HubContentDraft, HubContentEntry, HubContentFieldError, HubContentType } from '@tm/flow-contracts'
import { HUB_CONTENT_TYPES, buildHubContentPayload } from '@tm/flow-contracts'

const { t, locale } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const {
  fetchContent,
  saveContent,
  publishContent,
  unpublishContent,
  restoreContent,
  deleteContent: removeContent,
  describeError,
} = useHubAdmin()

const canRead = computed(() => hasCapability('content.read'))
const canWrite = computed(() => hasCapability('content.write'))

const loading = ref(false)
const saving = ref(false)
const busyId = ref<string | null>(null)
const error = ref<string | null>(null)
const entries = ref<HubContentEntry[]>([])
const search = ref('')
const status = ref<'all' | 'published' | 'hidden' | 'deleted'>('all')
const selected = ref<HubContentEntry | null>(null)
const detailOpen = ref(false)

const formOpen = ref(false)
const editingId = ref<string | null>(null)
const formError = ref<HubContentFieldError | null>(null)
const form = reactive<HubContentDraft>({
  key: '',
  title: '',
  description: '',
  category: '',
  contentType: 'json',
  data: '',
  isPublished: false,
})

const deleteOpen = ref(false)

const statusItems = computed(() => [
  { label: t('admin.content.status.all'), value: 'all' },
  { label: t('admin.content.status.published'), value: 'published' },
  { label: t('admin.content.status.hidden'), value: 'hidden' },
  { label: t('admin.content.status.deleted'), value: 'deleted' },
])

const contentTypeItems = computed(() =>
  HUB_CONTENT_TYPES.map(value => ({ label: t(`admin.content.contentTypes.${value}`), value })),
)

const stats = computed(() => [
  { title: t('admin.content.stats.total'), value: String(entries.value.length), icon: 'i-lucide-files' },
  { title: t('admin.content.stats.published'), value: String(entries.value.filter(e => e.isPublished).length), icon: 'i-lucide-eye' },
  { title: t('admin.content.stats.hidden'), value: String(entries.value.filter(e => !e.isPublished).length), icon: 'i-lucide-eye-off' },
  { title: t('admin.content.stats.deleted'), value: String(entries.value.filter(e => e.isDeleted).length), icon: 'i-lucide-trash-2' },
])

const pageEmpty = computed(() => !canRead.value || (!loading.value && !error.value && !entries.value.length))
const emptyText = computed(() => (canRead.value ? t('admin.content.noEntries') : t('admin.content.permissionDenied')))
const emptyIcon = computed(() => (canRead.value ? 'i-lucide-file-plus-2' : 'i-lucide-shield-off'))

const formErrorText = computed(() => {
  switch (formError.value) {
    case 'key': return t('admin.content.validation.key')
    case 'title': return t('admin.content.validation.title')
    case 'description': return t('admin.content.validation.description')
    case 'category': return t('admin.content.validation.category')
    case 'data': return t('admin.content.validation.data')
    default: return null
  }
})

const formDataLabel = computed(() => (
  form.contentType === 'json'
    ? t('admin.content.fields.dataJson')
    : t('admin.content.fields.dataText')
))

const formatTime = (value: string | null | undefined) => (value ? new Date(value).toLocaleString(locale.value) : '—')

const formatData = (value: unknown) => {
  if (value === null || value === undefined) return '—'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const openDetail = (entry: HubContentEntry) => {
  selected.value = entry
  detailOpen.value = true
}

const resetForm = () => {
  editingId.value = null
  formError.value = null
  form.key = ''
  form.title = ''
  form.description = ''
  form.category = ''
  form.contentType = 'json'
  form.data = ''
  form.isPublished = false
}

const openCreate = () => {
  resetForm()
  formOpen.value = true
}

const openEdit = (entry: HubContentEntry) => {
  resetForm()
  editingId.value = entry._id
  form.key = entry.key
  form.title = entry.title
  form.description = entry.description ?? ''
  form.category = entry.category ?? ''
  form.contentType = (HUB_CONTENT_TYPES.includes(entry.contentType as HubContentType)
    ? entry.contentType
    : 'json') as HubContentType
  form.data = entry.contentType === 'json'
    ? formatData(entry.data)
    : String(entry.data ?? '')
  form.isPublished = entry.isPublished
  formOpen.value = true
}

async function load() {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const payload = await fetchContent({
      status: status.value,
      search: search.value.trim() || undefined,
      includeUnpublished: true,
    })
    entries.value = payload.data
  } catch (e) {
    error.value = describeError(e)
  } finally {
    loading.value = false
  }
}

async function submitForm() {
  if (!canWrite.value) return
  formError.value = null

  const built = buildHubContentPayload(form)
  if (!built.ok) {
    formError.value = built.field
    return
  }

  saving.value = true
  const isEdit = Boolean(editingId.value)
  try {
    await saveContent(built.payload)
    toast.add({ title: t(isEdit ? 'admin.content.updated' : 'admin.content.created'), color: 'success' })
    formOpen.value = false
    detailOpen.value = false
    await load()
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function togglePublish(entry: HubContentEntry) {
  if (!canWrite.value || entry.isDeleted) return
  busyId.value = entry._id
  try {
    if (entry.isPublished) await unpublishContent(entry._id)
    else await publishContent(entry._id)
    toast.add({
      title: t(entry.isPublished ? 'admin.content.unpublished' : 'admin.content.published'),
      color: 'success',
    })
    detailOpen.value = false
    await load()
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
  } finally {
    busyId.value = null
  }
}

function askDelete(entry: HubContentEntry) {
  selected.value = entry
  deleteOpen.value = true
}

async function confirmDelete() {
  if (!canWrite.value || !selected.value) return
  busyId.value = selected.value._id
  try {
    await removeContent(selected.value._id)
    toast.add({ title: t('admin.content.deleted'), color: 'success' })
    deleteOpen.value = false
    detailOpen.value = false
    await load()
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
  } finally {
    busyId.value = null
  }
}

async function restoreEntry(entry: HubContentEntry) {
  if (!canWrite.value) return
  busyId.value = entry._id
  try {
    await restoreContent(entry._id)
    toast.add({ title: t('admin.content.restored'), color: 'success' })
    detailOpen.value = false
    await load()
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
  } finally {
    busyId.value = null
  }
}

const copyData = async () => {
  if (!selected.value) return
  try {
    await navigator.clipboard.writeText(formatData(selected.value.data))
    toast.add({ title: t('admin.content.copied'), color: 'success' })
  } catch {
    toast.add({ title: t('common.error'), color: 'error' })
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => load(), 400)
})
watch(status, () => load())

onMounted(load)
</script>

<template>
  <CmsBasePage
    :title="t('admin.content.title')"
    :description="t('admin.content.description')"
    :loading="loading"
    :error="error"
    :empty="pageEmpty"
    :empty-text="emptyText"
    :empty-icon="emptyIcon"
  >
    <template #right>
      <UButton
        v-if="canWrite"
        icon="i-lucide-plus"
        color="primary"
        variant="soft"
        size="sm"
        :label="t('admin.content.create')"
        @click="openCreate"
      />
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="sm"
        :label="t('common.refresh')"
        :disabled="!canRead || loading"
        @click="load"
      />
    </template>

    <template #emptyAction>
      <UButton
        v-if="canRead && canWrite"
        icon="i-lucide-plus"
        color="primary"
        variant="soft"
        size="sm"
        :label="t('admin.content.create')"
        @click="openCreate"
      />
    </template>

    <template #toolbar>
      <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          :placeholder="t('admin.content.search')"
          class="w-full sm:max-w-xs"
        />
        <USelect
          v-model="status"
          :items="statusItems"
          value-key="value"
          class="w-full sm:w-44"
        />
      </div>
    </template>

    <template #error-retry>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="soft"
        size="sm"
        :label="t('common.refresh')"
        class="mt-4"
        @click="load"
      />
    </template>

    <div class="bento-grid">
      <BentoCard v-for="stat in stats" :key="stat.title" :title="stat.title" :icon="stat.icon">
        <p class="mt-2 text-2xl font-bold tracking-tight text-highlighted">
          {{ stat.value }}
        </p>
      </BentoCard>

      <BentoCard
        :title="t('admin.content.listTitle')"
        :description="t('admin.content.listDescription')"
        icon="i-lucide-file-pen"
        :col-span="4"
      >
        <p v-if="!entries.length" class="py-8 text-center text-sm text-muted">
          {{ t('admin.content.noEntries') }}
        </p>
        <div v-else class="mt-3 divide-y divide-default/40">
          <div
            v-for="entry in entries"
            :key="entry._id"
            class="flex items-start gap-2 transition-colors hover:bg-elevated/40"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3 rounded-sm px-2 py-3 text-left first:pt-2 last:pb-1"
              @click="openDetail(entry)"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-sm font-semibold text-highlighted">{{ entry.title }}</p>
                  <UBadge
                    :color="entry.isDeleted ? 'error' : entry.isPublished ? 'success' : 'warning'"
                    variant="subtle"
                    size="sm"
                  >
                    {{ entry.isDeleted
                      ? t('admin.content.status.deleted')
                      : entry.isPublished
                        ? t('admin.content.status.published')
                        : t('admin.content.status.hidden') }}
                  </UBadge>
                  <UBadge v-if="entry.category" color="neutral" variant="subtle" size="sm">
                    {{ entry.category }}
                  </UBadge>
                  <UBadge color="neutral" variant="subtle" size="sm">
                    {{ entry.contentType }}
                  </UBadge>
                </div>
                <p class="mt-1 truncate font-mono text-xs text-muted">{{ entry.key }}</p>
                <p v-if="entry.description" class="mt-1 text-xs text-muted">{{ entry.description }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-2 text-xs text-muted">
                <span>{{ formatTime(entry.updatedAt) }}</span>
                <UIcon name="i-lucide-arrow-right" class="size-3.5" />
              </div>
            </button>
            <div v-if="canWrite" class="flex shrink-0 items-center gap-1 py-3 pr-2">
              <UButton
                v-if="entry.isDeleted"
                icon="i-lucide-rotate-ccw"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="t('admin.content.restore')"
                :loading="busyId === entry._id"
                @click="restoreEntry(entry)"
              />
              <UButton
                v-else
                :icon="entry.isPublished ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="entry.isPublished ? t('admin.content.unpublish') : t('admin.content.publish')"
                :loading="busyId === entry._id"
                @click="togglePublish(entry)"
              />
            </div>
          </div>
        </div>
      </BentoCard>
    </div>

    <UModal
      v-model:open="detailOpen"
      :title="selected?.title"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-2xl' }"
    >
      <template #body>
        <div v-if="selected" class="flex flex-col gap-4">
          <div class="flex flex-wrap gap-2">
            <UBadge
              :color="selected.isDeleted ? 'error' : selected.isPublished ? 'success' : 'warning'"
              variant="subtle"
              size="sm"
            >
              {{ selected.isDeleted
                ? t('admin.content.status.deleted')
                : selected.isPublished
                  ? t('admin.content.status.published')
                  : t('admin.content.status.hidden') }}
            </UBadge>
            <UBadge v-if="selected.category" color="neutral" variant="subtle" size="sm">
              {{ selected.category }}
            </UBadge>
            <UBadge color="neutral" variant="subtle" size="sm">{{ selected.contentType }}</UBadge>
            <UBadge color="neutral" variant="subtle" size="sm">{{ selected.appId }}</UBadge>
          </div>

          <div class="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div class="rounded-sm border border-default/60 bg-elevated/30 p-2.5">
              <p class="text-muted">{{ t('admin.content.detailKey') }}</p>
              <p class="mt-1 break-all font-mono font-medium text-highlighted">{{ selected.key }}</p>
            </div>
            <div class="rounded-sm border border-default/60 bg-elevated/30 p-2.5">
              <p class="text-muted">{{ t('admin.content.detailUpdated') }}</p>
              <p class="mt-1 font-medium text-highlighted">{{ formatTime(selected.updatedAt) }}</p>
            </div>
          </div>

          <div>
            <div class="mb-1.5 flex items-center justify-between">
              <p class="text-xs font-medium text-muted">{{ t('admin.content.detailData') }}</p>
              <UButton
                icon="i-lucide-files"
                color="neutral"
                variant="ghost"
                size="xs"
                :label="t('admin.content.copy')"
                @click="copyData"
              />
            </div>
            <pre class="scroll-thin max-h-80 overflow-auto rounded-sm border border-default bg-elevated/40 p-3 text-[11px] leading-relaxed text-default">{{ formatData(selected.data) }}</pre>
          </div>

          <div v-if="selected.metadata">
            <p class="mb-1.5 text-xs font-medium text-muted">{{ t('admin.content.detailMetadata') }}</p>
            <pre class="scroll-thin max-h-40 overflow-auto rounded-sm border border-default bg-elevated/40 p-3 text-[11px] leading-relaxed text-default">{{ formatData(selected.metadata) }}</pre>
          </div>

          <p v-if="selected.isDeleted" class="text-xs text-muted">
            {{ t('admin.content.softDeleteNote') }}
          </p>
        </div>
      </template>

      <template #footer="{ close }">
        <div class="flex w-full flex-wrap items-center justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            :label="t('admin.content.close')"
            @click="close()"
          />
          <UButton
            v-if="canWrite && selected?.isDeleted"
            icon="i-lucide-rotate-ccw"
            color="primary"
            variant="soft"
            size="sm"
            :label="t('admin.content.restore')"
            :loading="busyId === selected?._id"
            @click="selected && restoreEntry(selected)"
          />
          <template v-if="canWrite && selected && !selected.isDeleted">
            <UButton
              icon="i-lucide-pencil"
              color="neutral"
              variant="soft"
              size="sm"
              :label="t('admin.content.editAction')"
              @click="openEdit(selected)"
            />
            <UButton
              :icon="selected.isPublished ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              color="neutral"
              variant="soft"
              size="sm"
              :label="selected.isPublished ? t('admin.content.unpublish') : t('admin.content.publish')"
              :loading="busyId === selected._id"
              @click="togglePublish(selected)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="soft"
              size="sm"
              :label="t('common.delete')"
              @click="askDelete(selected)"
            />
          </template>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="formOpen"
      :title="editingId ? t('admin.content.formEditTitle') : t('admin.content.formCreateTitle')"
      :description="t('admin.content.formDescription')"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-3xl' }"
    >
      <template #body>
        <div class="flex flex-col gap-4">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField :label="t('admin.content.fields.key')" name="key">
              <UInput
                v-model="form.key"
                :placeholder="t('admin.content.fields.keyPlaceholder')"
                :disabled="Boolean(editingId)"
                class="w-full font-mono"
              />
              <p v-if="editingId" class="mt-1 text-xs text-muted">
                {{ t('admin.content.keyImmutable') }}
              </p>
            </UFormField>
            <UFormField :label="t('admin.content.fields.category')" name="category">
              <UInput
                v-model="form.category"
                :placeholder="t('admin.content.fields.categoryPlaceholder')"
                class="w-full"
              />
            </UFormField>
          </div>

          <UFormField :label="t('admin.content.fields.title')" name="title">
            <UInput
              v-model="form.title"
              :placeholder="t('admin.content.fields.titlePlaceholder')"
              class="w-full"
            />
          </UFormField>

          <UFormField :label="t('admin.content.fields.description')" name="description">
            <UTextarea
              v-model="form.description"
              :rows="2"
              :placeholder="t('admin.content.fields.descriptionPlaceholder')"
              class="w-full"
            />
          </UFormField>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField :label="t('admin.content.fields.contentType')" name="contentType">
              <USelect
                v-model="form.contentType"
                :items="contentTypeItems"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="t('admin.content.fields.isPublished')" name="isPublished">
              <div class="flex h-8 items-center gap-2">
                <USwitch v-model="form.isPublished" />
                <span class="text-xs text-muted">{{ t('admin.content.fields.isPublishedHint') }}</span>
              </div>
            </UFormField>
          </div>

          <UFormField :label="formDataLabel" name="data">
            <UTextarea
              v-model="form.data"
              :rows="12"
              :placeholder="form.contentType === 'json'
                ? t('admin.content.fields.dataJsonPlaceholder')
                : t('admin.content.fields.dataTextPlaceholder')"
              class="w-full font-mono"
            />
          </UFormField>

          <p v-if="formErrorText" class="text-sm text-error">{{ formErrorText }}</p>
        </div>
      </template>

      <template #footer="{ close }">
        <div class="flex w-full items-center justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            :label="t('common.cancel')"
            @click="close()"
          />
          <UButton
            color="primary"
            variant="soft"
            size="sm"
            :label="t('common.save')"
            :loading="saving"
            :disabled="!canWrite || saving"
            @click="submitForm"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="deleteOpen"
      :title="t('admin.content.deleteConfirmTitle')"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }"
    >
      <template #body>
        <p class="text-sm text-muted">
          {{ t('admin.content.deleteConfirmText', { title: selected?.title ?? '' }) }}
        </p>
        <p class="mt-2 text-xs text-muted">{{ t('admin.content.softDeleteNote') }}</p>
      </template>
      <template #footer="{ close }">
        <div class="flex w-full items-center justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            :label="t('common.cancel')"
            @click="close()"
          />
          <UButton
            color="error"
            variant="soft"
            size="sm"
            :label="t('common.delete')"
            :loading="busyId === selected?._id"
            @click="confirmDelete"
          />
        </div>
      </template>
    </UModal>
  </CmsBasePage>
</template>
