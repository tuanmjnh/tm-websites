<script setup lang="ts">
import type { HubRoute } from '@tm/flow-contracts'

const { t, te } = useI18n()
const { hasCapability } = useHub()
const { fetchRoutes, describeError } = useHubAdmin()

const canRead = computed(() => hasCapability('routes.read'))

const loading = ref(false)
const error = ref<string | null>(null)
const routes = ref<HubRoute[]>([])
const filter = ref<'all' | 'visible' | 'hidden' | 'gated'>('all')

const filterItems = computed(() => [
  { label: t('admin.routes.filter.all'), value: 'all' },
  { label: t('admin.routes.filter.visible'), value: 'visible' },
  { label: t('admin.routes.filter.hidden'), value: 'hidden' },
  { label: t('admin.routes.filter.gated'), value: 'gated' },
])

const groupCount = computed(() => routes.value.filter(route => !route.parentId).length)

const visibleItems = computed(() => {
  const all = routes.value
  if (filter.value === 'visible') return all.filter(route => route.isVisible)
  if (filter.value === 'hidden') return all.filter(route => !route.isVisible)
  if (filter.value === 'gated') return all.filter(route => Boolean(route.requiredPermission))
  return all
})

const stats = computed(() => [
  { title: t('admin.routes.stats.total'), value: String(routes.value.length), icon: 'i-lucide-route' },
  { title: t('admin.routes.stats.visible'), value: String(routes.value.filter(route => route.isVisible).length), icon: 'i-lucide-eye' },
  { title: t('admin.routes.stats.gated'), value: String(routes.value.filter(route => Boolean(route.requiredPermission)).length), icon: 'i-lucide-lock' },
  { title: t('admin.routes.stats.groups'), value: String(groupCount.value), icon: 'i-lucide-folder-tree' },
])

const labelText = (label: string | null | undefined) => (label ? (te(label) ? t(label) : label) : '—')

async function load() {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const payload = await fetchRoutes({ limit: 100 })
    routes.value = payload.data.routes
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
    :title="t('admin.routes.title')"
    :description="t('admin.routes.description')"
    :loading="loading"
    :error="error"
    :empty="!canRead"
    :empty-text="t('admin.routes.permissionDenied')"
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
      <div class="mt-2 flex w-full flex-col gap-2 sm:flex-row sm:items-center">
        <USelect
          v-model="filter"
          :items="filterItems"
          value-key="value"
          class="w-full sm:w-48"
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
        <p class="mt-2 text-2xl font-bold tracking-tight text-highlighted">{{ stat.value }}</p>
      </BentoCard>

      <BentoCard
        :title="t('admin.routes.listTitle')"
        :description="t('admin.routes.listDescription')"
        icon="i-lucide-route"
        :col-span="4"
      >
        <p v-if="!visibleItems.length" class="py-8 text-center text-sm text-muted">
          {{ t('admin.routes.noEntries') }}
        </p>
        <div v-else class="mt-3 divide-y divide-default/40">
          <div
            v-for="route in visibleItems"
            :key="route.id"
            class="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-2 last:pb-1"
            :class="route.parentId ? 'pl-5' : ''"
          >
            <div class="flex min-w-0 items-start gap-2.5">
              <div class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm border border-default bg-elevated/50 text-muted">
                <UIcon :name="route.parentId ? 'i-lucide-route' : 'i-lucide-folder-tree'" class="size-3.5" />
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-medium text-highlighted">{{ labelText(route.label) }}</span>
                  <UBadge :color="route.isVisible ? 'success' : 'neutral'" variant="subtle" size="sm">
                    {{ route.isVisible ? t('admin.routes.visible') : t('admin.routes.hidden') }}
                  </UBadge>
                  <UBadge v-if="route.requiredPermission" color="warning" variant="subtle" size="sm">
                    {{ route.requiredPermission }}
                  </UBadge>
                  <span class="text-[11px] text-dimmed">#{{ route.sort }}</span>
                </div>
                <p class="mt-1 font-mono text-[11px] text-muted">{{ route.path || '—' }}</p>
              </div>
            </div>
            <span v-if="route.icon" class="shrink-0 font-mono text-[11px] text-dimmed">{{ route.icon }}</span>
          </div>
        </div>
      </BentoCard>
    </div>
  </CmsBasePage>
</template>
