<script setup lang="ts">
import type { AdminSiteSettings, AdminSiteSettingsPatch } from '@tm/flow-contracts/settings-admin'
import { SETTINGS_LOCALES, SITE_MODULES } from '@tm/flow-contracts/settings-admin'
import type { AdminMedia } from '@tm/flow-contracts/media-admin'
import type { HubAppConfigMeta } from '@tm/flow-contracts'
import { applySeoTitleTemplate } from '@tm/flow-utils/seo'

const { t } = useI18n()
const { hasCapability } = useHub()
const { fetchConfigs, describeError } = useHubAdmin()

const canRead = computed(() => hasCapability('configs.read'))
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const configs = ref<Record<string, unknown>>({})
const meta = ref<HubAppConfigMeta[]>([])

const canWrite = computed(() => hasCapability('configs.write'))
const { fetchSettings, saveSettings, describeError: describeSettingsError } = useSettingsAdmin()

const form = reactive({
  revision: 0,
  companyName: '',
  legalName: '',
  taxId: '',
  email: '',
  phone: '',
  address: '',
  logoMediaId: '',
  titleTemplate: '%s',
  defaultDescription: '',
  defaultImageMediaId: '',
  defaultLocale: 'vi' as (typeof SETTINGS_LOCALES)[number],
  enabled: ['vi'] as Array<(typeof SETTINGS_LOCALES)[number]>,
  modules: { content: true, catalog: false, orders: false, inventory: false } as Record<string, boolean>,
})
const settingsLoaded = ref(false)
const saving = ref(false)
const settingsMessage = ref<string | null>(null)

const localeItems = computed(() => SETTINGS_LOCALES.map(value => ({ label: value.toUpperCase(), value })))

// The template is only meaningful once an editor sees a page rendered through it,
// so the field previews a sample page title with the value being typed.
const titlePreview = computed(() => applySeoTitleTemplate(t('admin.configs.site.titleSample'), form.titleTemplate))

function applySettings(settings: AdminSiteSettings) {
  form.revision = settings.revision
  form.companyName = settings.company.name
  form.legalName = settings.company.legalName
  form.taxId = settings.company.taxId
  form.email = settings.company.email
  form.phone = settings.company.phone
  form.address = settings.company.address
  form.logoMediaId = settings.company.logoMediaId
  form.titleTemplate = settings.seo.titleTemplate
  form.defaultDescription = settings.seo.defaultDescription
  form.defaultImageMediaId = settings.seo.defaultImageMediaId
  form.defaultLocale = settings.locales.default
  form.enabled = [...settings.locales.enabled]
  form.modules = { ...settings.modules }
  settingsLoaded.value = true
}

const { list: listMedia } = useMediaAdmin()
const mediaCache = ref<Record<string, AdminMedia>>({})
const picker = reactive({
  open: false,
  target: 'logo' as 'logo' | 'seoImage',
  loading: false,
  error: null as string | null,
  search: '',
  items: [] as AdminMedia[],
})

function mediaLabel(id: string): string {
  if (!id) return t('admin.configs.site.noMedia')
  const item = mediaCache.value[id]
  return item ? (item.title || item.originalName) : id
}

async function loadPicker() {
  picker.loading = true
  picker.error = null
  try {
    const result = await listMedia({ kind: 'image', limit: 50, ...(picker.search.trim() ? { q: picker.search.trim() } : {}) })
    picker.items = result.data
    for (const item of result.data) mediaCache.value[item.id] = item
  } catch (error) {
    picker.error = describeError(error)
  } finally {
    picker.loading = false
  }
}

function openPicker(target: 'logo' | 'seoImage') {
  picker.target = target
  picker.open = true
  picker.items = []
  void loadPicker()
}

function chooseMedia(item: AdminMedia) {
  if (picker.target === 'logo') form.logoMediaId = item.id
  else form.defaultImageMediaId = item.id
  picker.open = false
}

