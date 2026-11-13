<script setup lang="ts">
import type { AdminMenu, AdminMenuChildItem, AdminMenuItem, AdminMenuSummary, MenuLinkOptions } from '@tm/flow-contracts/menu-admin'
import {
  MENU_LABEL_MAX,
  MENU_LINK_TYPES,
  MENU_MAX_CHILDREN,
  MENU_MAX_ITEMS,
  countMenuItems,
  emptyMenuChildItem,
  emptyMenuItem,
} from '@tm/flow-contracts/menu-admin'

const { t, locale } = useI18n()
const toast = useToast()
const route = useRoute()
const { hasCapability } = useHub()
const { list, get, create, save, remove, linkOptions, errorCode } = useMenuAdmin()

const canRead = computed(() => hasCapability('configs.read'))
const canWrite = computed(() => hasCapability('configs.write'))

const loading = ref(false)
const error = ref<string | null>(null)
const menus = ref<AdminMenuSummary[]>([])

const selectedId = ref<string | null>(null)
const detail = ref<AdminMenu | null>(null)
const detailLoading = ref(false)
const draftName = ref('')
const draftItems = ref<AdminMenuItem[]>([])
const saving = ref(false)
const saveError = ref<string | null>(null)

const createOpen = ref(false)
const creating = ref(false)
const createError = ref<string | null>(null)
const createForm = reactive({ key: '', name: '' })

const itemOpen = ref(false)
/**
 * Which row the item dialog is editing. `index === null` creates a top-level
 * item, `child === null` edits one, `child === -1` appends a child, and a child
 * index edits that child.
 */
const itemTarget = ref<{ index: number | null, child: number | null }>({ index: null, child: null })
const itemError = ref<string | null>(null)
const itemForm = reactive({
  vi: '',
  en: '',
  type: 'url' as (typeof MENU_LINK_TYPES)[number],
  target: '',
})

// Reference choices for the item dialog. Loaded on first use and refreshed
// whenever another menu is opened, so a page created in the meantime shows up.
const linkChoices = ref<MenuLinkOptions>({ content: [], category: [] })
const choicesLoaded = ref(false)
const choicesLoading = ref(false)
const choicesError = ref<string | null>(null)

const deleteOpen = ref(false)
const deleteBusy = ref(false)
const deleteError = ref<string | null>(null)
const auditReason = ref('')

const dirty = computed(() => {
  if (!detail.value) return false
  return draftName.value.trim() !== detail.value.name
    || JSON.stringify(draftItems.value) !== JSON.stringify(detail.value.items)
})

const totalItems = computed(() => countMenuItems(draftItems.value))

const itemDialogTitle = computed(() => {
  const target = itemTarget.value
  if (target.index === null) return t('admin.menus.itemCreateTitle')
  if (target.child === null) return t('admin.menus.itemEditTitle')
  if (target.child < 0) return t('admin.menus.childCreateTitle')
  return t('admin.menus.childEditTitle')
})

/** Position of the row the dialog edits, for the parent hint. */
const itemParentLabel = computed(() => {
  const target = itemTarget.value
  return target.index === null ? '' : labelOf(draftItems.value[target.index] ?? emptyMenuItem())
})

function cloneItem(item: AdminMenuItem): AdminMenuItem {
  return {
    label: { ...item.label },
    link: { ...item.link },
    children: (item.children ?? []).map(child => ({ label: { ...child.label }, link: { ...child.link } })),
  }
}

const labelOf = (item: { label: { vi: string, en: string } }) =>
  item.label[locale.value as 'vi' | 'en'] || item.label.vi || item.label.en || '—'

const targetPlaceholder = computed(() => {
  if (itemForm.type === 'content') return 'gioi-thieu'
  if (itemForm.type === 'category') return 'trang-suc'
  return '/gioi-thieu'
})

const linkIcon = (type: string) => {
  if (type === 'content') return 'i-lucide-file-text'
  if (type === 'category') return 'i-lucide-folder'
  return 'i-lucide-link'
}

