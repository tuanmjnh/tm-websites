<script setup lang="ts">
import type { HubMailAnalyticsSummary, HubMailTemplate } from '@tm/flow-contracts'

const { t, locale } = useI18n()
const { hasCapability } = useHub()
const { fetchMailAnalyticsSummary, fetchMailTemplates, fetchMailQueue, describeError } = useHubAdmin()

const canViewTemplates = computed(() => hasCapability('mail.manage'))
const canReadAnalytics = computed(() => hasCapability('mail.analytics.read'))
const canReadQueue = computed(() => hasCapability('mail.send'))
const canView = computed(() => canViewTemplates.value || canReadAnalytics.value || canReadQueue.value)

const loading = ref(false)
const error = ref<string | null>(null)
const summaryError = ref<string | null>(null)
const queueError = ref<string | null>(null)

const templates = ref<HubMailTemplate[]>([])
const templateTotal = ref(0)
const summary = ref<HubMailAnalyticsSummary | null>(null)
const queue = ref<{ enabled: boolean, stats: Record<string, unknown> | null, jobs: number } | null>(null)
const statusFilter = ref<'all' | 'draft' | 'published' | 'archived'>('all')

const statusItems = computed(() => [
  { label: t('admin.mail.filter.all'), value: 'all' },
  { label: t('admin.mail.status.draft'), value: 'draft' },
  { label: t('admin.mail.status.published'), value: 'published' },
  { label: t('admin.mail.status.archived'), value: 'archived' },
])

const formatTime = (value: string | null | undefined) => (value ? new Date(value).toLocaleString(locale.value) : '—')

const percent = (value: number) => `${(value * 100).toFixed(1)}%`

const statusColor = (status: string) => {
  if (status === 'published') return 'success'
  if (status === 'archived') return 'neutral'
  return 'warning'
}

const TEMPLATE_STATUSES = ['draft', 'published', 'archived']
const statusLabel = (status: string) =>
  TEMPLATE_STATUSES.includes(status) ? t(`admin.mail.status.${status}`) : status

const stats = computed(() => [
  { title: t('admin.mail.stats.sent'), value: summary.value ? String(summary.value.totalSent) : '—', icon: 'i-lucide-send' },
  { title: t('admin.mail.stats.delivered'), value: summary.value ? String(summary.value.totalDelivered) : '—', icon: 'i-lucide-mail-check' },
  { title: t('admin.mail.stats.opened'), value: summary.value ? String(summary.value.totalOpened) : '—', icon: 'i-lucide-eye' },
  { title: t('admin.mail.stats.clicked'), value: summary.value ? String(summary.value.totalClicked) : '—', icon: 'i-lucide-mouse-pointer-click' },
])

const rates = computed(() => {
  if (!summary.value) return []
  return [
    { label: t('admin.mail.rates.delivery'), value: percent(summary.value.deliveryRate) },
    { label: t('admin.mail.rates.open'), value: percent(summary.value.openRate) },
    { label: t('admin.mail.rates.click'), value: percent(summary.value.clickRate) },
    { label: t('admin.mail.rates.bounce'), value: percent(summary.value.bounceRate) },
  ]
})

const queueEntries = computed(() => {
  if (!queue.value?.stats) return []
  return Object.entries(queue.value.stats)
    .filter(([, value]) => typeof value === 'number')
    .map(([label, value]) => ({ label, value: String(value) }))
})

async function load() {
  if (!canView.value) return
  loading.value = true
  error.value = null
  summaryError.value = null
  queueError.value = null

  if (canViewTemplates.value) {
    try {
      const payload = await fetchMailTemplates({
        status: statusFilter.value === 'all' ? undefined : statusFilter.value,
        limit: 30,
      })
      templates.value = payload.data
      templateTotal.value = payload.pagination?.total ?? payload.data.length
    } catch (e) {
      error.value = describeError(e)
    }
  }
  loading.value = false

  if (canReadAnalytics.value) {
    try {
      summary.value = await fetchMailAnalyticsSummary()
    } catch (e) {
      summary.value = null
      summaryError.value = describeError(e)
    }
  }

  if (canReadQueue.value) {
    try {
      const payload = await fetchMailQueue()
      queue.value = { enabled: payload.enabled, stats: payload.stats ?? null, jobs: payload.jobs.length }
    } catch (e) {
      queue.value = null
      queueError.value = describeError(e)
    }
  }
}

watch(statusFilter, () => load())

onMounted(load)
</script>

