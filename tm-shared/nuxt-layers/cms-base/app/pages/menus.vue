<script setup lang="ts">
import type { AdminMenu, AdminMenuSummary } from '@tm/flow-contracts/menu-admin'
import { MENU_LABEL_MAX, MENU_LINK_TYPES, MENU_MAX_ITEMS, emptyMenuItem } from '@tm/flow-contracts/menu-admin'

const { t, locale } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const { list, get, create, save, remove, errorCode } = useMenuAdmin()

const canRead = computed(() => hasCapability('configs.read'))
const canWrite = computed(() => hasCapability('configs.write'))

const loading = ref(false)
const error = ref<string | null>(null)
const menus = ref<AdminMenuSummary[]>([])

const selectedId = ref<string | null>(null)
const detail = ref<AdminMenu | null>(null)
const detailLoading = ref(false)
const draftName = ref('')
const draftItems = ref<ReturnType<typeof emptyMenuItem>[]>([])
const saving = ref(false)
const saveError = ref<string | null>(null)

const createOpen = ref(false)
const creating = ref(false)
const createError = ref<string | null>(null)
const createForm = reactive({ key: '', name: '' })

const itemOpen = ref(false)
const itemIndex = ref<number | null>(null)
const itemError = ref<string | null>(null)
const itemForm = reactive({
  vi: '',
  en: '',
  type: 'url' as (typeof MENU_LINK_TYPES)[number],
  target: '',
})

const deleteOpen = ref(false)
const deleteBusy = ref(false)
const deleteError = ref<string | null>(null)

const dirty = computed(() => {
  if (!detail.value) return false
  return draftName.value.trim() !== detail.value.name
    || JSON.stringify(draftItems.value) !== JSON.stringify(detail.value.items)
})

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
  MENU_LABEL_REQUIRED: 'admin.menus.errors.labelRequired',
  MENU_LABEL_INVALID: 'admin.menus.errors.labelInvalid',
  MENU_TARGET_INVALID: 'admin.menus.errors.targetInvalid',
  MENU_TARGET_REQUIRED: 'admin.menus.errors.targetRequired',
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
  detailLoading.value = true
  saveError.value = null
  try {
    const menu = await get(id)
    detail.value = menu
    draftName.value = menu.name
    draftItems.value = menu.items.map(item => ({
      label: { ...item.label },
      link: { ...item.link },
    }))
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
    })
    detail.value = updated
    draftName.value = updated.name
    draftItems.value = updated.items.map(item => ({ label: { ...item.label }, link: { ...item.link } }))
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
    const created = await create({ key: createForm.key.trim(), name: createForm.name.trim() })
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

function openItem(index: number | null) {
  itemError.value = null
  itemIndex.value = index
  const source = index === null ? emptyMenuItem() : draftItems.value[index]
  itemForm.vi = source?.label.vi ?? ''
  itemForm.en = source?.label.en ?? ''
  itemForm.type = source?.link.type ?? 'url'
  itemForm.target = source?.link.target ?? ''
  itemOpen.value = true
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
  if (itemIndex.value === null) {
    if (draftItems.value.length >= MENU_MAX_ITEMS) {
      itemError.value = t('admin.menus.errors.itemsLimit')
      return
    }
    draftItems.value = [...draftItems.value, next]
  } else {
    draftItems.value = draftItems.value.map((item, index) => (index === itemIndex.value ? next : item))
  }
  itemOpen.value = false
}

function moveItem(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= draftItems.value.length) return
  const next = [...draftItems.value]
  const [moved] = next.splice(index, 1)
  if (moved) next.splice(target, 0, moved)
  draftItems.value = next
}

function removeItem(index: number) {
  draftItems.value = draftItems.value.filter((_, position) => position !== index)
}

function askDelete() {
  deleteError.value = null
  deleteOpen.value = true
}

async function confirmDelete() {
  if (!detail.value || deleteBusy.value) return
  deleteBusy.value = true
  deleteError.value = null
  try {
    await remove(detail.value.id, detail.value.revision)
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
              <UButton
                v-if="canWrite"
                icon="i-lucide-plus"
                color="neutral"
                variant="soft"
                size="xs"
                :label="t('admin.menus.addItem')"
                :disabled="draftItems.length >= MENU_MAX_ITEMS"
                @click="openItem(null)"
              />
            </div>

            <p v-if="!draftItems.length" class="rounded-sm border border-dashed border-default/60 p-4 text-center text-xs text-muted">
              {{ t('admin.menus.noItems') }}
            </p>

            <div v-else class="overflow-hidden rounded-[4px] border border-default/60">
              <div
                v-for="(item, index) in draftItems"
                :key="index"
                class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0"
              >
                <span class="w-5 text-[11px] text-muted">{{ index + 1 }}</span>
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium text-highlighted">{{ labelOf(item) }}</p>
                  <p class="flex items-center gap-1 text-[11px] text-muted">
                    <UIcon :name="linkIcon(item.link.type)" class="size-3" />
                    <span class="font-mono">{{ item.link.target }}</span>
                    <UBadge color="neutral" variant="subtle" size="sm">{{ t(`admin.menus.types.${item.link.type}`) }}</UBadge>
                  </p>
                </div>
                <div v-if="canWrite" class="flex items-center gap-1">
                  <UButton icon="i-lucide-arrow-up" color="neutral" variant="ghost" size="xs" :disabled="index === 0" :title="t('admin.menus.moveUp')" @click="moveItem(index, -1)" />
                  <UButton icon="i-lucide-arrow-down" color="neutral" variant="ghost" size="xs" :disabled="index === draftItems.length - 1" :title="t('admin.menus.moveDown')" @click="moveItem(index, 1)" />
                  <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="xs" :title="t('common.edit')" @click="openItem(index)" />
                  <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" :title="t('admin.menus.remove')" @click="removeItem(index)" />
                </div>
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
      :title="itemIndex === null ? t('admin.menus.itemCreateTitle') : t('admin.menus.itemEditTitle')"
      :ui="{ content: 'w-[calc(100vw-2rem)] max-w-lg' }"
    >
      <template #body>
        <div class="flex flex-col gap-4">
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
            />
          </UFormField>
          <UFormField :label="t('admin.menus.fields.target')">
            <UInput v-model="itemForm.target" class="w-full font-mono" :placeholder="targetPlaceholder" />
            <p class="mt-1 text-xs text-muted">{{ t(`admin.menus.targetHints.${itemForm.type}`) }}</p>
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
