<script setup lang="ts">
import type { HubConnectionProvider } from '@tm/flow-contracts'

const { t, locale } = useI18n()
const { hasCapability } = useHub()
const { fetchConnections, describeError } = useHubAdmin()

const canRead = computed(() => hasCapability('connections.read'))

const loading = ref(false)
const error = ref<string | null>(null)
const providers = ref<HubConnectionProvider[]>([])

const connectedCount = computed(() => providers.value.filter(provider => provider.connection).length)
const readyCount = computed(() => providers.value.filter(provider => provider.connection?.isEnabled).length)

const stats = computed(() => [
  { title: t('admin.connections.stats.providers'), value: String(providers.value.length), icon: 'i-lucide-plug' },
  { title: t('admin.connections.stats.connected'), value: String(connectedCount.value), icon: 'i-lucide-plug-zap' },
  { title: t('admin.connections.stats.enabled'), value: String(readyCount.value), icon: 'i-lucide-circle-check' },
  { title: t('admin.connections.stats.pending'), value: String(providers.value.length - connectedCount.value), icon: 'i-lucide-circle-dashed' },
])

const formatTime = (value: string | null | undefined) => (value ? new Date(value).toLocaleString(locale.value) : '—')

const statusColor = (provider: HubConnectionProvider) => {
  if (!provider.connection) return 'neutral'
  if (provider.connection.status === 'error' || provider.connection.lastTestOk === false) return 'error'
  if (provider.connection.isEnabled) return 'success'
  return 'warning'
}

const statusLabel = (provider: HubConnectionProvider) => {
  if (!provider.connection) return t('admin.connections.notConnected')
  if (provider.connection.status === 'error' || provider.connection.lastTestOk === false) return t('admin.connections.error')
  if (provider.connection.isEnabled) return t('admin.connections.connected')
  return t('admin.connections.disabled')
}

async function load() {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const payload = await fetchConnections()
    providers.value = payload.data
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
    :title="t('admin.connections.title')"
    :description="t('admin.connections.description')"
    :loading="loading"
    :error="error"
    :empty="!canRead"
    :empty-text="t('admin.connections.permissionDenied')"
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
        :title="t('admin.connections.listTitle')"
        :description="t('admin.connections.listDescription')"
        icon="i-lucide-cable"
        :col-span="4"
      >
        <p v-if="!providers.length" class="py-8 text-center text-sm text-muted">
          {{ t('admin.connections.noEntries') }}
        </p>
        <div v-else class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="provider in providers"
            :key="provider.key"
            class="flex flex-col gap-2 rounded-sm border border-default/50 bg-elevated/20 p-3"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-highlighted">{{ provider.name || provider.key }}</p>
                <p class="mt-0.5 font-mono text-[11px] text-dimmed">{{ provider.key }}</p>
              </div>
              <UBadge :color="statusColor(provider)" variant="subtle" size="sm" class="shrink-0">
                {{ statusLabel(provider) }}
              </UBadge>
            </div>
            <p class="line-clamp-2 text-xs text-muted">{{ provider.description || '—' }}</p>
            <div class="mt-auto flex flex-wrap items-center gap-1.5">
              <span v-if="provider.category" class="rounded-[4px] border border-default bg-elevated/30 px-1.5 py-0.5 text-[11px] capitalize text-muted">
                {{ provider.category }}
              </span>
              <span v-if="provider.connection?.environment" class="rounded-[4px] border border-default bg-elevated/30 px-1.5 py-0.5 text-[11px] text-muted">
                {{ provider.connection.environment }}
              </span>
              <span v-if="provider.connection" class="text-[11px] text-dimmed">
                {{ t('admin.connections.lastChecked') }}: {{ formatTime(provider.connection.lastTestAt) }}
              </span>
            </div>
          </div>
        </div>
      </BentoCard>
    </div>
  </CmsBasePage>
</template>
