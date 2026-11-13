<script setup lang="ts">
import type { AdminCategory, AdminCategoryDraft, AdminCategoryNode } from '@tm/flow-contracts/category-admin'
import type { MenuReference } from '@tm/flow-contracts/menu-admin'
import { ADMIN_CATEGORY_MAX_DEPTH } from '@tm/flow-contracts/category-admin'

const { t, locale } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const { list, create, update, remove, reorder, menuReferences, errorCode } = useCategoryAdmin()

const canRead = computed(() => hasCapability('content.read'))
const canWrite = computed(() => hasCapability('content.write'))

const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const flat = ref<AdminCategory[]>([])
const tree = ref<AdminCategoryNode[]>([])

const formOpen = ref(false)
const editing = ref<AdminCategory | null>(null)
const formError = ref<string | null>(null)
const form = reactive({
  key: '',
  parent: null as string | null,
  order: 0,
  vi: { name: '', slug: '', description: '' },
  en: { name: '', slug: '', description: '' },
})

const deleteOpen = ref(false)
const deleting = ref<AdminCategory | null>(null)
const deleteBusy = ref(false)
const deleteError = ref<string | null>(null)
const auditReason = ref('')

const rows = computed(() => {
  const out: { node: AdminCategoryNode, depth: number }[] = []
  const walk = (nodes: AdminCategoryNode[], depth: number) => {
    for (const node of nodes) {
      out.push({ node, depth })
      walk(node.children, depth + 1)
    }
  }
  walk(tree.value, 0)
  return out
})

const nodeName = (node: AdminCategory) => {
  const wanted = node.locales.find(entry => entry.locale === locale.value)
  return wanted?.name || node.locales[0]?.name || node.key
}

const parentItems = computed(() => {
  const blocked = new Set<string>()
  if (editing.value) {
    const collect = (nodes: AdminCategoryNode[]) => {
      for (const node of nodes) {
        if (node.key === editing.value?.key) {
          blocked.add(node.key)
          const mark = (children: AdminCategoryNode[]) => {
            for (const child of children) {
              blocked.add(child.key)
              mark(child.children)
            }
          }
          mark(node.children)
        } else {
          collect(node.children)
        }
      }
    }
    collect(tree.value)
  }

  return [
    { label: t('admin.categories.root'), value: null },
    ...rows.value
      .filter(({ node }) => !blocked.has(node.key))
      .map(({ node, depth }) => ({ label: `${'— '.repeat(depth)}${nodeName(node)}`, value: node.key })),
  ]
})

const errorMessages: Record<string, string> = {
  CATEGORY_KEY_EXISTS: 'admin.categories.errors.keyExists',
  CATEGORY_SLUG_EXISTS: 'admin.categories.errors.slugExists',
  CATEGORY_PARENT_NOT_FOUND: 'admin.categories.errors.parentNotFound',
  CATEGORY_CYCLE: 'admin.categories.errors.cycle',
  CATEGORY_DEPTH_EXCEEDED: 'admin.categories.errors.depthExceeded',
  CATEGORY_REVISION_CONFLICT: 'admin.categories.errors.revisionConflict',
  CATEGORY_HAS_CHILDREN: 'admin.categories.errors.hasChildren',
  CATEGORY_IN_USE: 'admin.categories.errors.inUse',
  CATEGORY_KEY_IMMUTABLE: 'admin.categories.errors.keyImmutable',
  CATEGORY_PAYLOAD_INVALID: 'admin.categories.errors.payloadInvalid',
  CATEGORY_NOT_FOUND: 'admin.categories.errors.notFound',
}

const describeError = (e: unknown) => {
  const code = errorCode(e)
  if (code === 'CATEGORY_IN_MENU') {
    const body = (e as { data?: { data?: { error?: { details?: unknown } } } })?.data
    const details = body?.data?.error?.details as { menus?: Array<{ name?: string, key?: string }> } | undefined
    const names = (details?.menus ?? []).map(menu => menu.name || menu.key || '').filter(Boolean).join(', ')
    return t('admin.categories.errors.inMenu', { menus: names })
  }
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
    const payload = await list()
    flat.value = payload.data
    tree.value = payload.tree
  } catch (e) {
    error.value = describeError(e)
  } finally {
    loading.value = false
  }
}

// Menus that link to the category being edited. Shown before a delete, and a
// failed read stays silent because the delete path has its own guard.
const editingMenuRefs = ref<MenuReference[]>([])

