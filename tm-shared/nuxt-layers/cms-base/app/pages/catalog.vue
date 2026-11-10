<script setup lang="ts">
import type {
  AdminCatalogAttribute,
  AdminCatalogCategory,
  AdminCatalogEvent,
  AdminCatalogItem,
  AdminCatalogItemDraft,
  AdminCatalogStatus,
  AdminCatalogStatusFilter,
  AdminCatalogVariant,
} from '@tm/flow-contracts/catalog-admin'

const { t } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const {
  list,
  create,
  update,
  runEvent,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listTags,
  errorCode,
} = useCatalogAdmin()

const canRead = computed(() => hasCapability('content.read'))
const canWrite = computed(() => hasCapability('content.write'))

const loading = ref(false)
const saving = ref(false)
const busyId = ref<string | null>(null)
const error = ref<string | null>(null)
const entries = ref<AdminCatalogItem[]>([])
const counts = ref<Record<string, number>>({})
const categories = ref<AdminCatalogCategory[]>([])
const tagOptions = ref<{ label: string, value: string }[]>([])

const search = ref('')
const status = ref<AdminCatalogStatusFilter>('all')
const typeFilter = ref<'all' | 'simple' | 'variable'>('all')
const tagFilter = ref('all')

const statusItems = computed(() => [
  { label: t('admin.catalog.filters.allStatuses'), value: 'all' },
  ...(['draft', 'published', 'archived', 'deleted'] as const).map(value => ({
    label: t(`admin.catalog.status.${value}`),
    value,
  })),
])

const typeItems = computed(() => [
  { label: t('admin.catalog.filters.allTypes'), value: 'all' },
  { label: t('admin.catalog.type.simple'), value: 'simple' },
  { label: t('admin.catalog.type.variable'), value: 'variable' },
])

const tagItems = computed(() => [
  { label: t('admin.catalog.filters.allTags'), value: 'all' },
  ...tagOptions.value,
])

const categoryOptions = computed(() => categories.value.map(category => ({
  label: category.fullPath.vi || category.title.vi || category.key,
  value: category.key,
})))

const statusColor = (value: AdminCatalogStatus) => {
  switch (value) {
    case 'published':
      return 'success'
    case 'archived':
      return 'warning'
    case 'deleted':
      return 'error'
    default:
      return 'neutral'
  }
}

function messageFor(code: string | null) {
  if (code === 'CATALOG_REVISION_CONFLICT') return t('admin.catalog.errors.revisionConflict')
  if (code === 'CATALOG_KEY_EXISTS') return t('admin.catalog.errors.keyExists')
  if (code === 'CATALOG_CATEGORY_IN_USE') return t('admin.catalog.errors.categoryInUse')
  if (code === 'CATALOG_CATEGORY_HAS_CHILDREN') return t('admin.catalog.errors.categoryHasChildren')
  return t('admin.catalog.errors.generic')
}

async function load() {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const payload = await list({
      status: status.value,
      type: typeFilter.value === 'all' ? undefined : typeFilter.value,
      tag: tagFilter.value === 'all' ? undefined : tagFilter.value,
      q: search.value.trim() || undefined,
      limit: 50,
    })
    entries.value = payload.data
    counts.value = payload.meta?.counts ?? {}
  } catch (caught) {
    error.value = messageFor(errorCode(caught))
  } finally {
    loading.value = false
  }
}

async function loadReferenceData() {
  if (!canRead.value) return
  try {
    categories.value = await listCategories()
  } catch {
    categories.value = []
  }
  try {
    tagOptions.value = (await listTags()).map(tag => ({ label: `${tag.name} (${tag.count})`, value: tag.name }))
  } catch {
    tagOptions.value = []
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => load(), 400)
})
watch([status, typeFilter, tagFilter], () => load())
onMounted(async () => {
  await Promise.all([load(), loadReferenceData()])
})

// ---------------------------------------------------------------- item editor

