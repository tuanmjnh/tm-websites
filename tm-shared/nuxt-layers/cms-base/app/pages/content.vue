<script setup lang="ts">
import type {
  AdminContent,
  AdminContentAudit,
  AdminContentBodyFormat,
  AdminContentBulkAction,
  AdminContentBulkResult,
  AdminContentBulkRow,
  AdminContentEvent,
  AdminContentLocale,
  AdminContentRevision,
  AdminContentRevisionDetail,
  AdminContentStatus,
  AdminContentStatusFilter,
  AdminContentType,
} from '@tm/flow-contracts/content-admin'
import {
  ADMIN_CONTENT_BODY_FORMATS,
  ADMIN_CONTENT_STATUSES,
  ADMIN_CONTENT_TYPES,
} from '@tm/flow-contracts/content-admin'

const { t, locale } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const {
  list,
  create,
  update,
  runEvent,
  bulk: runBulk,
  history,
  revisions: fetchRevisions,
  revision: fetchRevision,
  restoreRevision: restoreRevisionApi,
  errorCode,
  errorStatus,
} = useContentAdmin()
const { list: listCategories } = useCategoryAdmin()
const { list: listMedia } = useMediaAdmin()

const canRead = computed(() => hasCapability('content.read'))
const canWrite = computed(() => hasCapability('content.write'))

const loading = ref(false)
const loadingMore = ref(false)
const saving = ref(false)
const busyId = ref<string | null>(null)
const error = ref<string | null>(null)
const entries = ref<AdminContent[]>([])
const counts = ref<Record<string, number>>({})
const nextCursor = ref<string | null>(null)
const search = ref('')
const status = ref<AdminContentStatusFilter>('all')
const typeFilter = ref<'all' | AdminContentType>('all')

const detailOpen = ref(false)
const selected = ref<AdminContent | null>(null)
const historyEntries = ref<AdminContentAudit[]>([])
const historyLoading = ref(false)

const revisionEntries = ref<AdminContentRevision[]>([])
const revisionsLoading = ref(false)
const revisionOpen = ref(false)
const revisionDetail = ref<AdminContentRevisionDetail | null>(null)
const revisionDetailLoading = ref(false)
const restoringRevision = ref<number | null>(null)

const formOpen = ref(false)
const editingId = ref<string | null>(null)
const editingRevision = ref(0)
const formError = ref<string | null>(null)
const activeLocale = ref<'vi' | 'en'>('vi')

const deleteOpen = ref(false)
const scheduleOpen = ref(false)
const scheduleAt = ref('')
const scheduleBusy = ref(false)

// Bulk selection lives in the page (not the row) so one confirm dialog can cover
// every checked record and one request can report per-row outcomes.
const selection = ref<string[]>([])
const bulkOpen = ref(false)
const bulkAction = ref<AdminContentBulkAction>('publish')
const bulkBusy = ref(false)
const bulkResult = ref<AdminContentBulkResult | null>(null)

interface LocaleForm {
  slug: string
  title: string
  excerpt: string
  body: string
  format: AdminContentBodyFormat
  seoTitle: string
  seoDescription: string
}

const emptyLocale = (): LocaleForm => ({
  slug: '',
  title: '',
  excerpt: '',
  body: '',
  format: 'markdown',
  seoTitle: '',
  seoDescription: '',
})

const form = reactive({
  type: 'page' as AdminContentType,
  key: '',
  categories: [] as string[],
  media: [] as string[],
  tags: '',
  publishAt: '',
  unpublishAt: '',
  locales: { vi: emptyLocale(), en: emptyLocale() } as Record<'vi' | 'en', LocaleForm>,
})

const statusItems = computed(() => [
  { label: t('admin.content.status.all'), value: 'all' },
  ...ADMIN_CONTENT_STATUSES.map(value => ({ label: t(`admin.content.status.${value}`), value })),
])

const typeItems = computed(() => [
  { label: t('admin.content.type.all'), value: 'all' },
  ...ADMIN_CONTENT_TYPES.map(value => ({ label: t(`admin.content.type.${value}`), value })),
])

const editorTypeItems = computed(() => ADMIN_CONTENT_TYPES.map(value => ({ label: t(`admin.content.type.${value}`), value })))

const bodyFormatItems = computed(() =>
  ADMIN_CONTENT_BODY_FORMATS.map(value => ({ label: t(`admin.content.format.${value}`), value })),
)

const stats = computed(() => [
  { title: t('admin.content.stats.total'), value: counts.value.all ?? 0, icon: 'i-lucide-files' },
  { title: t('admin.content.stats.published'), value: counts.value.published ?? 0, icon: 'i-lucide-eye' },
  { title: t('admin.content.stats.scheduled'), value: counts.value.scheduled ?? 0, icon: 'i-lucide-calendar-clock' },
  { title: t('admin.content.stats.draft'), value: counts.value.draft ?? 0, icon: 'i-lucide-pencil' },
  { title: t('admin.content.stats.archived'), value: counts.value.archived ?? 0, icon: 'i-lucide-archive' },
  { title: t('admin.content.stats.deleted'), value: counts.value.deleted ?? 0, icon: 'i-lucide-trash-2' },
])

const pageEmpty = computed(() => !canRead.value || (!loading.value && !error.value && !entries.value.length))
const emptyText = computed(() => (canRead.value ? t('admin.content.noEntries') : t('admin.content.permissionDenied')))
const emptyIcon = computed(() => (canRead.value ? 'i-lucide-file-plus-2' : 'i-lucide-shield-off'))

const localeTabs = computed(() => [
  { value: 'vi' as const, label: t('admin.content.locales.vi') },
  { value: 'en' as const, label: t('admin.content.locales.en') },
])