async function loadEditingMenuRefs(id: string) {
  editingMenuRefs.value = []
  try {
    editingMenuRefs.value = await menuReferences(id)
  } catch {
    editingMenuRefs.value = []
  }
}

function resetForm() {
  editing.value = null
  editingMenuRefs.value = []
  formError.value = null
  form.key = ''
  form.parent = null
  form.order = 0
  form.vi = { name: '', slug: '', description: '' }
  form.en = { name: '', slug: '', description: '' }
}

function openCreate(parent: string | null = null) {
  resetForm()
  auditReason.value = ''
  form.parent = parent
  const siblings = flat.value.filter(entry => (entry.parent ?? null) === parent)
  form.order = siblings.length
  formOpen.value = true
}

function openEdit(node: AdminCategory) {
  resetForm()
  auditReason.value = ''
  editing.value = node
  form.key = node.key
  form.parent = node.parent
  form.order = node.order
  for (const entry of node.locales) {
    if (entry.locale !== 'vi' && entry.locale !== 'en') continue
    form[entry.locale] = { name: entry.name, slug: entry.slug, description: entry.description }
  }
  formOpen.value = true
  void loadEditingMenuRefs(node.id)
}

function buildDraft(): AdminCategoryDraft {
  const locales = (['vi', 'en'] as const)
    .map(code => ({
      locale: code,
      name: form[code].name.trim(),
      slug: form[code].slug.trim(),
      description: form[code].description.trim(),
    }))
    .filter(entry => entry.name || entry.slug)
    .map(entry => ({ ...entry, slug: entry.slug || entry.name }))

  return {
    key: form.key.trim(),
    parent: form.parent || null,
    order: Number(form.order) || 0,
    locales,
  }
}