const errorMessages: Record<string, string> = {
  MENU_KEY_EXISTS: 'admin.menus.errors.keyExists',
  MENU_KEY_INVALID: 'admin.menus.errors.keyInvalid',
  MENU_NAME_REQUIRED: 'admin.menus.errors.nameRequired',
  MENU_REVISION_CONFLICT: 'admin.menus.errors.revisionConflict',
  MENU_REVISION_REQUIRED: 'admin.menus.errors.revisionConflict',
  MENU_UPDATE_UNCHANGED: 'admin.menus.errors.unchanged',
  MENU_KEY_IMMUTABLE: 'admin.menus.errors.keyImmutable',
  MENU_ITEMS_LIMIT: 'admin.menus.errors.itemsLimit',
  MENU_CHILDREN_LIMIT: 'admin.menus.errors.childrenLimit',
  MENU_DEPTH_LIMIT: 'admin.menus.errors.depthLimit',
  MENU_LABEL_REQUIRED: 'admin.menus.errors.labelRequired',
  MENU_LABEL_INVALID: 'admin.menus.errors.labelInvalid',
  MENU_TARGET_INVALID: 'admin.menus.errors.targetInvalid',
  MENU_TARGET_REQUIRED: 'admin.menus.errors.targetRequired',
  MENU_TARGET_NOT_FOUND: 'admin.menus.errors.targetNotFound',
  MENU_LINK_TYPE_INVALID: 'admin.menus.errors.targetInvalid',
  MENU_PAYLOAD_INVALID: 'admin.menus.errors.payloadInvalid',
  MENU_NOT_FOUND: 'admin.menus.errors.notFound',
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

async function loadMenus() {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    menus.value = await list()
    // A warning elsewhere in the CMS links straight to the menu that needs
    // fixing (`/menus?menu=<id>`), so that menu opens instead of the first one.
    const requested = typeof route.query.menu === 'string' ? route.query.menu : null
    if (requested && menus.value.some(entry => entry.id === requested)) {
      selectedId.value = requested
    }
    if (!menus.value.some(entry => entry.id === selectedId.value)) {
      selectedId.value = menus.value[0]?.id ?? null
    }
    if (selectedId.value) await selectMenu(selectedId.value)
    else resetDetail()
  } catch (e) {
    error.value = describeError(e)
  } finally {
    loading.value = false
  }
}

function resetDetail() {
  detail.value = null
  draftName.value = ''
  draftItems.value = []
  saveError.value = null
}

async function selectMenu(id: string) {
  selectedId.value = id
  choicesLoaded.value = false
  detailLoading.value = true
  saveError.value = null
  try {
    const menu = await get(id)
    detail.value = menu
    draftName.value = menu.name
    draftItems.value = menu.items.map(cloneItem)
  } catch (e) {
    saveError.value = describeError(e)
    resetDetail()
  } finally {
    detailLoading.value = false
  }
}

async function saveMenu() {
  if (!detail.value || !canWrite.value || saving.value) return
  saveError.value = null
  saving.value = true
  try {
    const updated = await save(detail.value.id, {
      revision: detail.value.revision,
      name: draftName.value.trim(),
      items: draftItems.value,
    }, auditReason.value.trim() || undefined)
    auditReason.value = ''
    detail.value = updated
    draftName.value = updated.name
    draftItems.value = updated.items.map(cloneItem)
    menus.value = menus.value.map(entry => (entry.id === updated.id
      ? { ...entry, name: updated.name, revision: updated.revision, itemCount: updated.itemCount, updatedAt: updated.updatedAt }
      : entry))
    toast.add({ title: t('admin.menus.saved'), color: 'success' })
  } catch (e) {
    saveError.value = describeError(e)
    toast.add({ title: saveError.value, color: 'error' })
    if (errorCode(e) === 'MENU_REVISION_CONFLICT' || errorCode(e) === 'MENU_UPDATE_UNCHANGED') {
      await selectMenu(detail.value.id)
    }
  } finally {
    saving.value = false
  }
}

function openCreate() {
  auditReason.value = ''
  createForm.key = ''
  createForm.name = ''
  createError.value = null
  createOpen.value = true
}

