<script setup lang="ts">
import type {
  AdminAuditAction,
  AdminAuditEntry,
  AdminAuditQuery,
  AdminAuditResourceType,
} from '@tm/flow-contracts/audit-admin'
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_RESOURCE_TYPES,
} from '@tm/flow-contracts/audit-admin'

const { t, locale } = useI18n()
const { hasCapability } = useHub()
const { list, describeError } = useAuditAdmin()

const canRead = computed(() => hasCapability('apps.logs.read'))
const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const entries = ref<AdminAuditEntry[]>([])
const total = ref(0)
const nextCursor = ref<string | null>(null)
const hasMore = ref(false)

const PAGE_SIZE = 30

const filters = reactive<{ resourceType: AdminAuditResourceType | 'all', action: AdminAuditAction | 'all', q: string }>({
  resourceType: 'all',
  action: 'all',
  q: '',
})

const resourceItems = computed(() => [
  { label: t('admin.audit.filters.allResources'), value: 'all' },
  ...ADMIN_AUDIT_RESOURCE_TYPES.map(value => ({ label: t(`admin.audit.resources.${value}`), value })),
])

const actionItems = computed(() => [
  { label: t('admin.audit.filters.allActions'), value: 'all' },
  ...ADMIN_AUDIT_ACTIONS.map(value => ({ label: t(`admin.audit.actions.${value}`), value })),
])

const formatTime = (value: string) => new Date(value).toLocaleString(locale.value)

const actionColor = (action: AdminAuditAction) => {
  switch (action) {
    case 'create':
      return 'success'
    case 'publish':
      return 'primary'
    case 'update':
      return 'info'
    case 'schedule':
      return 'warning'
    case 'delete':
      return 'error'
    case 'archive':
    case 'unpublish':
      return 'neutral'
    default:
      return 'secondary'
  }
}

const stats = computed(() => [
  { title: t('admin.audit.stats.total'), value: String(total.value), icon: 'i-lucide-history', compact: false },
  {
    title: t('admin.audit.stats.actors'),
    value: String(new Set(entries.value.map(entry => entry.actor.id || entry.actor.email).filter(Boolean)).size),
    icon: 'i-lucide-users',
    compact: false,
  },
  {
    title: t('admin.audit.stats.models'),
    value: String(new Set(entries.value.map(entry => entry.resourceType)).size),
    icon: 'i-lucide-layers',
    compact: false,
  },
  {
    title: t('admin.audit.stats.latest'),
    value: entries.value.length ? formatTime(entries.value[0]!.createdAt) : '—',
    icon: 'i-lucide-clock',
    compact: true,
  },
])

function buildQuery(cursor: string | null): AdminAuditQuery {
  const query: AdminAuditQuery = { limit: PAGE_SIZE }
  if (filters.resourceType !== 'all') query.resourceType = filters.resourceType
  if (filters.action !== 'all') query.action = filters.action
  if (filters.q.trim()) query.q = filters.q.trim()
  if (cursor) query.cursor = cursor
  return query
}

async function load(reset = true) {
  if (!canRead.value) return
  if (reset) loading.value = true
  else loadingMore.value = true
  error.value = null
  try {
    const payload = await list(buildQuery(reset ? null : nextCursor.value))
    entries.value = reset ? payload.data : [...entries.value, ...payload.data]
    total.value = payload.total
    nextCursor.value = payload.nextCursor
    hasMore.value = payload.hasMore
  } catch (cause) {
    error.value = t(`admin.audit.errors.${describeError(cause)}`)
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(() => filters.q, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void load(), 300)
})
watch([() => filters.resourceType, () => filters.action], () => void load())

if (canRead.value) await load()
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
        @click="load()"
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
        @click="load()"
      />
    </template>

    <template #toolbar>
      <div class="mx-auto mt-2 flex w-full max-w-7xl flex-wrap items-center gap-2">
        <UInput
          v-model="filters.q"
          icon="i-lucide-search"
          size="sm"
          class="w-full sm:w-64"
          :placeholder="t('admin.audit.filters.search')"
          :maxlength="80"
          :disabled="!canRead"
        />
        <USelect
          v-model="filters.resourceType"
          :items="resourceItems"
          value-key="value"
          size="sm"
          class="w-40"
          :disabled="!canRead"
        />
        <USelect
          v-model="filters.action"
          :items="actionItems"
          value-key="value"
          size="sm"
          class="w-40"
          :disabled="!canRead"
        />
        <span class="ml-auto text-[11px] text-muted">
          {{ t('admin.audit.matching', { count: total }) }}
        </span>
      </div>
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
        <p v-if="!entries.length && !loading" class="py-8 text-center text-sm text-muted">
          {{ t('admin.audit.noEntries') }}
        </p>

        <div v-else class="mt-3 divide-y divide-default/40">
          <div
            v-for="entry in entries"
            :key="entry.id"
            class="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-2 last:pb-1"
          >
            <div class="flex min-w-0 items-start gap-2.5">
              <div class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm border border-default bg-elevated/50 text-muted">
                <UIcon name="i-lucide-clipboard-list" class="size-3.5" />
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge :color="actionColor(entry.action)" variant="subtle" size="sm">
                    {{ t(`admin.audit.actions.${entry.action}`) }}
                  </UBadge>
                  <span class="text-sm font-medium text-highlighted">
                    {{ t(`admin.audit.resources.${entry.resourceType}`) }}
                  </span>
                  <span class="truncate font-mono text-xs text-default" :title="entry.resourceKey">
                    {{ entry.resourceKey }}
                  </span>
                  <UBadge color="neutral" variant="subtle" size="sm">
                    {{ t('admin.audit.revision') }} {{ entry.revision }}
                  </UBadge>
                </div>

                <p v-if="entry.reason" class="mt-1 text-xs italic text-default">
                  “{{ entry.reason }}”
                </p>

                <p class="mt-1 text-xs text-muted">
                  {{ entry.actor.name || entry.actor.email || t('admin.audit.systemActor') }}
                  <span v-if="entry.actor.email && entry.actor.name"> · {{ entry.actor.email }}</span>
                  <span v-if="entry.fromStatus || entry.toStatus">
                    · {{ entry.fromStatus || '—' }} → {{ entry.toStatus || '—' }}
                  </span>
                </p>

                <div v-if="entry.changedFields.length" class="mt-1.5 flex flex-wrap gap-1">
                  <span
                    v-for="field in entry.changedFields"
                    :key="field"
                    class="inline-flex items-center rounded-[4px] border border-default bg-elevated/30 px-1.5 py-0.5 text-[11px] text-muted"
                  >
                    {{ field }}
                  </span>
                </div>
              </div>
            </div>
            <span class="shrink-0 text-xs text-muted">{{ formatTime(entry.createdAt) }}</span>
          </div>
        </div>

        <div v-if="hasMore" class="mt-3 flex justify-center">
          <UButton
            color="neutral"
            variant="soft"
            size="sm"
            :loading="loadingMore"
            :label="t('admin.audit.loadMore')"
            @click="load(false)"
          />
        </div>
      </BentoCard>
    </div>
  </CmsBasePage>
</template>
