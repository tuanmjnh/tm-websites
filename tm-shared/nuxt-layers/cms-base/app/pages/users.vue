<script setup lang="ts">
import type { HubUserSummary } from '@tm/flow-contracts'

const { t } = useI18n()
const { hasCapability } = useHub()
const { fetchUsers, describeError } = useHubAdmin()

const canRead = computed(() => hasCapability('users.read'))
const loading = ref(false)
const error = ref<string | null>(null)
const users = ref<HubUserSummary[]>([])
const search = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return users.value
  return users.value.filter((u) => {
    return [u.name, u.email, u.username]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(q))
  })
})

const stats = computed(() => [
  { title: t('admin.users.stats.total'), value: String(users.value.length), icon: 'i-lucide-users' },
  { title: t('admin.users.stats.active'), value: String(users.value.filter(u => u.isActive).length), icon: 'i-lucide-user-check' },
  { title: t('admin.users.stats.roles'), value: String(new Set(users.value.map(u => u.role)).size), icon: 'i-lucide-shield' },
])

const initials = (user: HubUserSummary) => {
  return (user.name || user.username || user.email || '?').slice(0, 2).toUpperCase()
}

async function load() {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const payload = await fetchUsers({ limit: 50 })
    users.value = payload.data
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
    :title="t('admin.users.title')"
    :description="t('admin.users.description')"
    :loading="loading"
    :error="error"
    :empty="!canRead"
    :empty-text="t('admin.users.permissionDenied')"
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
      <div class="mx-auto w-full max-w-7xl px-4 pb-2 sm:px-6">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          :placeholder="t('admin.users.search')"
          :disabled="!canRead"
          class="w-full sm:max-w-sm"
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
        <p class="mt-2 text-2xl font-bold tracking-tight text-highlighted">
          {{ stat.value }}
        </p>
      </BentoCard>

      <BentoCard
        :title="t('admin.users.listTitle')"
        :description="t('admin.users.listDescription')"
        icon="i-lucide-users"
        :col-span="4"
      >
        <p v-if="!filtered.length" class="py-8 text-center text-sm text-muted">
          {{ t('admin.users.noResults') }}
        </p>
        <div v-else class="mt-3 divide-y divide-default/40">
          <div v-for="member in filtered" :key="member.id" class="flex items-center justify-between gap-3 py-3">
            <div class="flex min-w-0 items-center gap-3">
              <div class="flex size-8 shrink-0 items-center justify-center rounded-sm border border-default bg-elevated/50 text-[11px] font-semibold text-muted">
                {{ initials(member) }}
              </div>
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-highlighted">
                  {{ member.name || member.username || member.email }}
                </p>
                <p class="truncate text-xs text-muted">
                  {{ member.email }}
                  <span v-if="member.username"> · {{ member.username }}</span>
                </p>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <UBadge
                :color="member.isActive ? 'success' : 'neutral'"
                variant="subtle"
                size="sm"
              >
                {{ member.isActive ? t('admin.users.active') : t('admin.users.inactive') }}
              </UBadge>
              <UBadge color="primary" variant="subtle" size="sm">
                {{ member.role }}
              </UBadge>
            </div>
          </div>
        </div>
      </BentoCard>
    </div>
  </CmsBasePage>
</template>