async function submitForm() {
  if (!canWrite.value || saving.value) return
  formError.value = null

  const draft = buildDraft()
  if (!draft.key) {
    formError.value = t('admin.categories.errors.keyRequired')
    return
  }
  if (!draft.locales.length) {
    formError.value = t('admin.categories.errors.nameRequired')
    return
  }

  saving.value = true
  try {
    if (editing.value) {
      await update(editing.value.id, { ...draft, revision: editing.value.revision }, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.categories.updated'), color: 'success' })
    } else {
      await create(draft, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.categories.created'), color: 'success' })
    }
    auditReason.value = ''
    formOpen.value = false
    await load()
  } catch (e) {
    formError.value = describeError(e)
    if (errorCode(e) === 'CATEGORY_REVISION_CONFLICT') await load()
  } finally {
    saving.value = false
  }
}

function askDelete(node: AdminCategory) {
  deleting.value = node
  deleteError.value = null
  auditReason.value = ''
  deleteOpen.value = true
}

async function confirmDelete() {
  if (!deleting.value || deleteBusy.value) return
  deleteBusy.value = true
  try {
    await remove(deleting.value.id, deleting.value.revision, auditReason.value.trim() || undefined)
    toast.add({ title: t('admin.categories.deleted'), color: 'success' })
    auditReason.value = ''
    deleteOpen.value = false
    await load()
  } catch (e) {
    // The toast is easy to miss while the confirm dialog covers the page, so the
    // reason a category cannot be deleted stays visible inside the dialog.
    deleteError.value = describeError(e)
    toast.add({ title: deleteError.value, color: 'error' })
  } finally {
    deleteBusy.value = false
  }
}

// Drag-and-drop ordering. The page keeps the server's tree as the only source of
// truth and sends one move per drop; the response carries the new tree, so two
// open editors converge instead of keeping their own order values.
const dragging = ref<AdminCategory | null>(null)
const dropTarget = ref<{ key: string, position: 'before' | 'inside' | 'after' } | null>(null)
const moving = ref(false)

const parentOf = computed(() => new Map(flat.value.map(entry => [entry.key, entry.parent ?? null])))

function isInsideSubtree(candidateKey: string, ancestorKey: string) {
  let current: string | null = candidateKey
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    if (current === ancestorKey) return true
    current = parentOf.value.get(current) ?? null
  }
  return false
}

/** Siblings of one parent, ordered the way the server orders them. */
function siblingsOf(parent: string | null) {
  return flat.value
    .filter(entry => (entry.parent ?? null) === parent && entry.key !== dragging.value?.key)
    .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
}

function startDrag(node: AdminCategory) {
  if (!canWrite.value) return
  dragging.value = node
}

function endDrag() {
  dragging.value = null
  dropTarget.value = null
}

// A category can never be dropped into its own subtree; the server refuses it
// too, but blocking it while dragging keeps the pointer from offering it.
function canDropOn(node: AdminCategory) {
  return Boolean(canWrite.value && dragging.value && !isInsideSubtree(node.key, dragging.value.key))
}

function hoverDrop(event: DragEvent, node: AdminCategory) {
  if (!canDropOn(node)) return
  event.preventDefault()
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = (event.clientY - box.top) / Math.max(box.height, 1)
  dropTarget.value = {
    key: node.key,
    position: ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'inside',
  }
}

async function dropOn(event: DragEvent, node: AdminCategory) {
  if (!canDropOn(node) || !dragging.value || !dropTarget.value) return
  event.preventDefault()

  const position = dropTarget.value.position
  let parent: string | null
  let index: number

  if (position === 'inside') {
    parent = node.key
    index = siblingsOf(node.key).length
  } else {
    parent = node.parent ?? null
    const siblings = siblingsOf(parent)
    const found = siblings.findIndex(entry => entry.key === node.key)
    index = found < 0 ? siblings.length : found + (position === 'after' ? 1 : 0)
  }

  await moveTo(dragging.value.key, parent, index)
}

async function dropOnRoot(event: DragEvent) {
  if (!canWrite.value || !dragging.value) return
  event.preventDefault()
  await moveTo(dragging.value.key, null, siblingsOf(null).length)
}

async function moveTo(key: string, parent: string | null, index: number) {
  if (moving.value) return
  moving.value = true
  try {
    const payload = await reorder({ key, parent, index }, auditReason.value.trim() || undefined)
    flat.value = payload.data
    tree.value = payload.tree
    toast.add({ title: t('admin.categories.moved'), color: 'success' })
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
    if (errorCode(e) === 'CATEGORY_REVISION_CONFLICT') await load()
  } finally {
    moving.value = false
    endDrag()
  }
}

if (canRead.value) await load()
</script>

<template>
  <div>
    <CmsBasePage
      :title="t('admin.categories.title')"
      :description="t('admin.categories.description')"
      :loading="loading"
      :error="error"
      :empty="canRead && !loading && !rows.length"
      :empty-text="canRead ? t('admin.categories.empty') : t('admin.categories.permissionDenied')"
      empty-icon="i-lucide-folder-tree"
    >
      <template #right>
        <UButton
          v-if="canWrite"
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          size="sm"
          :label="t('admin.categories.create')"
          @click="openCreate()"
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
          :label="t('admin.categories.create')"
          @click="openCreate()"
        />
      </template>

      <div class="mb-2 flex flex-col gap-2">
        <p v-if="canWrite" class="text-[11px] text-muted">{{ t('admin.categories.dragHint') }}</p>
        <div
          v-if="canWrite && dragging"
          class="rounded-[4px] border border-dashed p-2 text-center text-[11px]"
          :class="dropTarget?.key === '__root__' ? 'border-primary text-primary' : 'border-default text-muted'"
          @dragover.prevent="dropTarget = { key: '__root__', position: 'inside' }"
          @drop="dropOnRoot($event)"
        >
          {{ t('admin.categories.rootDrop') }}
        </div>
      </div>

      <div v-if="canRead && rows.length" class="overflow-hidden rounded-[4px] border border-default/60">
        <div
          v-for="{ node, depth } in rows"
          :key="node.id"
          :draggable="canWrite"
          class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0"
          :class="{
            'opacity-50': dragging?.key === node.key,
            'border-t-2 border-t-primary': dropTarget?.key === node.key && dropTarget.position === 'before',
            'border-b-2 border-b-primary': dropTarget?.key === node.key && dropTarget.position === 'after',
            'bg-primary/10': dropTarget?.key === node.key && dropTarget.position === 'inside',
          }"
          @dragstart="startDrag(node)"
          @dragend="endDrag"
          @dragover="hoverDrop($event, node)"
          @drop="dropOn($event, node)"
        >
          <div class="min-w-0 flex-1" :style="{ paddingLeft: `${depth * 1.25}rem` }">
            <div class="flex flex-wrap items-center gap-2">
              <UIcon
                v-if="canWrite"
                name="i-lucide-grip-vertical"
                class="size-4 cursor-grab text-muted"
                :title="t('admin.categories.dragHint')"
              />
              <UIcon :name="node.children.length ? 'i-lucide-folder-tree' : 'i-lucide-folder'" class="size-4 text-muted" />
              <span class="font-medium text-highlighted">{{ nodeName(node) }}</span>
              <span class="font-mono text-[11px] text-muted">{{ node.key }}</span>
              <UBadge v-if="node.locales.length > 1" color="neutral" variant="subtle" size="sm">{{ node.locales.length }} locales</UBadge>
            </div>
            <p class="mt-0.5 text-[11px] text-muted">
              {{ t('admin.categories.order') }}: {{ node.order }} · {{ t('admin.categories.revision') }} {{ node.revision }}
            </p>
          </div>

          <div v-if="canWrite" class="flex items-center gap-1">
            <UButton
              v-if="depth + 1 < ADMIN_CATEGORY_MAX_DEPTH"
              icon="i-lucide-plus"
              color="neutral"
              variant="ghost"
              size="xs"
              :title="t('admin.categories.addChild')"
              @click="openCreate(node.key)"
            />
            <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="xs" :title="t('common.edit')" @click="openEdit(node)" />
            <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" :title="t('common.delete')" @click="askDelete(node)" />
          </div>
        </div>
      </div>
    </CmsBasePage>

    <UModal v-model:open="formOpen" :title="editing ? t('admin.categories.editTitle') : t('admin.categories.createTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-xl' }">
      <template #body>
        <div class="flex flex-col gap-4">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField :label="t('admin.categories.fields.key')" name="key">
              <UInput v-model="form.key" :disabled="Boolean(editing)" class="w-full font-mono" placeholder="trang-suc" />
              <p v-if="editing" class="mt-1 text-xs text-muted">{{ t('admin.categories.keyImmutable') }}</p>
            </UFormField>
            <UFormField :label="t('admin.categories.fields.parent')" name="parent">
              <USelect v-model="form.parent" :items="parentItems" value-key="value" class="w-full" />
            </UFormField>
          </div>

          <UFormField :label="t('admin.categories.fields.order')" name="order">
            <UInput v-model.number="form.order" type="number" min="0" max="9999" class="w-full" />
          </UFormField>

          <div v-for="code in (['vi', 'en'] as const)" :key="code" class="rounded-sm border border-default/60 p-3">
            <p class="mb-2 text-xs font-semibold text-highlighted">{{ t(`admin.content.locales.${code}`) }}</p>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <UFormField :label="t('admin.categories.fields.name')">
                <UInput v-model="form[code].name" class="w-full" :placeholder="code === 'vi' ? 'Trang sức' : 'Jewelry'" />
              </UFormField>
              <UFormField :label="t('admin.categories.fields.slug')">
                <UInput v-model="form[code].slug" class="w-full font-mono" :placeholder="code === 'vi' ? 'trang-suc' : 'jewelry'" />
              </UFormField>
            </div>
            <UFormField class="mt-3" :label="t('admin.categories.fields.description')" :hint="t('admin.categories.fields.descriptionHint')">
              <UTextarea v-model="form[code].description" :rows="2" :maxlength="500" class="w-full" />
            </UFormField>
          </div>

          <div v-if="editingMenuRefs.length" class="rounded-sm border border-warning/40 bg-warning/10 p-3">
            <p class="text-xs font-semibold text-highlighted">{{ t('admin.categories.menuLinks') }}</p>
            <ul class="mt-1 flex flex-col gap-1 text-xs text-default">
              <li v-for="menu in editingMenuRefs" :key="menu.id">
                <NuxtLink :to="`/menus?menu=${encodeURIComponent(menu.id)}`" class="underline decoration-dotted underline-offset-2">
                  {{ menu.name }}
                </NuxtLink>
                <span class="font-mono text-[11px] text-muted">{{ menu.key }}</span>
              </li>
            </ul>
            <p class="mt-1 text-xs text-muted">{{ t('admin.categories.menuLinksHint') }}</p>
          </div>

          <RecordHistory v-if="editing" resource-type="category" :resource-id="editing.id" />

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
          <UButton color="primary" size="sm" :loading="saving" :label="t('common.save')" @click="submitForm" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="deleteOpen" :title="t('admin.categories.deleteTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }">
      <template #body>
        <p class="text-sm text-default">
          {{ t('admin.categories.deleteHint', { name: deleting ? nodeName(deleting) : '' }) }}
        </p>
        <p class="mt-2 text-xs text-muted">{{ t('admin.categories.deleteGuard') }}</p>
        <p v-if="deleteError" class="mt-3 rounded-sm border border-error/40 bg-error/10 p-2 text-xs text-error">
          {{ deleteError }}
        </p>
        <UInput
          v-model="auditReason"
          class="mt-3 w-full"
          :placeholder="t('common.auditReasonPlaceholder')"
          :aria-label="t('common.auditReason')"
        />
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