const activeForm = computed(() => form.locales[activeLocale.value])

const statusColor = (value: AdminContentStatus) => {
  switch (value) {
    case 'published': return 'success'
    case 'scheduled': return 'info'
    case 'draft': return 'warning'
    case 'deleted': return 'error'
    default: return 'neutral'
  }
}

const formatTime = (value: string | null | undefined) => (value ? new Date(value).toLocaleString(locale.value) : '—')

const toLocalInput = (value: string | null | undefined) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('sv-SE').replace(' ', 'T').slice(0, 16)
}

const toIso = (value: string) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const describeError = (e: unknown) => {
  const code = errorCode(e)
  if (code === 'CONTENT_IN_MENU') {
    // The server names the menus that point at this page; the editor needs them
    // to know what to change before the delete can go through.
    const body = (e as { data?: { data?: { error?: { details?: unknown } } } })?.data
    const details = body?.data?.error?.details as { menus?: Array<{ name?: string, key?: string }> } | undefined
    const names = (details?.menus ?? []).map(menu => menu.name || menu.key || '').filter(Boolean).join(', ')
    return t('admin.content.errors.inMenu', { menus: names })
  }

  const known: Record<string, string> = {
    CONTENT_KEY_EXISTS: 'admin.content.errors.keyExists',
    CONTENT_SLUG_EXISTS: 'admin.content.errors.slugExists',
    CONTENT_REVISION_CONFLICT: 'admin.content.errors.revisionConflict',
    CONTENT_PAYLOAD_INVALID: 'admin.content.errors.payloadInvalid',
    CONTENT_PUBLISH_AT_PAST: 'admin.content.errors.publishAtPast',
    CONTENT_PUBLISH_AT_FUTURE: 'admin.content.errors.publishAtFuture',
    CONTENT_PUBLISH_AT_REQUIRED: 'admin.content.errors.publishAtRequired',
    CONTENT_TRANSITION_INVALID: 'admin.content.errors.transitionInvalid',
    CONTENT_KEY_IMMUTABLE: 'admin.content.errors.payloadInvalid',
    CONTENT_NOT_FOUND: 'admin.content.errors.notFound',
    CONTENT_REVISION_NOT_FOUND: 'admin.content.errors.revisionNotFound',
    CONTENT_REVISION_CURRENT: 'admin.content.errors.revisionCurrent',
    CONTENT_REVISION_UNCHANGED: 'admin.content.errors.revisionUnchanged',
  }
  if (code && known[code]) return t(known[code]!)

  const httpStatus = errorStatus(e)
  if (httpStatus === 401) return t('admin.errors.unauthorized')
  if (httpStatus === 403) return t('admin.errors.forbidden')
  if (httpStatus === 404) return t('admin.errors.notFound')
  if (!httpStatus) return t('admin.errors.network')
  return t('admin.errors.generic')
}