<template>
  <CmsBasePage
    :title="t('admin.mail.title')"
    :description="t('admin.mail.description')"
    :loading="loading"
    :error="error"
    :empty="!canView"
    :empty-text="t('admin.mail.permissionDenied')"
    empty-icon="i-lucide-shield-off"
  >
    <template #right>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="sm"
        :label="t('common.refresh')"
        :disabled="!canView || loading"
        @click="load"
      />
    </template>

    <template #toolbar>
      <div class="mt-2 flex w-full flex-col gap-2 sm:flex-row sm:items-center">
        <USelect
          v-model="statusFilter"
          :items="statusItems"
          value-key="value"
          class="w-full sm:w-48"
          :disabled="!canViewTemplates"
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
        :title="t('admin.mail.rates.title')"
        :description="t('admin.mail.rates.description')"
        icon="i-lucide-trending-up"
        :col-span="4"
      >
        <p v-if="!canReadAnalytics" class="mt-3 text-xs text-muted">
          {{ t('admin.mail.permissionDeniedAnalytics') }}
        </p>
        <p v-else-if="summaryError" class="mt-3 text-xs text-error">{{ summaryError }}</p>
        <div v-else class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div v-for="rate in rates" :key="rate.label" class="rounded-sm border border-default/50 bg-elevated/20 p-3">
            <p class="text-[11px] uppercase tracking-wide text-muted">{{ rate.label }}</p>
            <p class="mt-1 text-lg font-semibold text-highlighted">{{ rate.value }}</p>
          </div>
          <p v-if="!rates.length" class="text-sm text-muted">{{ t('common.noData') }}</p>
        </div>
      </BentoCard>

      <BentoCard
        :title="t('admin.mail.queue.title')"
        :description="t('admin.mail.queue.description')"
        icon="i-lucide-list-checks"
        :col-span="2"
      >
        <p v-if="!canReadQueue" class="mt-3 text-xs text-muted">
          {{ t('admin.mail.permissionDeniedQueue') }}
        </p>
        <p v-else-if="queueError" class="mt-3 text-xs text-error">{{ queueError }}</p>
        <template v-else-if="queue">
          <div class="mt-3 flex items-center gap-2">
            <UBadge :color="queue.enabled ? 'success' : 'neutral'" variant="subtle" size="sm">
              {{ queue.enabled ? t('admin.mail.queue.enabled') : t('admin.mail.queue.disabled') }}
            </UBadge>
            <span class="text-xs text-muted">
              {{ t('admin.mail.queue.jobs', { n: queue.jobs }) }}
            </span>
          </div>
          <div v-if="queueEntries.length" class="mt-3 flex flex-wrap gap-1.5">
            <span
              v-for="entry in queueEntries"
              :key="entry.label"
              class="inline-flex items-center gap-1 rounded-[4px] border border-default bg-elevated/30 px-2 py-0.5 text-[11px] text-muted"
            >
              <span class="capitalize">{{ entry.label }}</span>
              <span class="font-medium text-highlighted">{{ entry.value }}</span>
            </span>
          </div>
        </template>
      </BentoCard>

      <BentoCard
        :title="t('admin.mail.templatesTitle')"
        :description="t('admin.mail.templatesDescription', { n: templateTotal })"
        icon="i-lucide-files"
        :col-span="4"
      >
        <p v-if="!canViewTemplates" class="mt-3 text-xs text-muted">
          {{ t('admin.mail.permissionDeniedTemplates') }}
        </p>
        <p v-else-if="!templates.length" class="py-8 text-center text-sm text-muted">
          {{ t('admin.mail.noTemplates') }}
        </p>
        <div v-else class="mt-3 divide-y divide-default/40">
          <div
            v-for="template in templates"
            :key="template.id"
            class="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-2 last:pb-1"
          >
            <div class="flex min-w-0 items-start gap-2.5">
              <div class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm border border-default bg-elevated/50 text-muted">
                <UIcon name="i-lucide-mail" class="size-3.5" />
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-medium text-highlighted">{{ template.name || template.key }}</span>
                  <UBadge :color="statusColor(template.status)" variant="subtle" size="sm">
                    {{ statusLabel(template.status) }}
                  </UBadge>
                  <span class="rounded-[4px] border border-default bg-elevated/30 px-1.5 py-0.5 text-[11px] text-muted">
                    {{ template.locale }}
                  </span>
                  <span class="text-[11px] text-dimmed">v{{ template.version }}</span>
                </div>
                <p class="mt-1 truncate text-xs text-muted">{{ template.subject || '—' }}</p>
                <p class="mt-1 font-mono text-[11px] text-dimmed">{{ template.key }}</p>
              </div>
            </div>
            <span class="shrink-0 text-xs text-muted">{{ formatTime(template.updatedAt) }}</span>
          </div>
        </div>
      </BentoCard>
    </div>
  </CmsBasePage>
</template>