function toggleLocale(locale: (typeof SETTINGS_LOCALES)[number], enabled: boolean) {
  form.enabled = enabled
    ? SETTINGS_LOCALES.filter(item => item === locale || form.enabled.includes(item))
    : form.enabled.filter(item => item !== locale)
}

async function saveSite() {
  if (!canWrite.value) return
  saving.value = true
  settingsMessage.value = null
  const patch: AdminSiteSettingsPatch = {
    revision: form.revision,
    company: {
      name: form.companyName,
      legalName: form.legalName,
      taxId: form.taxId,
      email: form.email,
      phone: form.phone,
      address: form.address,
      logoMediaId: form.logoMediaId,
    },
    seo: {
      titleTemplate: form.titleTemplate,
      defaultDescription: form.defaultDescription,
      defaultImageMediaId: form.defaultImageMediaId,
    },
    locales: { default: form.defaultLocale, enabled: [...form.enabled] },
    modules: { ...form.modules },
  }
  try {
    const saved = await saveSettings(patch)
    applySettings(saved.settings)
    // The save is committed either way; only the storefront refresh can fail, and
    // then the site picks the change up on its own cache window.
    settingsMessage.value = saved.revalidateFailed
      ? t('admin.configs.site.savedNotRevalidated')
      : t('admin.configs.site.saved')
  } catch (error) {
    settingsMessage.value = t(`admin.configs.site.errors.${describeSettingsError(error)}`)
  } finally {
    saving.value = false
  }
}

const entries = computed(() => {
  const term = search.value.trim().toLowerCase()
  return meta.value
    .filter(entry => !term
      || entry.key.toLowerCase().includes(term)
      || (entry.description || '').toLowerCase().includes(term)
      || (entry.category || '').toLowerCase().includes(term))
    .map(entry => ({ ...entry, value: configs.value[entry.key] }))
})