async function submitCreate() {
  if (creating.value) return
  createError.value = null
  creating.value = true
  try {
    const created = await create({ key: createForm.key.trim(), name: createForm.name.trim() }, auditReason.value.trim() || undefined)
    auditReason.value = ''
    toast.add({ title: t('admin.menus.created'), color: 'success' })
    createOpen.value = false
    selectedId.value = created.id
    await loadMenus()
  } catch (e) {
    createError.value = describeError(e)
  } finally {
    creating.value = false
  }
}

async function ensureLinkChoices() {
  if (choicesLoaded.value || choicesLoading.value) return
  choicesLoading.value = true
  choicesError.value = null
  try {
    linkChoices.value = await linkOptions()
    choicesLoaded.value = true
  } catch (e) {
    choicesError.value = describeError(e)
  } finally {
    choicesLoading.value = false
  }
}

/**
 * Options for the target select. A target that is not in the list is still shown
 * (marked as missing) so an item saved before a record was deleted can be seen
 * and replaced instead of looking empty.
 */
const targetItems = computed(() => {
  if (itemForm.type === 'url') return []
  const source = itemForm.type === 'content' ? linkChoices.value.content : linkChoices.value.category
  const entries = source.map(entry => ({ value: entry.key, label: `${entry.label} · ${entry.key}` }))
  const current = itemForm.target.trim()
  if (current && !entries.some(entry => entry.value === current)) {
    entries.unshift({ value: current, label: `${current} (${t('admin.menus.targetPick.missing')})` })
  }
  return entries
})

/**
 * A target means something per link type (`/` is a URL, `trang-suc` a key), so
 * changing the type clears it instead of leaving a value that cannot resolve.
 */
function onTypeChange(type: string) {
  itemForm.target = ''
  if (type !== 'url') void ensureLinkChoices()
}

function openItem(index: number | null, child: number | null = null) {
  itemError.value = null
  itemTarget.value = { index, child }
  const parent = index === null ? null : draftItems.value[index]
  const source: AdminMenuChildItem = index === null
    ? emptyMenuItem()
    : child === null
      ? parent ?? emptyMenuChildItem()
      : child < 0
        ? emptyMenuChildItem()
        : parent?.children[child] ?? emptyMenuChildItem()
  itemForm.vi = source.label.vi
  itemForm.en = source.label.en
  itemForm.type = source.link.type
  itemForm.target = source.link.target
  itemOpen.value = true
  if (itemForm.type !== 'url') void ensureLinkChoices()
}

function submitItem() {
  if (itemForm.type !== 'url') {
    // Keys are typed as plain text; a stray space is the usual reason a link
    // silently stops matching, so it is trimmed before the item is stored.
    itemForm.target = itemForm.target.trim()
  }
  const next = {
    label: { vi: itemForm.vi.trim(), en: itemForm.en.trim() },
    link: { type: itemForm.type, target: itemForm.target.trim() },
  }
  if (!next.label.vi && !next.label.en) {
    itemError.value = t('admin.menus.errors.labelRequired')
    return
  }
  if (!next.link.target) {
    itemError.value = t('admin.menus.errors.targetRequired')
    return
  }
  const target = itemTarget.value
  if (target.index === null) {
    if (totalItems.value >= MENU_MAX_ITEMS) {
      itemError.value = t('admin.menus.errors.itemsLimit')
      return
    }
    draftItems.value = [...draftItems.value, { ...next, children: [] }]
  } else if (target.child === null) {
    draftItems.value = draftItems.value.map((item, index) => (index === target.index
      ? { ...next, children: item.children }
      : item))
  } else if (target.child < 0) {
    const parent = draftItems.value[target.index]
    if (!parent) return
    if (parent.children.length >= MENU_MAX_CHILDREN) {
      itemError.value = t('admin.menus.errors.childrenLimit')
      return
    }
    if (totalItems.value >= MENU_MAX_ITEMS) {
      itemError.value = t('admin.menus.errors.itemsLimit')
      return
    }
    draftItems.value = draftItems.value.map((item, index) => (index === target.index
      ? { ...item, children: [...item.children, next] }
      : item))
  } else {
    draftItems.value = draftItems.value.map((item, index) => (index === target.index
      ? { ...item, children: item.children.map((child, position) => (position === target.child ? next : child)) }
      : item))
  }
  itemOpen.value = false
}