const formOpen = ref(false)
const editingId = ref<string | null>(null)
const editingRevision = ref(0)
const formError = ref<string | null>(null)

const form = reactive({
  key: '',
  type: 'simple' as 'simple' | 'variable',
  titleVi: '',
  titleEn: '',
  slugVi: '',
  slugEn: '',
  summaryVi: '',
  summaryEn: '',
  descriptionVi: '',
  descriptionEn: '',
  thumbnail: '',
  gallery: '',
  basePrice: 0,
  salePrice: null as number | null,
  sku: '',
  uom: '',
  stock: 0,
  manageStock: true,
  categories: [] as string[],
  tags: '',
  variants: [] as AdminCatalogVariant[],
  attributes: [] as AdminCatalogAttribute[],
  seoTitle: '',
  seoDescription: '',
})

const emptyVariant = (): AdminCatalogVariant => ({
  sku: '',
  name: { vi: '' },
  basePrice: Number(form.basePrice) || 0,
  salePrice: null,
  stock: 0,
  manageStock: true,
  isActive: true,
  attributes: [],
})

function addVariant() {
  form.variants.push(emptyVariant())
}

function removeVariant(index: number) {
  form.variants.splice(index, 1)
}

function addAttribute() {
  form.attributes.push({ name: { vi: '' }, value: { vi: '' } })
}

function removeAttribute(index: number) {
  form.attributes.splice(index, 1)
}

function resetForm() {
  editingId.value = null
  editingRevision.value = 0
  formError.value = null
  Object.assign(form, {
    key: '',
    type: 'simple',
    titleVi: '',
    titleEn: '',
    slugVi: '',
    slugEn: '',
    summaryVi: '',
    summaryEn: '',
    descriptionVi: '',
    descriptionEn: '',
    thumbnail: '',
    gallery: '',
    basePrice: 0,
    salePrice: null,
    sku: '',
    uom: '',
    stock: 0,
    manageStock: true,
    categories: [],
    tags: '',
    variants: [],
    attributes: [],
    seoTitle: '',
    seoDescription: '',
  })
}

function openCreate() {
  resetForm()
  formOpen.value = true
}

function openEdit(item: AdminCatalogItem) {
  resetForm()
  editingId.value = item.id
  editingRevision.value = item.revision
  const categoryKeys = new Set(item.categories)
  Object.assign(form, {
    key: item.key,
    type: item.type,
    titleVi: item.title.vi ?? '',
    titleEn: item.title.en ?? '',
    slugVi: item.slug.vi ?? '',
    slugEn: item.slug.en ?? '',
    summaryVi: item.shortDesc.vi ?? '',
    summaryEn: item.shortDesc.en ?? '',
    descriptionVi: item.description.vi ?? '',
    descriptionEn: item.description.en ?? '',
    thumbnail: item.thumbnail ?? '',
    gallery: item.gallery.join('\n'),
    basePrice: item.basePrice,
    salePrice: item.salePrice,
    sku: item.sku,
    uom: item.uom,
    stock: item.stock,
    manageStock: item.manageStock,
    categories: categories.value.filter(category => categoryKeys.has(category.id)).map(category => category.key),
    tags: item.tags.join(', '),
    // Cloned, so cancelling an edit does not mutate the row still shown in the list.
    variants: JSON.parse(JSON.stringify(item.variants)) as AdminCatalogVariant[],
    attributes: JSON.parse(JSON.stringify(item.attributes)) as AdminCatalogAttribute[],
    seoTitle: item.seo.title.vi ?? '',
    seoDescription: item.seo.description.vi ?? '',
  })
  formOpen.value = true
}

