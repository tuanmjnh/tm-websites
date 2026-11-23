<script setup lang="ts">
import type { HubAppDetail, HubAuditLog, HubRole, HubUserSummary } from '@tm/flow-contracts'
import type { AdminDashboardSummary } from '@tm/flow-contracts/dashboard-admin'

const { t, locale } = useI18n()
const { customer, isModuleEnabled } = useCustomerConfig()
const { user, hasCapability, permissions } = useHub()
const { fetchAppDetail, fetchUsers, fetchRoles, fetchAuditLogs, describeError } = useHubAdmin()
const { fetchSummary } = useDashboardAdmin()

const loading = ref(false)
const error = ref<string | null>(null)
const appDetail = ref<HubAppDetail | null>(null)
const members = ref<HubUserSummary[]>([])
const roles = ref<HubRole[]>([])
const activity = ref<HubAuditLog[]>([])

const canReadApp = computed(() => hasCapability('apps.read'))
const canReadUsers = computed(() => hasCapability('users.read'))
const canReadRoles = computed(() => hasCapability('roles.read'))
const canReadLogs = computed(() => hasCapability('apps.logs.read'))

const licensedModules = computed(() => (['catalog', 'orders', 'inventory', 'finance', 'reports', 'media', 'aiWorkspace'] as const)
  .filter(module => isModuleEnabled(module)))

const stats = computed(() => [
  {
    title: t('dashboard.stats.installation'),
    value: canReadApp.value ? (appDetail.value ? (appDetail.value.isActive ? t('dashboard.active') : t('dashboard.suspended')) : '—') : t('dashboard.restricted'),
    icon: 'i-lucide-server',
  },
  {
    title: t('dashboard.stats.members'),
    value: canReadUsers.value ? String(members.value.length) : t('dashboard.restricted'),
    icon: 'i-lucide-users',
  },
  {
    title: t('dashboard.stats.roles'),
    value: canReadRoles.value ? String(roles.value.length) : t('dashboard.restricted'),
    icon: 'i-lucide-shield-check',
  },
  {
    title: t('dashboard.stats.modules'),
    value: String(licensedModules.value.length),
    icon: 'i-lucide-blocks',
  },
])

const formatTime = (value: number) => new Date(value).toLocaleString(locale.value)

// Business counts come from the site's own collections, not from Hub, so they
// load only when the account may read them and the module is licensed.
const canReadBusiness = computed(() => hasCapability('content.read'))
const businessSummary = ref<AdminDashboardSummary | null>(null)
const businessError = ref<string | null>(null)

const businessCards = computed(() => {
  const data = businessSummary.value
  if (!data) return []
  const cards: Array<{
    key: string
    label: string
    value: number
    hint: string
    icon: string
    to: string
    alert: boolean
    module: 'catalog' | 'orders' | 'inventory' | null
  }> = [
    {
      key: 'content',
      label: t('dashboard.business.content'),
      value: data.content.published,
      hint: t('dashboard.business.contentHint', { draft: data.content.draft }),
      icon: 'i-lucide-file-text',
      to: '/content',
      alert: false,
      module: null,
    },
    {
      key: 'catalog',
      label: t('dashboard.business.catalog'),
      value: data.catalog.published,
      hint: t('dashboard.business.catalogHint', { draft: data.catalog.draft }),
      icon: 'i-lucide-package',
      to: '/catalog',
      alert: false,
      module: 'catalog',
    },
    {
      key: 'orders',
      label: t('dashboard.business.orders'),
      value: data.orders.open,
      hint: t('dashboard.business.ordersHint'),
      icon: 'i-lucide-shopping-bag',
      to: '/orders',
      alert: false,
      module: 'orders',
    },
    {
      key: 'quotations',
      label: t('dashboard.business.quotations'),
      value: data.quotations.open,
      hint: t('dashboard.business.quotationsHint'),
      icon: 'i-lucide-file-signature',
      to: '/orders',
      alert: false,
      module: 'orders',
    },
    {
      key: 'customers',
      label: t('dashboard.business.customers'),
      value: data.customers.total,
      hint: t('dashboard.business.customersHint'),
      icon: 'i-lucide-users',
      to: '/customers',
      alert: false,
      module: 'orders',
    },
    {
      key: 'inventory',
      label: t('dashboard.business.inventory'),
      value: data.inventory.lowStock,
      hint: t('dashboard.business.inventoryHint'),
      icon: 'i-lucide-boxes',
      to: '/inventory',
      alert: data.inventory.lowStock > 0,
      module: 'inventory',
    },
  ]
  return cards.filter(card => card.module === null || isModuleEnabled(card.module))
})