/**
 * One reorder routine for both levels: `'root'` is the top-level list, a number
 * is the children list of that top-level row. Drag and the arrow buttons both
 * land here, so the two ways of moving a row cannot drift apart.
 */
function reorder(list: 'root' | number, from: number, to: number) {
  if (from === to) return
  if (list === 'root') {
    if (from < 0 || from >= draftItems.value.length || to < 0 || to >= draftItems.value.length) return
    const next = [...draftItems.value]
    const [moved] = next.splice(from, 1)
    if (moved) next.splice(to, 0, moved)
    draftItems.value = next
    return
  }
  draftItems.value = draftItems.value.map((item, index) => {
    if (index !== list) return item
    if (from < 0 || from >= item.children.length || to < 0 || to >= item.children.length) return item
    const children = [...item.children]
    const [moved] = children.splice(from, 1)
    if (moved) children.splice(to, 0, moved)
    return { ...item, children }
  })
}

function moveItem(index: number, delta: number) {
  reorder('root', index, index + delta)
}

function moveChild(index: number, childIndex: number, delta: number) {
  reorder(index, childIndex, childIndex + delta)
}

function removeItem(index: number) {
  draftItems.value = draftItems.value.filter((_, position) => position !== index)
}

/**
 * Promoting a child is the only way to move a row between levels without
 * retyping its label and target: the row is lifted out of `children` and placed
 * directly under its former parent, so nothing else changes order. The total
 * number of rows is unchanged, so neither cap needs re-checking.
 */
function promoteChild(index: number, childIndex: number) {
  const parent = draftItems.value[index]
  const child = parent?.children[childIndex]
  if (!parent || !child) return
  const next = [...draftItems.value]
  next[index] = { ...parent, children: parent.children.filter((_, position) => position !== childIndex) }
  next.splice(index + 1, 0, { label: child.label, link: child.link, children: [] })
  draftItems.value = next
}

/**
 * Demoting is the inverse of promoting: a top-level row becomes the last child of
 * the row above it, so it keeps its label and target and nothing else moves. The
 * total row count is unchanged; only the per-parent children cap can refuse it.
 */
function demoteItem(index: number) {
  const parent = draftItems.value[index - 1]
  const target = draftItems.value[index]
  if (!parent || !target) return
  if (parent.children.length >= MENU_MAX_CHILDREN) {
    itemError.value = t('admin.menus.errors.childrenLimit')
    return
  }
  const next = draftItems.value.map((item, position) => (position === index - 1
    ? { ...item, children: [...item.children, { label: target.label, link: target.link, children: [] }] }
    : item))
  next.splice(index, 1)
  draftItems.value = next
}

function removeChild(index: number, childIndex: number) {
  draftItems.value = draftItems.value.map((item, position) => (position === index
    ? { ...item, children: item.children.filter((_, child) => child !== childIndex) }
    : item))
}

/** Drag state is the list identity plus the row, not `dataTransfer`. */
const drag = ref<{ list: 'root' | number, index: number } | null>(null)
const dragOver = ref<{ list: 'root' | number, index: number } | null>(null)

function onDragStart(list: 'root' | number, index: number, event: DragEvent) {
  drag.value = { list, index }
  // Firefox refuses to start a drag unless some data is attached.
  event.dataTransfer?.setData('text/plain', String(index))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(list: 'root' | number, index: number) {
  if (!drag.value || drag.value.list !== list) return
  dragOver.value = { list, index }
}

function onDrop(list: 'root' | number, index: number) {
  const from = drag.value
  drag.value = null
  dragOver.value = null
  if (!from || from.list !== list) return
  reorder(list, from.index, index)
}

function onDragEnd() {
  drag.value = null
  dragOver.value = null
}

/**
 * A finger cannot start an HTML drag, so the grip runs a pointer drag of its
 * own: the row only counts as dragged after a few pixels of movement (tapping
 * the grip stays a tap), and the drop target is the row under the pointer, read
 * from `data-menu-row-*` instead of from drag events. Mouse keeps the native
 * drag above and returns here, so nothing starts twice.
 */
const pointerDrag = ref<{ list: 'root' | number, index: number, startX: number, startY: number, active: boolean } | null>(null)

function onPointerDragStart(list: 'root' | number, index: number, event: PointerEvent) {
  if (!canWrite.value || event.pointerType === 'mouse') return
  pointerDrag.value = { list, index, startX: event.clientX, startY: event.clientY, active: false }
  // Synthetic pointers (tests, some assistive tools) are not active pointers.
  try {
    (event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId)
  } catch {}
}

function onPointerDragMove(event: PointerEvent) {
  const state = pointerDrag.value
  if (!state) return
  if (!state.active) {
    if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 6) return
    state.active = true
    drag.value = { list: state.list, index: state.index }
  }
  event.preventDefault()
  const row = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)
    ?.closest<HTMLElement>('[data-menu-row-list]')
  if (!row?.dataset.menuRowList) return
  const list: 'root' | number = row.dataset.menuRowList === 'root' ? 'root' : Number(row.dataset.menuRowList)
  const index = Number(row.dataset.menuRowIndex)
  if (Number.isNaN(index) || drag.value?.list !== list) return
  dragOver.value = { list, index }
}