function payload(): AdminCatalogItemDraft {
  return {
    key: form.key,
    type: form.type,
    title: { vi: form.titleVi, en: form.titleEn },
    slug: { vi: form.slugVi, en: form.slugEn },
    shortDesc: { vi: form.summaryVi, en: form.summaryEn },
    description: { vi: form.descriptionVi, en: form.descriptionEn },
    thumbnail: form.thumbnail.trim() || null,
    gallery: form.gallery.split('\n').map(line => line.trim()).filter(Boolean),
    basePrice: Number(form.basePrice) || 0,
    salePrice: form.salePrice === null ? null : Number(form.salePrice),
    sku: form.sku,
    uom: form.uom,
    stock: Number(form.stock) || 0,
    manageStock: form.manageStock,
    categories: form.categories,
    tags: form.tags.split(',').map(tag => tag.trim()).filter(Boolean),
    attributes: form.attributes
      .filter(attribute => (attribute.name.vi ?? '').trim() && (attribute.value.vi ?? '').trim())
      .map(attribute => ({ name: attribute.name, value: attribute.value })),
    variants: form.type === 'variable'
      ? form.variants.map(variant => ({
          ...variant,
          sku: variant.sku.trim(),
          name: variant.name,
          basePrice: Number(variant.basePrice) || 0,
          salePrice: variant.salePrice === null ? null : Number(variant.salePrice),
          stock: Number(variant.stock) || 0,
        }))
      : [],
    seo: {
      title: { vi: form.seoTitle },
      description: { vi: form.seoDescription },
      image: '',
    },
  }
}

async function save() {
  if (!canWrite.value || saving.value) return
  if (form.type === 'variable') {
    if (!form.variants.length) {
      formError.value = t('admin.catalog.errors.variantRequired')
      return
    }
    if (form.variants.some(variant => !variant.sku.trim())) {
      formError.value = t('admin.catalog.errors.variantSkuRequired')
      return
    }
  }
  saving.value = true
  formError.value = null
  try {
    if (editingId.value) {
      await update(editingId.value, { ...payload(), revision: editingRevision.value })
    } else {
      await create(payload())
    }
    toast.add({ title: t('admin.catalog.messages.saved'), color: 'success' })
    formOpen.value = false
    await Promise.all([load(), loadReferenceData()])
  } catch (caught) {
    formError.value = messageFor(errorCode(caught))
  } finally {
    saving.value = false
  }
}

async function act(item: AdminCatalogItem, event: AdminCatalogEvent) {
  if (!canWrite.value || busyId.value) return
  busyId.value = item.id
  try {
    await runEvent(item.id, event, item.revision)
    toast.add({ title: t(`admin.catalog.messages.${event}`), color: 'success' })
    await Promise.all([load(), loadReferenceData()])
  } catch (caught) {
    toast.add({ title: messageFor(errorCode(caught)), color: 'error' })
  } finally {
    busyId.value = null
  }
}

// ------------------------------------------------------------ category panel

const categoriesOpen = ref(false)
const categoryBusy = ref(false)
const categoryError = ref<string | null>(null)
const categoryEditing = ref<string | null>(null)
const categoryDraft = ref({
  key: '',
  title: '',
  parent: null as string | null,
  order: 0,
})

const parentItems = computed(() => [
  { label: t('admin.catalog.categories.noParent'), value: null },
  ...categories.value
    .filter(category => category.id !== categoryEditing.value)
    .map(category => ({ label: category.fullPath.vi || category.key, value: category.key })),
])

function resetCategoryForm() {
  categoryEditing.value = null
  categoryError.value = null
  Object.assign(categoryDraft.value, { key: '', title: '', parent: null, order: 0 })
}

function editCategory(category: AdminCatalogCategory) {
  categoryEditing.value = category.id
  categoryError.value = null
  Object.assign(categoryDraft.value, {
    key: category.key,
    title: category.title.vi ?? '',
    parent: category.parent ? categories.value.find(entry => entry.id === category.parent)?.key ?? null : null,
    order: category.order,
  })
}