async function load(reset = true) {
  if (!canRead.value) return
  if (reset) {
    loading.value = true
    error.value = null
  } else {
    loadingMore.value = true
  }

  try {
    const payload = await list({
      status: status.value,
      type: typeFilter.value === 'all' ? undefined : typeFilter.value,
      q: search.value.trim() || undefined,
      cursor: reset ? undefined : nextCursor.value ?? undefined,
      limit: 20,
    })

    entries.value = reset ? payload.data : [...entries.value, ...payload.data.filter(item => !entries.value.some(existing => existing.id === item.id))]
    counts.value = payload.meta?.counts ?? {}
    nextCursor.value = payload.meta?.nextCursor ?? null
    // A reload can drop rows (filter change, delete); never keep a hidden id selected.
    if (selection.value.length) {
      selection.value = selection.value.filter(id => entries.value.some(entry => entry.id === id))
    }
  } catch (e) {
    if (reset) error.value = describeError(e)
    else toast.add({ title: describeError(e), color: 'error' })
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function loadHistory(id: string) {
  historyLoading.value = true
  try {
    historyEntries.value = await history(id)
  } catch (e) {
    historyEntries.value = []
    toast.add({ title: describeError(e), color: 'error' })
  } finally {
    historyLoading.value = false
  }
}

async function loadRevisions(id: string) {
  revisionsLoading.value = true
  try {
    revisionEntries.value = await fetchRevisions(id)
  } catch (e) {
    revisionEntries.value = []
    toast.add({ title: describeError(e), color: 'error' })
  } finally {
    revisionsLoading.value = false
  }
}

async function openRevision(revisionNumber: number) {
  if (!selected.value) return
  revisionDetail.value = null
  revisionOpen.value = true
  revisionDetailLoading.value = true
  try {
    revisionDetail.value = await fetchRevision(selected.value.id, revisionNumber)
  } catch (e) {
    revisionOpen.value = false
    toast.add({ title: describeError(e), color: 'error' })
  } finally {
    revisionDetailLoading.value = false
  }
}

async function restoreVersion(revisionNumber: number) {
  if (!canWrite.value || !selected.value || restoringRevision.value !== null) return
  restoringRevision.value = revisionNumber
  try {
    const updated = await restoreRevisionApi(selected.value.id, revisionNumber, selected.value.revision)
    selected.value = updated
    entries.value = entries.value.map(item => (item.id === updated.id ? updated : item))
    revisionOpen.value = false
    toast.add({ title: t('admin.content.versions.restored'), color: 'success' })
    await Promise.all([load(), loadHistory(updated.id), loadRevisions(updated.id)])
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
  } finally {
    restoringRevision.value = null
  }
}

interface CategoryOption {
  label: string
  value: string
}

const categoryOptions = ref<CategoryOption[]>([])

async function loadCategoryOptions() {
  if (!canRead.value) return
  try {
    const payload = await listCategories()
    const byKey = new Map(payload.data.map(entry => [entry.key, entry]))
    const depthOf = (key: string): number => {
      let depth = 0
      let current = byKey.get(key)?.parent ?? null
      const seen = new Set<string>([key])
      while (current && !seen.has(current)) {
        seen.add(current)
        depth += 1
        current = byKey.get(current)?.parent ?? null
      }
      return depth
    }

    const options: CategoryOption[] = payload.data.map((entry) => {
      const name = entry.locales.find(item => item.locale === locale.value)?.name
        || entry.locales[0]?.name
        || entry.key
      return { label: `${'— '.repeat(depthOf(entry.key))}${name}`, value: entry.key }
    })

    for (const key of form.categories) {
      if (!options.some(option => option.value === key)) options.push({ label: key, value: key })
    }
    categoryOptions.value = options
  } catch {
    categoryOptions.value = form.categories.map(key => ({ label: key, value: key }))
  }
}

interface MediaOption {
  label: string
  value: string
}

const mediaOptions = ref<MediaOption[]>([])

/**
 * Attachments come from the same library the media page manages. The list is
 * capped (newest 100) because the editor only needs a picker, not pagination.
 */
async function loadMediaOptions() {
  if (!canRead.value) return
  try {
    const payload = await listMedia({ limit: 100 })
    const options: MediaOption[] = payload.data.map(entry => ({
      label: entry.title || entry.originalName,
      value: entry.id,
    }))
    for (const id of form.media) {
      if (!options.some(option => option.value === id)) options.push({ label: id, value: id })
    }
    mediaOptions.value = options
  } catch {
    mediaOptions.value = form.media.map(id => ({ label: id, value: id }))
  }
}

const mediaLabel = (id: string) => mediaOptions.value.find(option => option.value === id)?.label || id

const categoryLabel = (key: string) => {
  const label = categoryOptions.value.find(option => option.value === key)?.label
  return label ? label.replace(/^(?:—\s*)+/, '') : key
}

function openDetail(entry: AdminContent) {
  selected.value = entry
  historyEntries.value = []
  revisionEntries.value = []
  detailOpen.value = true
  if (!categoryOptions.value.length) void loadCategoryOptions()
  if (!mediaOptions.value.length) void loadMediaOptions()
  void loadHistory(entry.id)
  void loadRevisions(entry.id)
}

function resetForm() {
  editingId.value = null
  editingRevision.value = 0
  formError.value = null
  activeLocale.value = 'vi'
  form.type = 'page'
  form.key = ''
  form.categories = []
  form.media = []
  form.tags = ''
  form.publishAt = ''
  form.unpublishAt = ''
  form.locales = { vi: emptyLocale(), en: emptyLocale() }
}

function openCreate() {
  resetForm()
  void loadCategoryOptions()
  void loadMediaOptions()
  formOpen.value = true
}

function openEdit(entry: AdminContent) {
  resetForm()
  editingId.value = entry.id
  editingRevision.value = entry.revision
  form.type = entry.type
  form.key = entry.key
  form.categories = [...entry.categories]
  // Load after the current values are in place so their keys stay visible even
  // when they are not part of the category tree yet.
  void loadCategoryOptions()
  void loadMediaOptions()
  form.media = [...entry.media]
  form.tags = entry.tags.join(', ')
  form.publishAt = toLocalInput(entry.publishAt)
  form.unpublishAt = toLocalInput(entry.unpublishAt)

  for (const entryLocale of entry.locales) {
    if (entryLocale.locale !== 'vi' && entryLocale.locale !== 'en') continue
    form.locales[entryLocale.locale] = {
      slug: entryLocale.slug,
      title: entryLocale.title,
      excerpt: entryLocale.excerpt,
      body: entryLocale.body,
      format: entryLocale.format,
      seoTitle: entryLocale.seo.title,
      seoDescription: entryLocale.seo.description,
    }
    activeLocale.value = entryLocale.locale
  }

  detailOpen.value = false
  formOpen.value = true
}

const splitList = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean)

function buildLocales(): AdminContentLocale[] {
  return (['vi', 'en'] as const)
    .map((code) => {
      const entry = form.locales[code]
      return {
        locale: code,
        slug: entry.slug.trim(),
        title: entry.title.trim(),
        excerpt: entry.excerpt.trim(),
        body: entry.body,
        format: entry.format,
        seo: { title: entry.seoTitle.trim(), description: entry.seoDescription.trim(), image: '' },
      }
    })
    .filter(entry => entry.title || entry.slug)
}

async function submitForm() {
  if (!canWrite.value || saving.value) return
  formError.value = null

  const locales = buildLocales()
  if (!locales.length) {
    formError.value = t('admin.content.errors.localeRequired')
    return
  }

  const draft = {
    type: form.type,
    key: form.key.trim(),
    locales,
    categories: form.categories,
    media: form.media,
    tags: splitList(form.tags),
    attributes: {},
    publishAt: toIso(form.publishAt),
    unpublishAt: toIso(form.unpublishAt),
  }

  saving.value = true
  try {
    if (editingId.value) {
      await update(editingId.value, { ...draft, revision: editingRevision.value })
      toast.add({ title: t('admin.content.updated'), color: 'success' })
    } else {
      await create(draft)
      toast.add({ title: t('admin.content.created'), color: 'success' })
    }
    formOpen.value = false
    await load()
  } catch (e) {
    formError.value = describeError(e)
    if (errorCode(e) === 'CONTENT_REVISION_CONFLICT') await load()
  } finally {
    saving.value = false
  }
}

async function act(entry: AdminContent, event: AdminContentEvent, publishAt?: string | null) {
  if (!canWrite.value) return
  busyId.value = entry.id
  try {
    const updated = await runEvent(entry.id, event, entry.revision, publishAt)
    const messages: Record<AdminContentEvent, string> = {
      publish: 'admin.content.published',
      schedule: 'admin.content.scheduled',
      unpublish: 'admin.content.unpublished',
      archive: 'admin.content.archived',
      restore: 'admin.content.restored',
      delete: 'admin.content.deleted',
    }
    toast.add({ title: t(messages[event]), color: 'success' })
    detailOpen.value = false
    scheduleOpen.value = false
    deleteOpen.value = false
    entries.value = entries.value.map(item => (item.id === updated.id ? updated : item))
    await load()
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
  } finally {
    busyId.value = null
  }
}

function askDelete(entry: AdminContent) {
  selected.value = entry
  deleteOpen.value = true
}

function askSchedule(entry: AdminContent) {
  selected.value = entry
  const inAnHour = new Date(Date.now() + 60 * 60 * 1000)
  scheduleAt.value = toLocalInput(inAnHour.toISOString())
  scheduleOpen.value = true
}

async function confirmSchedule() {
  if (!selected.value) return
  const iso = toIso(scheduleAt.value)
  if (!iso) {
    toast.add({ title: t('admin.content.errors.publishAtRequired'), color: 'error' })
    return
  }
  scheduleBusy.value = true
  try {
    await act(selected.value, 'schedule', iso)
  } finally {
    scheduleBusy.value = false
  }
}

const allSelected = computed(() => entries.value.length > 0 && entries.value.every(entry => selection.value.includes(entry.id)))

function toggleAll() {
  selection.value = allSelected.value ? [] : entries.value.map(entry => entry.id)
}

function toggleOne(id: string) {
  selection.value = selection.value.includes(id)
    ? selection.value.filter(current => current !== id)
    : [...selection.value, id]
}

function askBulk(action: AdminContentBulkAction) {
  if (!canWrite.value || !selection.value.length) return
  bulkAction.value = action
  bulkResult.value = null
  bulkOpen.value = true
}

/**
 * One request for the whole selection. The API answers every row, so a stale
 * revision or an invalid transition on one record never hides the rest.
 */
async function confirmBulk() {
  if (!canWrite.value || bulkBusy.value) return
  const items = entries.value
    .filter(entry => selection.value.includes(entry.id))
    .map(entry => ({ id: entry.id, revision: entry.revision }))
  if (!items.length) {
    bulkOpen.value = false
    return
  }

  bulkBusy.value = true
  try {
    bulkResult.value = await runBulk(bulkAction.value, items)
    const result = bulkResult.value
    toast.add({
      title: t('admin.content.bulk.done', { ok: result.succeeded, total: result.results.length }),
      color: result.failed ? 'warning' : 'success',
    })
    selection.value = []
    await load()
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
  } finally {
    bulkBusy.value = false
  }
}

/** After a run the selection is cleared, so the dialog counts its own result. */
const bulkCount = computed(() => bulkResult.value?.results.length ?? selection.value.length)

const bulkLabel = (row: AdminContentBulkRow) => {
  const entry = entries.value.find(item => item.id === row.id)
  return entry?.locales[0]?.title || entry?.key || row.id
}

const bulkRowError = (row: AdminContentBulkRow) => {
  const known: Record<string, string> = {
    CONTENT_REVISION_CONFLICT: 'admin.content.errors.revisionConflict',
    CONTENT_TRANSITION_INVALID: 'admin.content.errors.transitionInvalid',
    CONTENT_NOT_FOUND: 'admin.content.errors.notFound',
    CONTENT_IN_MENU: 'admin.content.errors.inMenuShort',
    CONTENT_BULK_DUPLICATE: 'admin.content.bulk.duplicate',
  }
  const key = row.error?.code ? known[row.error.code] : undefined
  return key ? t(key) : (row.error?.message || t('admin.errors.generic'))
}

const rowActions = (entry: AdminContent) => {
  const actions: { label: string, icon: string, onSelect: () => void }[] = [
    { label: t('admin.content.actions.view'), icon: 'i-lucide-eye', onSelect: () => openDetail(entry) },
  ]

  if (!canWrite.value) return actions

  if (entry.status === 'deleted' || entry.status === 'archived') {
    actions.push({ label: t('admin.content.actions.restore'), icon: 'i-lucide-rotate-ccw', onSelect: () => act(entry, 'restore') })
  } else {
    actions.push({ label: t('admin.content.actions.edit'), icon: 'i-lucide-pencil', onSelect: () => openEdit(entry) })
    if (entry.status === 'published') {
      actions.push({ label: t('admin.content.actions.unpublish'), icon: 'i-lucide-eye-off', onSelect: () => act(entry, 'unpublish') })
    } else {
      actions.push({ label: t('admin.content.actions.publish'), icon: 'i-lucide-send', onSelect: () => act(entry, 'publish') })
      actions.push({ label: t('admin.content.actions.schedule'), icon: 'i-lucide-calendar-clock', onSelect: () => askSchedule(entry) })
    }
    actions.push({ label: t('admin.content.actions.archive'), icon: 'i-lucide-archive', onSelect: () => act(entry, 'archive') })
  }

  actions.push({ label: t('admin.content.actions.delete'), icon: 'i-lucide-trash-2', onSelect: () => askDelete(entry) })
  return actions
}

let debounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => load(), 400)
})
watch([status, typeFilter], () => load())