function onPointerDragEnd() {
  const state = pointerDrag.value
  const over = dragOver.value
  pointerDrag.value = null
  if (!state?.active) {
    onDragEnd()
    return
  }
  // A pointer dropped outside its own list has no target: keep the order.
  if (over && over.list === state.list && over.index !== state.index) onDrop(over.list, over.index)
  else onDragEnd()
}

function onPointerDragCancel() {
  pointerDrag.value = null
  onDragEnd()
}

const isDragTarget = (list: 'root' | number, index: number) =>
  dragOver.value?.list === list && dragOver.value.index === index

const isDragging = (list: 'root' | number, index: number) =>
  drag.value?.list === list && drag.value.index === index

function askDelete() {
  deleteError.value = null
  auditReason.value = ''
  deleteOpen.value = true
}

async function confirmDelete() {
  if (!detail.value || deleteBusy.value) return
  deleteBusy.value = true
  deleteError.value = null
  try {
    await remove(detail.value.id, detail.value.revision, auditReason.value.trim() || undefined)
    auditReason.value = ''
    toast.add({ title: t('admin.menus.deleted'), color: 'success' })
    deleteOpen.value = false
    selectedId.value = null
    resetDetail()
    await loadMenus()
  } catch (e) {
    deleteError.value = describeError(e)
    toast.add({ title: deleteError.value, color: 'error' })
  } finally {
    deleteBusy.value = false
  }
}

if (canRead.value) await loadMenus()
</script>