async function saveCategory() {
  if (!canWrite.value || categoryBusy.value) return
  categoryBusy.value = true
  categoryError.value = null
  try {
    const draft = {
      key: categoryDraft.value.key,
      parent: categoryDraft.value.parent,
      order: Number(categoryDraft.value.order) || 0,
      title: { vi: categoryDraft.value.title },
      slug: { vi: categoryDraft.value.title },
      description: {},
      thumbnail: null,
    }
    if (categoryEditing.value) {
      const current = categories.value.find(category => category.id === categoryEditing.value)
      await updateCategory(categoryEditing.value, { ...draft, revision: current?.revision ?? 1 })
    } else {
      await createCategory(draft)
    }
    resetCategoryForm()
    await Promise.all([loadReferenceData(), load()])
  } catch (caught) {
    categoryError.value = messageFor(errorCode(caught))
  } finally {
    categoryBusy.value = false
  }
}

async function removeCategory(category: AdminCatalogCategory) {
  if (!canWrite.value || categoryBusy.value) return
  categoryBusy.value = true
  categoryError.value = null
  try {
    await deleteCategory(category.id, category.revision)
    if (categoryEditing.value === category.id) resetCategoryForm()
    await Promise.all([loadReferenceData(), load()])
  } catch (caught) {
    categoryError.value = messageFor(errorCode(caught))
  } finally {
    categoryBusy.value = false
  }
}
</script>