async function load() {
  loading.value = true
  error.value = null
  const tasks: Array<Promise<void>> = []

  if (canReadApp.value) {
    tasks.push(fetchAppDetail().then((data) => { appDetail.value = data }).catch((e) => { error.value = describeError(e) }))
  }
  if (canReadUsers.value) {
    tasks.push(fetchUsers({ limit: 5 }).then((payload) => { members.value = payload.data }).catch((e) => { error.value = describeError(e) }))
  }
  if (canReadRoles.value) {
    tasks.push(fetchRoles({ limit: 50 }).then((payload) => { roles.value = payload.data }).catch((e) => { error.value = describeError(e) }))
  }
  if (canReadLogs.value) {
    tasks.push(fetchAuditLogs({ limit: 5 }).then((payload) => { activity.value = payload.data }).catch((e) => { error.value = describeError(e) }))
  }
  if (canReadBusiness.value) {
    tasks.push(fetchSummary()
      .then((data) => { businessSummary.value = data })
      .catch(() => { businessError.value = t('dashboard.business.unavailable') }))
  }

  await Promise.all(tasks)
  loading.value = false
}

onMounted(load)
</script>

<template>
  <CmsBasePage
    :title="t('dashboard.title')"
    :description="t('dashboard.description', { company: customer?.companyName || 'TM CMS' })"
    :loading="loading"
    :error="error"
  >
    <template #right>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="sm"
        :label="t('common.refresh')"
        :disabled="loading"
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
        <p class="mt-2 truncate text-2xl font-bold tracking-tight text-highlighted">
          {{ stat.value }}
        </p>
      </BentoCard>

      <BentoCard
        v-if="canReadBusiness"
        :title="t('dashboard.business.title')"
        :description="t('dashboard.business.description')"
        icon="i-lucide-activity"
        :col-span="4"
      >
        <p v-if="businessError" class="py-6 text-center text-sm text-muted">
          {{ businessError }}
        </p>
        <p v-else-if="!businessCards.length" class="py-6 text-center text-sm text-muted">
          {{ t('common.noData') }}
        </p>
        <div v-else class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NuxtLink
            v-for="card in businessCards"
            :key="card.key"
            :to="card.to"
            class="rounded-sm border border-default/60 bg-elevated/30 p-3 transition-colors hover:border-primary/60"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs text-muted">{{ card.label }}</span>
              <UIcon :name="card.icon" class="size-4 text-muted" aria-hidden="true" />
            </div>
            <p class="mt-1 text-2xl font-bold tracking-tight" :class="card.alert ? 'text-warning' : 'text-highlighted'">
              {{ card.value }}
            </p>
            <p class="mt-0.5 text-[11px] text-muted">{{ card.hint }}</p>
          </NuxtLink>
        </div>
      </BentoCard>

      <BentoCard
        :title="t('dashboard.members.title')"
        :description="t('dashboard.members.description')"
        icon="i-lucide-users"
        :col-span="2"
      >
        <p v-if="!canReadUsers" class="py-6 text-center text-sm text-muted">
          {{ t('dashboard.restrictedHint') }}
        </p>
        <p v-else-if="!members.length" class="py-6 text-center text-sm text-muted">
          {{ t('common.noData') }}
        </p>
        <div v-else class="mt-3 divide-y divide-default/40">
          <div v-for="member in members" :key="member.id" class="flex items-center justify-between gap-3 py-2.5 text-xs">
            <div class="min-w-0">
              <p class="truncate font-medium text-highlighted">
                {{ member.name || member.username || member.email }}
              </p>
              <p class="truncate text-muted">{{ member.email }}</p>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <UBadge color="neutral" variant="subtle" size="sm">
                {{ member.role }}
              </UBadge>
              <UBadge :color="member.isActive ? 'success' : 'error'" variant="subtle" size="sm">
                {{ member.isActive ? t('dashboard.active') : t('dashboard.inactive') }}
              </UBadge>
            </div>
          </div>
        </div>
        <template #footer>
          <NuxtLink v-if="canReadUsers" to="/users" class="inline-flex items-center gap-1 text-xs text-primary">
            {{ t('dashboard.viewAll') }}
            <UIcon name="i-lucide-arrow-right" class="size-3.5" />
          </NuxtLink>
        </template>
      </BentoCard>

      <BentoCard
        :title="t('dashboard.activity.title')"
        :description="t('dashboard.activity.description')"
        icon="i-lucide-history"
        :col-span="2"
      >
        <p v-if="!canReadLogs" class="py-6 text-center text-sm text-muted">
          {{ t('dashboard.restrictedHint') }}
        </p>
        <p v-else-if="!activity.length" class="py-6 text-center text-sm text-muted">
          {{ t('dashboard.activity.empty') }}
        </p>
        <div v-else class="mt-3 divide-y divide-default/40">
          <div v-for="(entry, index) in activity" :key="`${entry.at}-${index}`" class="flex items-start justify-between gap-3 py-2.5 text-xs">
            <div class="min-w-0">
              <p class="truncate font-medium text-highlighted">
                {{ entry.summary || `${entry.action} ${entry.modelName}` }}
              </p>
              <p class="truncate text-muted">
                {{ entry.by?.name || entry.by?.email || t('dashboard.activity.systemActor') }}
              </p>
            </div>
            <span class="shrink-0 text-muted">{{ formatTime(entry.at) }}</span>
          </div>
        </div>
        <template #footer>
          <NuxtLink v-if="canReadLogs" to="/audit" class="inline-flex items-center gap-1 text-xs text-primary">
            {{ t('dashboard.viewAll') }}
            <UIcon name="i-lucide-arrow-right" class="size-3.5" />
          </NuxtLink>
        </template>
      </BentoCard>

      <BentoCard
        :title="t('dashboard.installation.title')"
        :description="t('dashboard.installation.description')"
        icon="i-lucide-server"
        :col-span="4"
      >
        <div class="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded-sm border border-default/60 bg-elevated/30 p-3">
            <p class="text-muted">{{ t('dashboard.installation.appId') }}</p>
            <p class="mt-1 truncate font-mono font-medium text-highlighted">{{ appDetail?.id || '—' }}</p>
          </div>
          <div class="rounded-sm border border-default/60 bg-elevated/30 p-3">
            <p class="text-muted">{{ t('dashboard.installation.tenant') }}</p>
            <p class="mt-1 truncate font-mono font-medium text-highlighted">{{ user?.tenantId || '—' }}</p>
          </div>
          <div class="rounded-sm border border-default/60 bg-elevated/30 p-3">
            <p class="text-muted">{{ t('dashboard.installation.configs') }}</p>
            <p class="mt-1 font-medium text-highlighted">{{ canReadApp ? Object.keys(appDetail?.configs || {}).length : '—' }}</p>
          </div>
          <div class="rounded-sm border border-default/60 bg-elevated/30 p-3">
            <p class="text-muted">{{ t('dashboard.installation.capabilities') }}</p>
            <p class="mt-1 font-medium text-highlighted">{{ permissions.includes('*') ? t('dashboard.installation.fullAccess') : permissions.length }}</p>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-1.5">
          <span
            v-for="module in licensedModules"
            :key="module"
            class="inline-flex items-center rounded-[4px] border border-default bg-elevated/30 px-2 py-0.5 text-[11px] font-medium text-muted"
          >
            {{ t(`nav.${module}`) }}
          </span>
          <span v-if="!licensedModules.length" class="text-xs text-muted">
            {{ t('dashboard.installation.noModules') }}
          </span>
        </div>
      </BentoCard>
    </div>
  </CmsBasePage>
</template>