onMounted(() => load())
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
        @click="load()"
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
      <div class="mt-2 flex w-full flex-col gap-2 sm:flex-row sm:items-center">
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
        <USelect
          v-model="typeFilter"
          :items="typeItems"
          value-key="value"
          class="w-full sm:w-40"
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
        @click="load()"
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
        <div
          v-if="canWrite && entries.length"
          class="mt-3 flex flex-wrap items-center gap-2 rounded-sm border border-default/60 bg-elevated/20 px-2 py-1.5 text-xs"
        >
          <UCheckbox
            :model-value="allSelected"
            :aria-label="t('admin.content.bulk.selectAll')"
            @update:model-value="toggleAll"
          />
          <span class="text-muted">{{ t('admin.content.bulk.selected', { count: selection.length }) }}</span>
          <div class="ml-auto flex flex-wrap items-center gap-1">
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              icon="i-lucide-send"
              :label="t('admin.content.bulk.publish')"
              :disabled="!selection.length"
              @click="askBulk('publish')"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              icon="i-lucide-archive"
              :label="t('admin.content.bulk.archive')"
              :disabled="!selection.length"
              @click="askBulk('archive')"
            />
            <UButton
              size="xs"
              color="error"
              variant="soft"
              icon="i-lucide-trash-2"
              :label="t('admin.content.bulk.delete')"
              :disabled="!selection.length"
              @click="askBulk('delete')"
            />
          </div>
        </div>
        <div v-if="entries.length" class="mt-3 divide-y divide-default/40">
          <div
            v-for="entry in entries"
            :key="entry.id"
            class="flex items-start gap-2 transition-colors hover:bg-elevated/40"
          >
            <div v-if="canWrite" class="flex items-center py-3 pl-2">
              <UCheckbox
                :model-value="selection.includes(entry.id)"
                :aria-label="t(`admin.content.status.${entry.status}`)"
                @update:model-value="toggleOne(entry.id)"
              />
            </div>
            <button
              type="button"
              class="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3 rounded-sm px-2 py-3 text-left first:pt-2 last:pb-1"
              @click="openDetail(entry)"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-sm font-semibold text-highlighted">
                    {{ entry.locales[0]?.title || entry.key }}
                  </p>
                  <UBadge :color="statusColor(entry.status)" variant="subtle" size="sm">
                    {{ t(`admin.content.status.${entry.status}`) }}
                  </UBadge>
                  <UBadge color="neutral" variant="subtle" size="sm">
                    {{ t(`admin.content.type.${entry.type}`) }}
                  </UBadge>
                  <UBadge
                    v-for="entryLocale in entry.locales"
                    :key="entryLocale.locale"
                    color="primary"
                    variant="subtle"
                    size="sm"
                  >
                    {{ entryLocale.locale }}
                  </UBadge>
                </div>
                <p class="mt-1 truncate font-mono text-xs text-muted">{{ entry.key }}</p>
                <p class="mt-1 text-xs text-muted">
                  <span v-if="entry.status === 'scheduled'">{{ t('admin.content.detail.window') }}: {{ formatTime(entry.publishAt) }}</span>
                  <span v-else-if="entry.publishedAt">{{ t('admin.content.detail.publishedAt') }}: {{ formatTime(entry.publishedAt) }}</span>
                  <span v-else>{{ t('admin.content.detail.revision') }} {{ entry.revision }}</span>
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-2 text-xs text-muted">
                <span>{{ formatTime(entry.updatedAt) }}</span>
              </div>
            </button>
            <div class="flex shrink-0 items-center gap-1 py-3 pr-2">
              <UButton
                icon="i-lucide-eye"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="t('admin.content.actions.view')"
                @click="openDetail(entry)"
              />
              <UDropdownMenu :items="rowActions(entry)" :content="{ align: 'end' }">
                <UButton
                  icon="i-lucide-ellipsis-vertical"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :loading="busyId === entry.id"
                  :aria-label="t('common.actions')"
                />
              </UDropdownMenu>
            </div>
          </div>
        </div>

        <div v-if="nextCursor" class="mt-4 flex justify-center">
          <UButton
            color="neutral"
            variant="soft"
            size="sm"
            :label="t('admin.content.loadMore')"
            :loading="loadingMore"
            @click="load(false)"
          />
        </div>
      </BentoCard>
    </div>

    <UModal v-model:open="detailOpen" :title="selected?.locales[0]?.title || selected?.key" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-2xl' }">
      <template #body>
        <div v-if="selected" class="flex flex-col gap-4">
          <div class="flex flex-wrap gap-2">
            <UBadge :color="statusColor(selected.status)" variant="subtle" size="sm">
              {{ t(`admin.content.status.${selected.status}`) }}
            </UBadge>
            <UBadge color="neutral" variant="subtle" size="sm">{{ t(`admin.content.type.${selected.type}`) }}</UBadge>
            <UBadge color="neutral" variant="subtle" size="sm">{{ t('admin.content.detail.revision') }} {{ selected.revision }}</UBadge>
          </div>

          <div class="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div class="rounded-sm border border-default/60 bg-elevated/30 p-2.5">
              <p class="text-muted">{{ t('admin.content.fields.key') }}</p>
              <p class="mt-1 break-all font-mono font-medium text-highlighted">{{ selected.key }}</p>
            </div>
            <div class="rounded-sm border border-default/60 bg-elevated/30 p-2.5">
              <p class="text-muted">{{ t('admin.content.detail.updated') }}</p>
              <p class="mt-1 font-medium text-highlighted">{{ formatTime(selected.updatedAt) }}</p>
            </div>
            <div class="rounded-sm border border-default/60 bg-elevated/30 p-2.5">
              <p class="text-muted">{{ t('admin.content.detail.publishedAt') }}</p>
              <p class="mt-1 font-medium text-highlighted">{{ formatTime(selected.publishedAt) }}</p>
            </div>
            <div class="rounded-sm border border-default/60 bg-elevated/30 p-2.5">
              <p class="text-muted">{{ t('admin.content.detail.window') }}</p>
              <p class="mt-1 font-medium text-highlighted">
                {{ formatTime(selected.publishAt) }} → {{ formatTime(selected.unpublishAt) }}
              </p>
            </div>
          </div>

          <div v-for="entryLocale in selected.locales" :key="entryLocale.locale" class="rounded-sm border border-default/60 p-3">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge color="primary" variant="subtle" size="sm">{{ entryLocale.locale }}</UBadge>
              <p class="text-sm font-semibold text-highlighted">{{ entryLocale.title }}</p>
              <span class="font-mono text-xs text-muted">/{{ entryLocale.slug }}</span>
            </div>
            <p v-if="entryLocale.excerpt" class="mt-1 text-xs text-muted">{{ entryLocale.excerpt }}</p>
            <p v-if="entryLocale.seo.title || entryLocale.seo.description" class="mt-2 text-xs text-muted">
              <span class="font-medium">SEO:</span>
              {{ entryLocale.seo.title }}<span v-if="entryLocale.seo.description"> — {{ entryLocale.seo.description }}</span>
            </p>
            <pre class="scroll-thin mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-sm bg-elevated/40 p-2 text-[11px] leading-relaxed text-default">{{ entryLocale.body || '—' }}</pre>
          </div>

          <div v-if="selected.media.length" class="flex flex-wrap gap-1.5">
            <UBadge v-for="id in selected.media" :key="`media-${id}`" color="neutral" variant="subtle" size="sm">
              <UIcon name="i-lucide-paperclip" class="mr-1 size-3" />{{ mediaLabel(id) }}
            </UBadge>
          </div>

          <div v-if="selected.tags.length || selected.categories.length" class="flex flex-wrap gap-1.5">
            <UBadge v-for="tag in selected.tags" :key="`tag-${tag}`" color="neutral" variant="subtle" size="sm">
              #{{ tag }}
            </UBadge>
            <UBadge v-for="category in selected.categories" :key="`cat-${category}`" color="secondary" variant="subtle" size="sm">
              {{ categoryLabel(category) }}
            </UBadge>
          </div>

          <div class="rounded-sm border border-default/60 p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-xs font-semibold text-highlighted">{{ t('admin.content.detail.history') }}</p>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-refresh-cw"
                :loading="historyLoading"
                :label="t('admin.content.detail.historyReload')"
                @click="loadHistory(selected.id)"
              />
            </div>
            <p v-if="!historyEntries.length && !historyLoading" class="mt-2 text-xs text-muted">
              {{ t('admin.content.detail.historyEmpty') }}
            </p>
            <ul v-else class="mt-2 flex flex-col gap-2">
              <li
                v-for="auditEntry in historyEntries"
                :key="auditEntry.id"
                class="flex flex-wrap items-baseline gap-2 text-xs"
              >
                <UBadge color="neutral" variant="subtle" size="sm">
                  {{ t(`admin.content.audit.${auditEntry.action}`) }}
                </UBadge>
                <span class="text-muted">{{ t('admin.content.detail.revision') }} {{ auditEntry.revision }}</span>
                <span class="text-default">{{ auditEntry.actor.name || auditEntry.actor.email || auditEntry.actor.id }}</span>
                <span v-if="auditEntry.changedFields.length" class="font-mono text-[11px] text-muted">
                  {{ auditEntry.changedFields.join(', ') }}
                </span>
                <span class="ml-auto text-muted">{{ formatTime(auditEntry.createdAt) }}</span>
              </li>
            </ul>
          </div>

          <div class="rounded-sm border border-default/60 p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-xs font-semibold text-highlighted">{{ t('admin.content.versions.title') }}</p>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-refresh-cw"
                :loading="revisionsLoading"
                :label="t('admin.content.versions.reload')"
                @click="loadRevisions(selected.id)"
              />
            </div>
            <p v-if="!revisionEntries.length && !revisionsLoading" class="mt-2 text-xs text-muted">
              {{ t('admin.content.versions.empty') }}
            </p>
            <ul v-else class="mt-2 flex flex-col gap-1.5">
              <li
                v-for="version in revisionEntries"
                :key="version.id"
                class="flex flex-wrap items-center gap-2 text-xs"
              >
                <UBadge color="neutral" variant="subtle" size="sm">v{{ version.revision }}</UBadge>
                <span class="text-muted">{{ t(`admin.content.audit.${version.action}`) }}</span>
                <span class="text-default">{{ version.actor.name || version.actor.email || version.actor.id }}</span>
                <span class="text-muted">{{ formatTime(version.createdAt) }}</span>
                <div class="ml-auto flex items-center gap-1">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-eye"
                    :label="t('admin.content.versions.preview')"
                    @click="openRevision(version.revision)"
                  />
                  <UButton
                    v-if="canWrite && version.revision !== selected.revision"
                    size="xs"
                    color="primary"
                    variant="ghost"
                    icon="i-lucide-rotate-ccw"
                    :label="t('admin.content.versions.restore')"
                    :loading="restoringRevision === version.revision"
                    @click="restoreVersion(version.revision)"
                  />
                </div>
              </li>
            </ul>
          </div>
        </div>
      </template>

      <template #footer="{ close }">
        <div class="flex w-full flex-wrap items-center justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :label="t('admin.content.close')" @click="close()" />
          <template v-if="canWrite && selected">
            <UButton
              v-if="selected.status === 'deleted' || selected.status === 'archived'"
              icon="i-lucide-rotate-ccw"
              color="primary"
              variant="soft"
              size="sm"
              :label="t('admin.content.actions.restore')"
              :loading="busyId === selected.id"
              @click="act(selected, 'restore')"
            />
            <template v-else>
              <UButton
                icon="i-lucide-pencil"
                color="neutral"
                variant="soft"
                size="sm"
                :label="t('admin.content.actions.edit')"
                @click="openEdit(selected)"
              />
              <UButton
                v-if="selected.status === 'published'"
                icon="i-lucide-eye-off"
                color="neutral"
                variant="soft"
                size="sm"
                :label="t('admin.content.actions.unpublish')"
                :loading="busyId === selected.id"
                @click="act(selected, 'unpublish')"
              />
              <UButton
                v-else
                icon="i-lucide-send"
                color="primary"
                variant="soft"
                size="sm"
                :label="t('admin.content.actions.publish')"
                :loading="busyId === selected.id"
                @click="act(selected, 'publish')"
              />
              <UButton
                v-if="selected.status !== 'published'"
                icon="i-lucide-calendar-clock"
                color="neutral"
                variant="soft"
                size="sm"
                :label="t('admin.content.actions.schedule')"
                @click="askSchedule(selected)"
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
          </template>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="revisionOpen"
      :title="t('admin.content.versions.previewTitle', { revision: revisionDetail?.revision ?? '' })"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-2xl' }"
    >
      <template #body>
        <div v-if="revisionDetail" class="flex flex-col gap-3">
          <div class="flex flex-wrap gap-2">
            <UBadge color="neutral" variant="subtle" size="sm">v{{ revisionDetail.revision }}</UBadge>
            <UBadge :color="statusColor(revisionDetail.status)" variant="subtle" size="sm">
              {{ t(`admin.content.status.${revisionDetail.status}`) }}
            </UBadge>
            <UBadge color="neutral" variant="subtle" size="sm">{{ t(`admin.content.audit.${revisionDetail.action}`) }}</UBadge>
            <span class="text-xs text-muted">
              {{ revisionDetail.actor.name || revisionDetail.actor.email || revisionDetail.actor.id }} · {{ formatTime(revisionDetail.createdAt) }}
            </span>
          </div>
          <div>
            <p class="text-xs font-semibold text-highlighted">{{ t('admin.content.versions.changed') }}</p>
            <p v-if="!revisionDetail.diff.length" class="mt-1 text-xs text-muted">{{ t('admin.content.versions.noChanges') }}</p>
            <ul v-else class="mt-2 flex flex-col gap-2">
              <li
                v-for="change in revisionDetail.diff"
                :key="change.field"
                class="rounded-sm border border-default/60 bg-elevated/30 p-2 text-xs"
              >
                <p class="font-mono text-[11px] font-medium text-highlighted">{{ change.field }}</p>
                <p class="mt-1 text-muted"><span class="font-medium">{{ t('admin.content.versions.diffBefore') }}:</span> {{ change.before }}</p>
                <p class="text-default"><span class="font-medium">{{ t('admin.content.versions.diffAfter') }}:</span> {{ change.after }}</p>
              </li>
            </ul>
          </div>
          <div v-for="localeEntry in revisionDetail.snapshot.locales" :key="`snap-${localeEntry.locale}`" class="rounded-sm border border-default/60 p-3">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge color="primary" variant="subtle" size="sm">{{ localeEntry.locale }}</UBadge>
              <p class="text-sm font-semibold text-highlighted">{{ localeEntry.title }}</p>
              <span class="font-mono text-xs text-muted">/{{ localeEntry.slug }}</span>
            </div>
            <p v-if="localeEntry.excerpt" class="mt-1 text-xs text-muted">{{ localeEntry.excerpt }}</p>
            <pre class="scroll-thin mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-sm bg-elevated/40 p-2 text-[11px] leading-relaxed text-default">{{ localeEntry.body || '—' }}</pre>
          </div>
        </div>
        <p v-else-if="revisionDetailLoading" class="text-xs text-muted">{{ t('common.loading') }}</p>
      </template>
      <template #footer="{ close }">
        <div class="flex w-full flex-wrap items-center justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :label="t('admin.content.close')" @click="close()" />
          <UButton
            v-if="canWrite && selected && revisionDetail && revisionDetail.revision !== selected.revision"
            icon="i-lucide-rotate-ccw"
            color="primary"
            variant="soft"
            size="sm"
            :label="t('admin.content.versions.restore')"
            :loading="restoringRevision === revisionDetail.revision"
            @click="restoreVersion(revisionDetail.revision)"
          />
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
            <UFormField :label="t('admin.content.fields.type')" name="type">
              <USelect v-model="form.type" :items="editorTypeItems" value-key="value" class="w-full" />
            </UFormField>
          </div>

          <div class="flex items-center gap-2">
            <UButton
              v-for="tab in localeTabs"
              :key="tab.value"
              size="sm"
              :color="activeLocale === tab.value ? 'primary' : 'neutral'"
              :variant="activeLocale === tab.value ? 'soft' : 'ghost'"
              :label="tab.label"
              @click="activeLocale = tab.value"
            />
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField :label="t('admin.content.fields.title')" :name="`title-${activeLocale}`">
              <UInput v-model="activeForm.title" :placeholder="t('admin.content.fields.titlePlaceholder')" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.content.fields.slug')" :name="`slug-${activeLocale}`">
              <UInput v-model="activeForm.slug" :placeholder="t('admin.content.fields.slugPlaceholder')" class="w-full font-mono" />
            </UFormField>
          </div>

          <UFormField :label="t('admin.content.fields.excerpt')" :name="`excerpt-${activeLocale}`">
            <UTextarea v-model="activeForm.excerpt" :rows="2" :placeholder="t('admin.content.fields.excerptPlaceholder')" class="w-full" />
          </UFormField>

          <UFormField :label="t('admin.content.fields.format')" :name="`format-${activeLocale}`">
            <USelect v-model="activeForm.format" :items="bodyFormatItems" value-key="value" class="w-full sm:w-56" />
          </UFormField>

          <UFormField :label="t('admin.content.fields.body')" :name="`body-${activeLocale}`">
            <UTextarea v-model="activeForm.body" :rows="10" :placeholder="t(`admin.content.fields.bodyPlaceholder.${activeForm.format}`)" class="w-full font-mono" />
          </UFormField>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField :label="t('admin.content.fields.seoTitle')" :name="`seo-title-${activeLocale}`">
              <UInput v-model="activeForm.seoTitle" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.content.fields.seoDescription')" :name="`seo-description-${activeLocale}`">
              <UInput v-model="activeForm.seoDescription" class="w-full" />
            </UFormField>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField :label="t('admin.content.fields.tags')" name="tags">
              <UInput v-model="form.tags" :placeholder="t('admin.content.fields.tagsPlaceholder')" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.content.fields.categories')" name="categories">
              <USelectMenu
                v-model="form.categories"
                :items="categoryOptions"
                value-key="value"
                multiple
                searchable
                class="w-full"
                :placeholder="t('admin.content.fields.categoriesPlaceholder')"
              />
            </UFormField>
            <UFormField :label="t('admin.content.fields.media')" name="media">
              <USelectMenu
                v-model="form.media"
                :items="mediaOptions"
                value-key="value"
                multiple
                searchable
                class="w-full"
                :placeholder="mediaOptions.length ? t('admin.content.fields.mediaPlaceholder') : t('admin.content.fields.mediaEmpty')"
              />
            </UFormField>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField :label="t('admin.content.fields.publishAt')" name="publishAt">
              <UInput v-model="form.publishAt" type="datetime-local" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.content.fields.unpublishAt')" name="unpublishAt">
              <UInput v-model="form.unpublishAt" type="datetime-local" class="w-full" />
            </UFormField>
          </div>

          <p v-if="formError" class="text-sm text-error">{{ formError }}</p>
        </div>
      </template>

      <template #footer="{ close }">
        <div class="flex w-full items-center justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :label="t('common.cancel')" @click="close()" />
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

    <UModal v-model:open="scheduleOpen" :title="t('admin.content.scheduleTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }">
      <template #body>
        <div class="flex flex-col gap-3">
          <p class="text-sm text-muted">{{ t('admin.content.scheduleHint') }}</p>
          <UFormField :label="t('admin.content.fields.publishAt')" name="scheduleAt">
            <UInput v-model="scheduleAt" type="datetime-local" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer="{ close }">
        <div class="flex w-full items-center justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :label="t('common.cancel')" @click="close()" />
          <UButton
            color="primary"
            variant="soft"
            size="sm"
            :label="t('admin.content.actions.schedule')"
            :loading="scheduleBusy"
            @click="confirmSchedule"
          />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="deleteOpen" :title="t('admin.content.deleteConfirmTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }">
      <template #body>
        <p class="text-sm text-muted">
          {{ t('admin.content.deleteConfirmText', { title: selected?.locales[0]?.title ?? selected?.key ?? '' }) }}
        </p>
        <p class="mt-2 text-xs text-muted">{{ t('admin.content.softDeleteNote') }}</p>
      </template>
      <template #footer="{ close }">
        <div class="flex w-full items-center justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :label="t('common.cancel')" @click="close()" />
          <UButton
            color="error"
            variant="soft"
            size="sm"
            :label="t('common.delete')"
            :loading="busyId === selected?.id"
            @click="selected && act(selected, 'delete')"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="bulkOpen"
      :title="t('admin.content.bulk.confirmTitle', { count: bulkCount })"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }"
    >
      <template #body>
        <div class="flex flex-col gap-3">
          <p class="text-sm text-muted">{{ t(`admin.content.bulk.confirm.${bulkAction}`) }}</p>

          <div v-if="bulkResult" class="flex flex-col gap-2">
            <p class="text-sm font-medium text-highlighted">
              {{ t('admin.content.bulk.done', { ok: bulkResult.succeeded, total: bulkResult.results.length }) }}
            </p>
            <ul v-if="bulkResult.failed" class="flex flex-col gap-1.5">
              <li
                v-for="row in bulkResult.results.filter(item => !item.ok)"
                :key="row.id"
                class="rounded-sm border border-error/30 bg-error/5 p-2 text-xs"
              >
                <p class="font-medium text-highlighted">{{ bulkLabel(row) }}</p>
                <p class="mt-0.5 text-error">{{ bulkRowError(row) }}</p>
              </li>
            </ul>
          </div>
        </div>
      </template>
      <template #footer="{ close }">
        <div class="flex w-full items-center justify-end gap-2">
          <UButton
            v-if="!bulkResult"
            color="neutral"
            variant="ghost"
            size="sm"
            :label="t('common.cancel')"
            @click="close()"
          />
          <UButton
            v-else
            color="neutral"
            variant="soft"
            size="sm"
            :label="t('admin.content.bulk.close')"
            @click="close()"
          />
          <UButton
            v-if="!bulkResult"
            :color="bulkAction === 'delete' ? 'error' : 'primary'"
            variant="soft"
            size="sm"
            :label="t('admin.content.bulk.run')"
            :loading="bulkBusy"
            :disabled="bulkBusy"
            @click="confirmBulk"
          />
        </div>
      </template>
    </UModal>
  </CmsBasePage>
</template>
