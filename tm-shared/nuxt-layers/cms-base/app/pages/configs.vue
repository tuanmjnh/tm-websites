<script setup lang="ts">
import type { HubAppConfigMeta } from '@tm/flow-contracts'

const { t } = useI18n()
const { hasCapability } = useHub()
const { fetchConfigs, describeError } = useHubAdmin()

const canRead = computed(() => hasCapability('configs.read'))
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const configs = ref<Record<string, unknown>>({})
const meta = ref<HubAppConfigMeta[]>([])

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

async function load() {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const payload = await fetchConfigs({ limit: 100 })
    configs.value = payload.data
    meta.value = payload.meta
  } catch (e) {
    error.value = describeError(e)
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
        :title="t('admin.configs.listTitle')"
        :description="t('admin.configs.listDescription')"
        icon="i-lucide-key-round"
        :col-span="4"
      >
        <p v-if="!meta.length" class="py-8 text-center text-sm text-muted">
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
