<script setup lang="ts">
import type { AdminCategory, AdminCategoryDraft, AdminCategoryNode } from '@tm/flow-contracts/category-admin'
import { ADMIN_CATEGORY_MAX_DEPTH } from '@tm/flow-contracts/category-admin'

const { t, locale } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const { list, create, update, remove, errorCode } = useCategoryAdmin()

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
  vi: { name: '', slug: '' },
  en: { name: '', slug: '' },
})

const deleteOpen = ref(false)
const deleting = ref<AdminCategory | null>(null)
const deleteBusy = ref(false)
const deleteError = ref<string | null>(null)

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

function resetForm() {
  editing.value = null
  formError.value = null
  form.key = ''
  form.parent = null
  form.order = 0
  form.vi = { name: '', slug: '' }
  form.en = { name: '', slug: '' }
}

function openCreate(parent: string | null = null) {
  resetForm()
  form.parent = parent
  const siblings = flat.value.filter(entry => (entry.parent ?? null) === parent)
  form.order = siblings.length
  formOpen.value = true
}

function openEdit(node: AdminCategory) {
  resetForm()
  editing.value = node
  form.key = node.key
  form.parent = node.parent
  form.order = node.order
  for (const entry of node.locales) {
    if (entry.locale !== 'vi' && entry.locale !== 'en') continue
    form[entry.locale] = { name: entry.name, slug: entry.slug }
  }
  formOpen.value = true
}

function buildDraft(): AdminCategoryDraft {
  const locales = (['vi', 'en'] as const)
    .map(code => ({ locale: code, name: form[code].name.trim(), slug: form[code].slug.trim() }))
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
      await update(editing.value.id, { ...draft, revision: editing.value.revision })
      toast.add({ title: t('admin.categories.updated'), color: 'success' })
    } else {
      await create(draft)
      toast.add({ title: t('admin.categories.created'), color: 'success' })
    }
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
  deleteOpen.value = true
}

async function confirmDelete() {
  if (!deleting.value || deleteBusy.value) return
  deleteBusy.value = true
  try {
    await remove(deleting.value.id, deleting.value.revision)
    toast.add({ title: t('admin.categories.deleted'), color: 'success' })
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

      <div v-if="canRead && rows.length" class="overflow-hidden rounded-[4px] border border-default/60">
        <div
          v-for="{ node, depth } in rows"
          :key="node.id"
          class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0"
        >
          <div class="min-w-0 flex-1" :style="{ paddingLeft: `${depth * 1.25}rem` }">
            <div class="flex flex-wrap items-center gap-2">
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
          </div>

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