<template>
  <div>
    <CmsBasePage
      :title="t('admin.catalog.title')"
      :description="t('admin.catalog.description')"
      :loading="loading"
      :error="error"
      :empty="canRead && !loading && !entries.length"
      :empty-text="canRead ? t('admin.catalog.noItems') : t('admin.catalog.permissionDenied')"
      empty-icon="i-lucide-package"
    >
      <template #right>
        <UButton
          icon="i-lucide-layers"
          color="neutral"
          variant="ghost"
          size="sm"
          :label="t('admin.catalog.categories.title')"
          :disabled="!canRead"
          @click="categoriesOpen = true"
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

      <div class="mb-4 flex flex-wrap items-center gap-2">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          :placeholder="t('admin.catalog.filters.searchPlaceholder')"
          class="w-64"
        />
        <USelect v-model="status" :items="statusItems" value-key="value" class="w-44" />
        <USelect v-model="typeFilter" :items="typeItems" value-key="value" class="w-40" />
        <USelect v-model="tagFilter" :items="tagItems" value-key="value" class="w-48" />
        <UBadge color="neutral" variant="subtle" size="sm">
          {{ t('admin.catalog.stats.total', { count: counts.all ?? 0 }) }}
        </UBadge>
        <UBadge color="success" variant="subtle" size="sm">
          {{ t('admin.catalog.stats.published', { count: counts.published ?? 0 }) }}
        </UBadge>
      </div>

      <div class="space-y-2">
        <div
          v-for="item in entries"
          :key="item.id"
          class="flex flex-wrap items-center gap-3 rounded-lg border border-default px-3 py-3"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="truncate font-medium">{{ item.title.vi || item.key }}</span>
              <UBadge :color="statusColor(item.status)" variant="subtle" size="sm">
                {{ t(`admin.catalog.status.${item.status}`) }}
              </UBadge>
              <UBadge color="neutral" variant="subtle" size="sm">
                {{ t(`admin.catalog.type.${item.type}`) }}
              </UBadge>
            </div>
            <p class="mt-1 truncate text-xs text-muted">
              {{ item.key }} · {{ item.sku || t('admin.catalog.fields.noSku') }} ·
              {{ t('admin.catalog.fields.price', { price: item.basePrice.toLocaleString('vi-VN') }) }} ·
              {{ t('admin.catalog.fields.categoriesCount', { count: item.categories.length }) }}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-1">
            <UButton
              v-if="item.status !== 'published' && item.status !== 'deleted'"
              color="success"
              variant="ghost"
              size="xs"
              icon="i-lucide-upload"
              :label="t('admin.catalog.actions.publish')"
              :disabled="!canWrite || busyId === item.id"
              @click="act(item, 'publish')"
            />
            <UButton
              v-if="item.status === 'published'"
              color="warning"
              variant="ghost"
              size="xs"
              icon="i-lucide-archive"
              :label="t('admin.catalog.actions.archive')"
              :disabled="!canWrite || busyId === item.id"
              @click="act(item, 'archive')"
            />
            <UButton
              v-if="item.status === 'deleted'"
              color="success"
              variant="ghost"
              size="xs"
              icon="i-lucide-rotate-ccw"
              :label="t('admin.catalog.actions.restore')"
              :disabled="!canWrite || busyId === item.id"
              @click="act(item, 'restore')"
            />
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-pencil"
              :label="t('admin.catalog.actions.edit')"
              :disabled="!canWrite"
              @click="openEdit(item)"
            />
            <UButton
              v-if="item.status !== 'deleted'"
              color="error"
              variant="ghost"
              size="xs"
              icon="i-lucide-trash-2"
              :label="t('admin.catalog.actions.delete')"
              :disabled="!canWrite || busyId === item.id"
              @click="act(item, 'delete')"
            />
          </div>
        </div>
      </div>

      <UButton
        v-if="canWrite"
        class="mt-4"
        icon="i-lucide-plus"
        :label="t('admin.catalog.new')"
        @click="openCreate"
      />
    </CmsBasePage>

    <UModal v-model:open="formOpen" :title="editingId ? t('admin.catalog.edit') : t('admin.catalog.new')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-3xl' }">
      <template #body>
        <div class="space-y-4">
          <p v-if="formError" class="text-sm text-error">{{ formError }}</p>

          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.catalog.fields.key')">
              <UInput v-model="form.key" class="w-full" :disabled="Boolean(editingId)" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.type')">
              <USelect v-model="form.type" :items="typeItems.slice(1)" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.titleVi')">
              <UInput v-model="form.titleVi" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.titleEn')">
              <UInput v-model="form.titleEn" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.slugVi')">
              <UInput v-model="form.slugVi" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.slugEn')">
              <UInput v-model="form.slugEn" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.basePrice')">
              <UInput v-model.number="form.basePrice" type="number" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.salePrice')">
              <UInput v-model.number="form.salePrice" type="number" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.sku')">
              <UInput v-model="form.sku" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.uom')">
              <UInput v-model="form.uom" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.stock')">
              <UInput v-model.number="form.stock" type="number" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.manageStock')">
              <USwitch v-model="form.manageStock" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.variants')" class="sm:col-span-2">
              <div class="w-full space-y-2">
                <div
                  v-for="(variant, index) in form.variants"
                  :key="index"
                  class="grid gap-2 rounded-md border border-default p-2 sm:grid-cols-6"
                >
                  <UInput v-model="variant.sku" :placeholder="t('admin.catalog.fields.sku')" />
                  <UInput v-model="variant.name.vi" :placeholder="t('admin.catalog.fields.variantName')" />
                  <UInput v-model.number="variant.basePrice" type="number" :placeholder="t('admin.catalog.fields.basePrice')" />
                  <UInput v-model.number="variant.salePrice" type="number" :placeholder="t('admin.catalog.fields.salePrice')" />
                  <UInput v-model.number="variant.stock" type="number" :placeholder="t('admin.catalog.fields.stock')" />
                  <div class="flex items-center justify-between gap-2">
                    <USwitch v-model="variant.isActive" />
                    <UButton
                      icon="i-lucide-trash-2"
                      color="error"
                      variant="ghost"
                      size="xs"
                      :aria-label="t('admin.catalog.fields.removeVariant')"
                      @click="removeVariant(index)"
                    />
                  </div>
                </div>
                <p v-if="!form.variants.length" class="text-xs text-muted">
                  {{ t('admin.catalog.fields.variantsHint') }}
                </p>
                <UButton
                  size="xs"
                  variant="soft"
                  icon="i-lucide-plus"
                  :label="t('admin.catalog.fields.addVariant')"
                  @click="addVariant"
                />
              </div>
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.attributes')" class="sm:col-span-2">
              <div class="w-full space-y-2">
                <div
                  v-for="(attribute, index) in form.attributes"
                  :key="index"
                  class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                >
                  <UInput v-model="attribute.name.vi" :placeholder="t('admin.catalog.fields.attributeName')" />
                  <UInput v-model="attribute.value.vi" :placeholder="t('admin.catalog.fields.attributeValue')" />
                  <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    size="xs"
                    :aria-label="t('admin.catalog.fields.removeAttribute')"
                    @click="removeAttribute(index)"
                  />
                </div>
                <UButton
                  size="xs"
                  variant="soft"
                  icon="i-lucide-plus"
                  :label="t('admin.catalog.fields.addAttribute')"
                  @click="addAttribute"
                />
              </div>
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.categories')" class="sm:col-span-2">
              <USelectMenu v-model="form.categories" :items="categoryOptions" value-key="value" multiple class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.tags')" class="sm:col-span-2">
              <UInput v-model="form.tags" class="w-full" :placeholder="t('admin.catalog.fields.tagsHint')" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.summaryVi')" class="sm:col-span-2">
              <UTextarea v-model="form.summaryVi" :rows="2" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.descriptionVi')" class="sm:col-span-2">
              <UTextarea v-model="form.descriptionVi" :rows="4" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.thumbnail')" class="sm:col-span-2">
              <UInput v-model="form.thumbnail" class="w-full" placeholder="https://..." />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.gallery')" class="sm:col-span-2">
              <UTextarea v-model="form.gallery" :rows="3" class="w-full" :placeholder="t('admin.catalog.fields.galleryHint')" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.seoTitle')">
              <UInput v-model="form.seoTitle" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.catalog.fields.seoDescription')">
              <UInput v-model="form.seoDescription" class="w-full" />
            </UFormField>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :label="t('admin.catalog.cancel')"
            @click="formOpen = false"
          />
          <UButton :loading="saving" :disabled="!canWrite" :label="t('admin.catalog.save')" @click="save" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="categoriesOpen" :title="t('admin.catalog.categories.title')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-xl' }">
      <template #body>
        <div class="space-y-4">
          <p v-if="categoryError" class="text-sm text-error">{{ categoryError }}</p>

          <div class="grid gap-2">
            <div
              v-for="category in categories"
              :key="category.id"
              class="flex items-center gap-2 rounded-md border border-default px-2 py-2"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ category.title.vi || category.key }}</p>
                <p class="truncate text-xs text-muted">
                  {{ category.fullPath.vi }} · {{ t('admin.catalog.fields.categoriesCount', { count: category.itemCount }) }}
                </p>
              </div>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-pencil"
                :disabled="!canWrite"
                @click="editCategory(category)"
              />
              <UButton
                color="error"
                variant="ghost"
                size="xs"
                icon="i-lucide-trash-2"
                :disabled="!canWrite || categoryBusy"
                @click="removeCategory(category)"
              />
            </div>
            <p v-if="!categories.length" class="text-sm text-muted">{{ t('admin.catalog.categories.empty') }}</p>
          </div>

          <div class="grid gap-2 sm:grid-cols-2">
            <UFormField :label="t('admin.catalog.fields.key')">
              <UInput v-model="categoryDraft.key" class="w-full" :disabled="Boolean(categoryEditing)" />
            </UFormField>
            <UFormField :label="t('admin.catalog.categories.name')">
              <UInput v-model="categoryDraft.title" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.catalog.categories.parent')">
              <USelect v-model="categoryDraft.parent" :items="parentItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.catalog.categories.order')">
              <UInput v-model.number="categoryDraft.order" type="number" class="w-full" />
            </UFormField>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :label="t('admin.catalog.cancel')"
            @click="resetCategoryForm()"
          />
          <UButton
            :loading="categoryBusy"
            :disabled="!canWrite || !categoryDraft.key || !categoryDraft.title"
            :label="categoryEditing ? t('admin.catalog.save') : t('admin.catalog.categories.add')"
            @click="saveCategory"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
