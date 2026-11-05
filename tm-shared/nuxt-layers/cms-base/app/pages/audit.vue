<script setup lang="ts">
import type { HubAuditLog } from '@tm/flow-contracts'

const { t, locale } = useI18n()
const { hasCapability } = useHub()
const { fetchAuditLogs, describeError } = useHubAdmin()

const canRead = computed(() => hasCapability('apps.logs.read'))
const loading = ref(false)
const error = ref<string | null>(null)
const logs = ref<HubAuditLog[]>([])

const formatTime = (value: number) => new Date(value).toLocaleString(locale.value)

const actionColor = (action: string) => {
  const normalized = action.toLowerCase()
  if (normalized.includes('create') || normalized.includes('add')) return 'success'
  if (normalized.includes('delete') || normalized.includes('remove')) return 'error'
  if (normalized.includes('update') || normalized.includes('edit')) return 'info'
  return 'neutral'
}

const stats = computed(() => [
  { title: t('admin.audit.stats.total'), value: String(logs.value.length), icon: 'i-lucide-history', compact: false },
  {
    title: t('admin.audit.stats.actors'),
    value: String(new Set(logs.value.map(l => l.by?.email || l.by?.username || l.by?._id).filter(Boolean)).size),
    icon: 'i-lucide-users',
    compact: false,
  },
  {
    title: t('admin.audit.stats.models'),
    value: String(new Set(logs.value.map(l => l.modelName).filter(Boolean)).size),
    icon: 'i-lucide-layers',
    compact: false,
  },
  {
    title: t('admin.audit.stats.latest'),
    value: logs.value.length ? formatTime(logs.value[0]!.at) : '—',
    icon: 'i-lucide-clock',
    compact: true,
  },
])

async function load() {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const payload = await fetchAuditLogs({ limit: 50 })
    logs.value = payload.data
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
    :title="t('admin.audit.title')"
    :description="t('admin.audit.description')"
    :loading="loading"
    :error="error"
    :empty="!canRead"
    :empty-text="t('admin.audit.permissionDenied')"
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
        <p
          class="mt-2 font-bold tracking-tight text-highlighted"
          :class="stat.compact ? 'text-lg leading-snug' : 'truncate text-2xl'"
          :title="stat.value"
        >
          {{ stat.value }}
        </p>
      </BentoCard>

      <BentoCard
        :title="t('admin.audit.listTitle')"
        :description="t('admin.audit.listDescription')"
        icon="i-lucide-history"
        :col-span="4"
      >
        <p v-if="!logs.length" class="py-8 text-center text-sm text-muted">
          {{ t('admin.audit.noEntries') }}
        </p>
        <div v-else class="mt-3 divide-y divide-default/40">
          <div v-for="(log, index) in logs" :key="`${log.at}-${index}`" class="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-2 last:pb-1">
            <div class="flex min-w-0 items-start gap-2.5">
              <div class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm border border-default bg-elevated/50 text-muted">
                <UIcon name="i-lucide-clipboard-list" class="size-3.5" />
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge :color="actionColor(log.action)" variant="subtle" size="sm">
                    {{ log.action || t('admin.audit.unknownAction') }}
                  </UBadge>
                  <span class="text-sm font-medium text-highlighted">
                    {{ log.modelName || t('admin.audit.unknownModel') }}
                  </span>
                  <span v-if="log.summary" class="text-xs text-muted">
                    {{ log.summary }}
                  </span>
                </div>
                <p class="mt-1 text-xs text-muted">
                  {{ log.by?.name || log.by?.username || log.by?.email || t('admin.audit.systemActor') }}
                  <span v-if="log.source"> · {{ log.source }}</span>
                </p>
                <div v-if="log.changedFields?.length" class="mt-1.5 flex flex-wrap gap-1">
                  <span
                    v-for="field in log.changedFields"
                    :key="field"
                    class="inline-flex items-center rounded-[4px] border border-default bg-elevated/30 px-1.5 py-0.5 text-[11px] text-muted"
                  >
                    {{ field }}
                  </span>
                </div>
              </div>
            </div>
            <span class="shrink-0 text-xs text-muted">{{ formatTime(log.at) }}</span>
          </div>
        </div>
      </BentoCard>
    </div>
  </CmsBasePage>
</template>