const formatValue = (value: unknown) => {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const stats = computed(() => [
  { title: t('admin.configs.stats.total'), value: String(meta.value.length), icon: 'i-lucide-settings' },
  { title: t('admin.configs.stats.public'), value: String(meta.value.filter(c => c.isPublic).length), icon: 'i-lucide-eye' },
  { title: t('admin.configs.stats.secret'), value: String(meta.value.filter(c => c.isSecret).length), icon: 'i-lucide-lock' },
  {
    title: t('admin.configs.stats.categories'),
    value: String(new Set(meta.value.map(c => c.category).filter(Boolean)).size),
    icon: 'i-lucide-folder-tree',
  },
])

const configsError = ref<string | null>(null)

async function load() {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  configsError.value = null
  try {
    const payload = await fetchConfigs({ limit: 100 })
    configs.value = payload.data
    meta.value = payload.meta
  } catch (e) {
    // Hub's config registry is a separate surface: a Hub outage must not hide
    // the site settings this page can still read and save.
    configsError.value = describeError(e)
  }

  try {
    applySettings(await fetchSettings())
  } catch (e) {
    error.value = t(`admin.configs.site.errors.${describeSettingsError(e)}`)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <CmsBasePage
    :title="t('admin.configs.title')"
    :description="t('admin.configs.description')"
    :loading="loading"
    :error="error"
    :empty="!canRead"
    :empty-text="t('admin.configs.permissionDenied')"
    empty-icon="i-lucide-shield-off"
  >
    <template #right>
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

    <template #toolbar>
      <UInput
        v-model="search"
        icon="i-lucide-search"
        :placeholder="t('admin.configs.search')"
        class="w-full sm:max-w-xs"
      />
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
        :title="t('admin.configs.site.title')"
        :description="t('admin.configs.site.description')"
        icon="i-lucide-building-2"
        :col-span="4"
      >
        <div v-if="settingsLoaded" class="mt-3 space-y-4">
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <UFormField :label="t('admin.configs.site.fields.name')">
              <UInput v-model="form.companyName" size="sm" :disabled="!canWrite" :maxlength="120" />
            </UFormField>
            <UFormField :label="t('admin.configs.site.fields.legalName')">
              <UInput v-model="form.legalName" size="sm" :disabled="!canWrite" :maxlength="160" />
            </UFormField>
            <UFormField :label="t('admin.configs.site.fields.taxId')">
              <UInput v-model="form.taxId" size="sm" :disabled="!canWrite" :maxlength="40" />
            </UFormField>
            <UFormField :label="t('admin.configs.site.fields.email')">
              <UInput v-model="form.email" type="email" size="sm" :disabled="!canWrite" :maxlength="160" />
            </UFormField>
            <UFormField :label="t('admin.configs.site.fields.phone')">
              <UInput v-model="form.phone" size="sm" :disabled="!canWrite" :maxlength="40" />
            </UFormField>
            <UFormField :label="t('admin.configs.site.fields.address')">
              <UInput v-model="form.address" size="sm" :disabled="!canWrite" :maxlength="200" />
            </UFormField>
            <UFormField :label="t('admin.configs.site.fields.titleTemplate')">
              <UInput v-model="form.titleTemplate" size="sm" :disabled="!canWrite" :maxlength="160" />
              <p class="mt-1 text-[11px] text-muted">
                {{ t('admin.configs.site.titlePreview', { title: titlePreview }) }}
              </p>
            </UFormField>
            <UFormField :label="t('admin.configs.site.fields.defaultDescription')" class="sm:col-span-2">
              <UInput v-model="form.defaultDescription" size="sm" :disabled="!canWrite" :maxlength="300" />
            </UFormField>
            <UFormField :label="t('admin.configs.site.fields.logo')">
              <div class="flex items-center gap-2">
                <UInput :model-value="mediaLabel(form.logoMediaId)" readonly size="sm" class="min-w-0 flex-1" />
                <UButton size="sm" color="neutral" variant="soft" :label="t('admin.configs.site.choose')" :disabled="!canWrite" @click="openPicker('logo')" />
                <UButton v-if="form.logoMediaId" size="sm" color="neutral" variant="ghost" icon="i-lucide-x" :disabled="!canWrite" :aria-label="t('admin.configs.site.clear')" @click="form.logoMediaId = ''" />
              </div>
            </UFormField>
            <UFormField :label="t('admin.configs.site.fields.seoImage')">
              <div class="flex items-center gap-2">
                <UInput :model-value="mediaLabel(form.defaultImageMediaId)" readonly size="sm" class="min-w-0 flex-1" />
                <UButton size="sm" color="neutral" variant="soft" :label="t('admin.configs.site.choose')" :disabled="!canWrite" @click="openPicker('seoImage')" />
                <UButton v-if="form.defaultImageMediaId" size="sm" color="neutral" variant="ghost" icon="i-lucide-x" :disabled="!canWrite" :aria-label="t('admin.configs.site.clear')" @click="form.defaultImageMediaId = ''" />
              </div>
            </UFormField>
          </div>

          <div class="flex flex-wrap items-end gap-4 border-t border-default/40 pt-3">
            <UFormField :label="t('admin.configs.site.fields.defaultLocale')">
              <USelect
                v-model="form.defaultLocale"
                :items="localeItems"
                value-key="value"
                size="sm"
                class="w-28"
                :disabled="!canWrite"
              />
            </UFormField>
            <div class="flex flex-wrap items-center gap-3">
              <span class="text-xs font-medium text-muted">{{ t('admin.configs.site.fields.enabledLocales') }}</span>
              <UCheckbox
                v-for="locale in SETTINGS_LOCALES"
                :key="locale"
                :model-value="form.enabled.includes(locale)"
                :label="locale.toUpperCase()"
                :disabled="!canWrite || form.defaultLocale === locale"
                @update:model-value="(value: boolean | 'indeterminate') => toggleLocale(locale, value === true)"
              />
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-5 border-t border-default/40 pt-3">
            <span class="text-xs font-medium text-muted">{{ t('admin.configs.site.fields.modules') }}</span>
            <USwitch
              v-for="module in SITE_MODULES"
              :key="module"
              v-model="form.modules[module]"
              :label="t(`admin.configs.site.modules.${module}`)"
              :disabled="!canWrite"
            />
          </div>

          <div class="flex flex-wrap items-center gap-3 border-t border-default/40 pt-3">
            <UButton
              size="sm"
              :loading="saving"
              :disabled="!canWrite"
              :label="t('admin.configs.site.save')"
              @click="saveSite"
            />
            <span v-if="settingsMessage" class="text-xs text-muted">{{ settingsMessage }}</span>
            <span class="ml-auto text-[11px] text-muted">
              {{ t('admin.configs.site.revision', { revision: form.revision }) }}
            </span>
          </div>
          <p v-if="!canWrite" class="text-xs text-muted">{{ t('admin.configs.site.readOnly') }}</p>
        </div>
      </BentoCard>

      <UModal v-model:open="picker.open" :title="t('admin.configs.site.pickMedia')">
        <template #body>
          <div class="flex flex-col gap-3">
            <UInput
              v-model="picker.search"
              icon="i-lucide-search"
              size="sm"
              :placeholder="t('admin.configs.site.pickMediaSearch')"
              @keydown.enter="loadPicker"
            />
            <p v-if="picker.error" class="text-sm text-error">{{ picker.error }}</p>
            <p v-else-if="!picker.loading && !picker.items.length" class="py-6 text-center text-sm text-muted">
              {{ t('admin.configs.site.pickMediaEmpty') }}
            </p>
            <div v-else class="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              <button
                v-for="item in picker.items"
                :key="item.id"
                type="button"
                class="flex flex-col gap-1 rounded-md border border-default p-2 text-left hover:border-primary/60"
                @click="chooseMedia(item)"
              >
                <img v-if="item.kind === 'image'" :src="item.url" :alt="item.alt || item.title" class="h-24 w-full rounded-sm object-cover">
                <span class="truncate text-xs font-medium text-highlighted">{{ item.title || item.originalName }}</span>
                <span class="truncate text-[11px] text-muted">{{ item.folder || t('admin.media.root') }}</span>
              </button>
            </div>
            <div class="flex justify-end">
              <UButton color="neutral" variant="soft" size="sm" :label="t('common.cancel')" @click="picker.open = false" />
            </div>
          </div>
        </template>
      </UModal>

      <BentoCard
        :title="t('admin.configs.listTitle')"
        :description="t('admin.configs.listDescription')"
        icon="i-lucide-key-round"
        :col-span="4"
      >
        <p v-if="configsError" class="py-8 text-center text-sm text-error">
          {{ configsError }}
        </p>
        <p v-else-if="!meta.length" class="py-8 text-center text-sm text-muted">
          {{ t('admin.configs.noEntries') }}
        </p>
        <p v-else-if="!entries.length" class="py-8 text-center text-sm text-muted">
          {{ t('admin.configs.noResults') }}
        </p>
        <div v-else class="mt-3 divide-y divide-default/40">
          <div v-for="entry in entries" :key="entry.key" class="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-2 last:pb-1">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-mono text-sm font-semibold text-highlighted">
                  {{ entry.key }}
                </p>
                <UBadge v-if="entry.isPublic" color="success" variant="subtle" size="sm">
                  {{ t('admin.configs.public') }}
                </UBadge>
                <UBadge v-if="entry.isSecret" color="warning" variant="subtle" size="sm">
                  {{ t('admin.configs.secret') }}
                </UBadge>
                <UBadge v-if="entry.category" color="neutral" variant="subtle" size="sm">
                  {{ entry.category }}
                </UBadge>
              </div>
              <p v-if="entry.description" class="mt-1 text-xs text-muted">
                {{ entry.description }}
              </p>
              <p class="mt-1.5 truncate font-mono text-xs text-dimmed" :title="formatValue(entry.value)">
                {{ formatValue(entry.value) }}
              </p>
            </div>
            <span v-if="entry.updatedAt" class="shrink-0 text-xs text-muted">
              {{ new Date(entry.updatedAt).toLocaleDateString() }}
            </span>
          </div>
        </div>
      </BentoCard>
    </div>
  </CmsBasePage>
</template>
