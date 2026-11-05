<script setup lang="ts">
import type { HubAppDetail } from '@tm/flow-contracts'

const { t, locale } = useI18n()
const { customer } = useCustomerConfig()
const { user, permissions, hasCapability } = useHub()
const { fetchAppDetail, describeError } = useHubAdmin()

const canReadApp = computed(() => hasCapability('apps.read'))
const app = ref<HubAppDetail | null>(null)
const loading = ref(false)
const appError = ref<string | null>(null)

const businessRows = computed(() => [
  { label: t('settings.business.customerId'), value: customer.value?.customerId || '—' },
  { label: t('settings.business.companyName'), value: customer.value?.companyName || '—' },
  { label: t('settings.business.cmsAppId'), value: customer.value?.cmsAppId || '—' },
  { label: t('settings.business.webAppId'), value: customer.value?.webAppId || '—' },
])

const sessionRows = computed(() => [
  { label: t('settings.session.user'), value: user.value?.name || '—' },
  { label: t('settings.session.email'), value: user.value?.email || '—' },
  { label: t('settings.session.tenantId'), value: user.value?.tenantId || '—' },
  { label: t('settings.session.roles'), value: (user.value?.roles || []).join(', ') || '—' },
])

const hubRows = computed(() => {
  if (!app.value) return []
  return [
    { label: t('settings.hub.name'), value: app.value.name },
    { label: t('settings.hub.appId'), value: app.value.id },
    {
      label: t('settings.hub.origins'),
      value: app.value.allowedOrigins.length ? app.value.allowedOrigins.join(', ') : t('settings.hub.none'),
    },
    { label: t('settings.hub.configs'), value: String(Object.keys(app.value.configs).length) },
    { label: t('settings.hub.updated'), value: formatDate(app.value.updatedAt) },
  ]
})

function formatDate(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(locale.value)
}

async function load() {
  if (!canReadApp.value) return
  loading.value = true
  appError.value = null
  try {
    app.value = await fetchAppDetail()
  } catch (e) {
    appError.value = describeError(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <CmsBasePage
    :title="t('settings.title')"
    :description="t('settings.description')"
  >
    <template #right>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="sm"
        :label="t('common.refresh')"
        :disabled="!canReadApp || loading"
        @click="load"
      />
    </template>

    <div class="bento-grid">
      <BentoCard
        :title="t('settings.business.title')"
        icon="i-lucide-building-2"
        :col-span="2"
      >
        <div class="mt-3 divide-y divide-default/40">
          <div v-for="row in businessRows" :key="row.label" class="flex items-center justify-between gap-3 py-2.5 text-xs">
            <span class="text-muted">{{ row.label }}</span>
            <span class="truncate font-medium text-highlighted">{{ row.value }}</span>
          </div>
        </div>
      </BentoCard>

      <BentoCard
        :title="t('settings.session.title')"
        icon="i-lucide-shield-check"
        :col-span="2"
      >
        <div class="mt-3 divide-y divide-default/40">
          <div v-for="row in sessionRows" :key="row.label" class="flex items-center justify-between gap-3 py-2.5 text-xs">
            <span class="text-muted">{{ row.label }}</span>
            <span class="truncate font-medium text-highlighted">{{ row.value }}</span>
          </div>
        </div>
      </BentoCard>

      <BentoCard
        :title="t('settings.hub.title')"
        :description="t('settings.hub.description')"
        icon="i-lucide-server"
        :col-span="2"
      >
        <p v-if="!canReadApp" class="mt-3 text-xs text-muted">
          {{ t('settings.hub.permissionDenied') }}
        </p>
        <div v-else-if="loading" class="mt-3 space-y-2">
          <div v-for="i in 4" :key="i" class="h-6 animate-pulse rounded-sm bg-muted/20" />
        </div>
        <div v-else-if="appError" class="mt-3 text-xs text-error">
          <p>{{ t('settings.hub.unavailable') }}</p>
          <p class="mt-1 text-muted">{{ appError }}</p>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="soft"
            size="sm"
            :label="t('common.refresh')"
            class="mt-3"
            @click="load"
          />
        </div>
        <div v-else class="mt-3 divide-y divide-default/40">
          <div class="flex items-center justify-between gap-3 py-2.5 text-xs">
            <span class="text-muted">{{ t('settings.hub.status') }}</span>
            <UBadge :color="app?.isActive ? 'success' : 'error'" variant="subtle" size="sm">
              {{ app?.isActive ? t('settings.hub.active') : t('settings.hub.inactive') }}
            </UBadge>
          </div>
          <div v-for="row in hubRows" :key="row.label" class="flex items-center justify-between gap-3 py-2.5 text-xs">
            <span class="text-muted">{{ row.label }}</span>
            <span class="truncate font-medium text-highlighted">{{ row.value }}</span>
          </div>
        </div>
      </BentoCard>

      <BentoCard
        :title="t('settings.session.capabilities')"
        :description="t('settings.session.capabilitiesDescription')"
        icon="i-lucide-key-round"
        :col-span="2"
      >
        <div class="mt-3 flex max-h-[180px] flex-wrap gap-1.5 overflow-y-auto scroll-thin pr-1">
          <span
            v-for="capability in permissions"
            :key="capability"
            class="inline-flex items-center gap-1 rounded-[4px] border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
          >
            {{ capability }}
          </span>
          <span v-if="!permissions.length" class="text-xs text-muted">
            {{ t('common.noData') }}
          </span>
        </div>
      </BentoCard>

      <BentoCard
        :title="t('settings.entitlements.title')"
        :description="t('settings.entitlements.description')"
        icon="i-lucide-shield-check"
        :col-span="4"
      >
        <div class="mt-3 flex flex-wrap gap-2">
          <span
            v-for="(isOn, mod) in customer?.entitlements"
            :key="mod"
            class="inline-flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1 text-xs font-medium"
            :class="[
              isOn
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-default bg-elevated/30 text-muted opacity-50'
            ]"
          >
            <span :class="[isOn ? 'i-lucide-check-circle-2' : 'i-lucide-circle-slash', 'size-3.5']" />
            <span class="capitalize">{{ mod }}</span>
          </span>
        </div>
      </BentoCard>
    </div>
  </CmsBasePage>
</template>