<template>
  <div>
    <CmsBasePage
      :title="t('admin.menus.title')"
      :description="t('admin.menus.description')"
      :loading="loading"
      :error="error"
      :empty="canRead && !loading && !menus.length"
      :empty-text="canRead ? t('admin.menus.empty') : t('admin.menus.permissionDenied')"
      empty-icon="i-lucide-list-tree"
    >
      <template #right>
        <UButton
          v-if="canWrite"
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          size="sm"
          :label="t('admin.menus.create')"
          @click="openCreate()"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          size="sm"
          :label="t('common.refresh')"
          :disabled="!canRead || loading"
          @click="loadMenus()"
        />
      </template>

      <template #emptyAction>
        <UButton
          v-if="canRead && canWrite"
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          size="sm"
          :label="t('admin.menus.create')"
          @click="openCreate()"
        />
      </template>

      <div v-if="canRead && menus.length" class="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div class="overflow-hidden rounded-[4px] border border-default/60">
          <button
            v-for="menu in menus"
            :key="menu.id"
            type="button"
            class="flex w-full flex-col gap-1 border-b border-default/40 px-3 py-2 text-left last:border-b-0 hover:bg-elevated/40"
            :class="menu.id === selectedId ? 'bg-elevated/60' : ''"
            @click="selectMenu(menu.id)"
          >
            <span class="flex items-center gap-2 text-sm font-medium text-highlighted">
              <UIcon name="i-lucide-list-tree" class="size-4 text-muted" />
              {{ menu.name }}
            </span>
            <span class="font-mono text-[11px] text-muted">{{ menu.key }} · {{ t('admin.menus.itemCount', { count: menu.itemCount }) }}</span>
          </button>
        </div>

        <div v-if="detail" class="flex flex-col gap-4">
          <div class="panel flex flex-col gap-3 p-4">
            <div class="flex flex-wrap items-end gap-3">
              <UFormField :label="t('admin.menus.fields.name')" class="min-w-[220px] flex-1">
                <UInput v-model="draftName" class="w-full" :disabled="!canWrite" />
              </UFormField>
              <div class="text-xs text-muted">
                <p class="font-mono">{{ detail.key }}</p>
                <p>{{ t('admin.menus.revision') }} {{ detail.revision }}</p>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-xs text-muted">{{ t('admin.menus.itemsHint') }}</p>
              <p v-if="draftItems.length > 1 && canWrite" class="text-[11px] text-muted">{{ t('admin.menus.dragHint') }}</p>
              <UButton
                v-if="canWrite"
                icon="i-lucide-plus"
                color="neutral"
                variant="soft"
                size="xs"
                :label="t('admin.menus.addItem')"
                :disabled="totalItems >= MENU_MAX_ITEMS"
                @click="openItem(null)"
              />
            </div>

            <p v-if="!draftItems.length" class="rounded-sm border border-dashed border-default/60 p-4 text-center text-xs text-muted">
              {{ t('admin.menus.noItems') }}
            </p>

            <div v-else class="overflow-hidden rounded-[4px] border border-default/60">
              <div
                v-for="(item, index) in draftItems"
                :key="`root-${index}`"
                class="border-b border-default/40 last:border-b-0"
              >
                <div
                  class="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
                  :class="[
                    isDragging('root', index) ? 'opacity-50' : '',
                    isDragTarget('root', index) ? 'bg-primary/10' : '',
                  ]"
                  :draggable="canWrite"
                  :data-menu-row-list="'root'"
                  :data-menu-row-index="index"
                  @dragstart="onDragStart('root', index, $event)"
                  @dragover.prevent="onDragOver('root', index)"
                  @drop.prevent="onDrop('root', index)"
                  @dragend="onDragEnd()"
                >
                  <span
                    v-if="canWrite"
                    class="inline-flex shrink-0 cursor-grab touch-none"
                    @pointerdown="onPointerDragStart('root', index, $event)"
                    @pointermove="onPointerDragMove"
                    @pointerup="onPointerDragEnd"
                    @pointercancel="onPointerDragCancel"
                  >
                    <UIcon name="i-lucide-grip-vertical" class="size-4 text-muted" />
                  </span>
                  <span class="w-5 text-[11px] text-muted">{{ index + 1 }}</span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-medium text-highlighted">{{ labelOf(item) }}</p>
                    <p class="flex flex-wrap items-center gap-1 text-[11px] text-muted">
                      <UIcon :name="linkIcon(item.link.type)" class="size-3" />
                      <span class="font-mono">{{ item.link.target }}</span>
                      <UBadge color="neutral" variant="subtle" size="sm">{{ t(`admin.menus.types.${item.link.type}`) }}</UBadge>
                      <span v-if="item.children.length">{{ t('admin.menus.childCount', { count: item.children.length }) }}</span>
                    </p>
                  </div>
                  <div v-if="canWrite" class="flex items-center gap-1">
                    <UButton
                      icon="i-lucide-corner-down-right"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      :disabled="item.children.length >= MENU_MAX_CHILDREN || totalItems >= MENU_MAX_ITEMS"
                      :title="t('admin.menus.addChild')"
                      @click="openItem(index, -1)"
                    />
                    <UButton
                      icon="i-lucide-indent"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      :disabled="index === 0 || (draftItems[index - 1]?.children.length ?? MENU_MAX_CHILDREN) >= MENU_MAX_CHILDREN"
                      :title="t('admin.menus.demoteItem')"
                      @click="demoteItem(index)"
                    />
                    <UButton icon="i-lucide-arrow-up" color="neutral" variant="ghost" size="xs" :disabled="index === 0" :title="t('admin.menus.moveUp')" @click="moveItem(index, -1)" />
                    <UButton icon="i-lucide-arrow-down" color="neutral" variant="ghost" size="xs" :disabled="index === draftItems.length - 1" :title="t('admin.menus.moveDown')" @click="moveItem(index, 1)" />
                    <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="xs" :title="t('common.edit')" @click="openItem(index)" />
                    <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" :title="t('admin.menus.remove')" @click="removeItem(index)" />
                  </div>
                </div>

                <ul v-if="item.children.length" class="border-t border-default/30 bg-elevated/20">
                  <li
                    v-for="(child, childIndex) in item.children"
                    :key="`child-${index}-${childIndex}`"
                    class="flex flex-wrap items-center gap-3 px-3 py-1.5 pl-10 text-sm"
                    :class="[
                      isDragging(index, childIndex) ? 'opacity-50' : '',
                      isDragTarget(index, childIndex) ? 'bg-primary/10' : '',
                    ]"
                    :draggable="canWrite"
                    :data-menu-row-list="String(index)"
                    :data-menu-row-index="childIndex"
                    @dragstart="onDragStart(index, childIndex, $event)"
                    @dragover.prevent="onDragOver(index, childIndex)"
                    @drop.prevent="onDrop(index, childIndex)"
                    @dragend="onDragEnd()"
                  >
                    <span
                      v-if="canWrite"
                      class="inline-flex shrink-0 cursor-grab touch-none"
                      @pointerdown="onPointerDragStart(index, childIndex, $event)"
                      @pointermove="onPointerDragMove"
                      @pointerup="onPointerDragEnd"
                      @pointercancel="onPointerDragCancel"
                    >
                      <UIcon name="i-lucide-grip-vertical" class="size-3.5 text-muted" />
                    </span>
                    <span class="w-8 text-[11px] text-muted">{{ index + 1 }}.{{ childIndex + 1 }}</span>
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-default">{{ labelOf(child) }}</p>
                      <p class="flex items-center gap-1 text-[11px] text-muted">
                        <UIcon :name="linkIcon(child.link.type)" class="size-3" />
                        <span class="font-mono">{{ child.link.target }}</span>
                      </p>
                    </div>
                    <div v-if="canWrite" class="flex items-center gap-1">
                      <UButton icon="i-lucide-arrow-up" color="neutral" variant="ghost" size="xs" :disabled="childIndex === 0" :title="t('admin.menus.moveUp')" @click="moveChild(index, childIndex, -1)" />
                      <UButton icon="i-lucide-arrow-down" color="neutral" variant="ghost" size="xs" :disabled="childIndex === item.children.length - 1" :title="t('admin.menus.moveDown')" @click="moveChild(index, childIndex, 1)" />
                      <UButton icon="i-lucide-outdent" color="neutral" variant="ghost" size="xs" :title="t('admin.menus.promoteChild')" @click="promoteChild(index, childIndex)" />
                      <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="xs" :title="t('common.edit')" @click="openItem(index, childIndex)" />
                      <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" :title="t('admin.menus.removeChild')" @click="removeChild(index, childIndex)" />
                    </div>
                  </li>
                </ul>
              </div>
            </div>

            <p v-if="saveError" class="rounded-sm border border-error/40 bg-error/10 p-2 text-xs text-error">{{ saveError }}</p>

            <div class="flex flex-wrap items-center justify-between gap-2">
              <UButton
                v-if="canWrite"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                :label="t('admin.menus.deleteMenu')"
                @click="askDelete()"
              />
              <span v-else />
              <div class="flex items-center gap-2">
                <span v-if="dirty" class="text-xs text-warning">{{ t('admin.menus.unsaved') }}</span>
                <UButton
                  v-if="canWrite"
                  color="primary"
                  size="sm"
                  :loading="saving"
                  :disabled="!dirty || !draftName.trim()"
                  :label="t('common.save')"
                  @click="saveMenu()"
                />
              </div>
            </div>
          </div>
        </div>

        <p v-else-if="detailLoading" class="text-sm text-muted">{{ t('common.loading') }}</p>
        <p v-else class="text-sm text-muted">{{ t('admin.menus.selectHint') }}</p>
      </div>
    </CmsBasePage>

    <UModal v-model:open="createOpen" :title="t('admin.menus.createTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }">
      <template #body>
        <div class="flex flex-col gap-4">
          <UFormField :label="t('admin.menus.fields.key')">
            <UInput v-model="createForm.key" class="w-full font-mono" placeholder="main" />
            <p class="mt-1 text-xs text-muted">{{ t('admin.menus.keyHint') }}</p>
          </UFormField>
          <UFormField :label="t('admin.menus.fields.name')">
            <UInput v-model="createForm.name" class="w-full" placeholder="Menu chính" />
          </UFormField>
          <UInput
            v-model="auditReason"
            class="w-full"
            :placeholder="t('common.auditReasonPlaceholder')"
            :aria-label="t('common.auditReason')"
          />
          <p v-if="createError" class="rounded-sm border border-error/40 bg-error/10 p-2 text-xs text-error">{{ createError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :label="t('common.cancel')" @click="createOpen = false" />
          <UButton
            color="primary"
            size="sm"
            :loading="creating"
            :disabled="!createForm.key.trim() || !createForm.name.trim()"
            :label="t('common.save')"
            @click="submitCreate()"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="itemOpen"
      :title="itemDialogTitle"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-lg' }"
    >
      <template #body>
        <div class="flex flex-col gap-4">
          <p v-if="itemTarget.index !== null" class="rounded-sm border border-default/60 bg-elevated/40 px-2 py-1 text-[11px] text-muted">
            {{ t('admin.menus.parentOf', { name: itemParentLabel }) }}
          </p>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.content.locales.vi')">
              <UInput v-model="itemForm.vi" class="w-full" :maxlength="MENU_LABEL_MAX" placeholder="Giới thiệu" />
            </UFormField>
            <UFormField :label="t('admin.content.locales.en')">
              <UInput v-model="itemForm.en" class="w-full" :maxlength="MENU_LABEL_MAX" placeholder="About us" />
            </UFormField>
          </div>
          <UFormField :label="t('admin.menus.fields.type')">
            <USelect
              v-model="itemForm.type"
              :items="MENU_LINK_TYPES.map(type => ({ label: t(`admin.menus.types.${type}`), value: type }))"
              value-key="value"
              class="w-full"
              @update:model-value="onTypeChange"
            />
          </UFormField>
          <UFormField :label="t('admin.menus.fields.target')">
            <USelect
              v-if="itemForm.type !== 'url'"
              v-model="itemForm.target"
              :items="targetItems"
              value-key="value"
              :placeholder="choicesLoading ? t('common.loading') : t('admin.menus.targetPick.placeholder')"
              class="w-full"
              @update:open="(open: boolean) => { if (open) void ensureLinkChoices() }"
            />
            <UInput v-else v-model="itemForm.target" class="w-full font-mono" :placeholder="targetPlaceholder" />
            <p v-if="itemForm.type !== 'url'" class="mt-1 text-xs text-muted">{{ t(`admin.menus.targetHints.${itemForm.type}`) }}</p>
            <p v-if="itemForm.type !== 'url' && choicesError" class="mt-1 text-xs text-error">{{ choicesError }}</p>
            <p
              v-else-if="itemForm.type !== 'url' && !choicesLoading && !targetItems.length"
              class="mt-1 text-xs text-warning"
            >
              {{ t('admin.menus.targetPick.empty') }}
            </p>
          </UFormField>
          <p v-if="itemError" class="rounded-sm border border-error/40 bg-error/10 p-2 text-xs text-error">{{ itemError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :label="t('common.cancel')" @click="itemOpen = false" />
          <UButton color="primary" size="sm" :label="t('admin.menus.applyItem')" @click="submitItem()" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="deleteOpen" :title="t('admin.menus.deleteTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }">
      <template #body>
        <p class="text-sm text-default">{{ t('admin.menus.deleteHint', { name: detail?.name || '' }) }}</p>
        <UInput
          v-model="auditReason"
          class="mt-3 w-full"
          :placeholder="t('common.auditReasonPlaceholder')"
          :aria-label="t('common.auditReason')"
        />
        <p v-if="deleteError" class="mt-3 rounded-sm border border-error/40 bg-error/10 p-2 text-xs text-error">{{ deleteError }}</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" :label="t('common.cancel')" @click="deleteOpen = false" />
          <UButton color="error" size="sm" :loading="deleteBusy" :label="t('common.delete')" @click="confirmDelete()" />
        </div>
      </template>
    </UModal>
  </div>
</template>
