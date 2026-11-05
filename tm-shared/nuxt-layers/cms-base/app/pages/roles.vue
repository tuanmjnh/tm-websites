<script setup lang="ts">
import type { HubRole } from '@tm/flow-contracts'

const { t } = useI18n()
const { hasCapability } = useHub()
const { fetchRoles, describeError } = useHubAdmin()

const canRead = computed(() => hasCapability('roles.read'))
const loading = ref(false)
const error = ref<string | null>(null)
const roles = ref<HubRole[]>([])

const stats = computed(() => [
  { title: t('admin.roles.stats.total'), value: String(roles.value.length), icon: 'i-lucide-shield' },
  { title: t('admin.roles.stats.system'), value: String(roles.value.filter(r => r.isSystem).length), icon: 'i-lucide-lock' },
  {
    title: t('admin.roles.stats.modules'),
    value: String(new Set(roles.value.flatMap(r => r.permissions.map(p => p.module))).size),
    icon: 'i-lucide-blocks',
  },
])

const permissionLabel = (module: string, actions: string[]) => {
  if (module === '*' && actions.includes('*')) return t('admin.roles.fullAccess')
  return `${module}: ${actions.join(', ')}`
}

async function load() {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const payload = await fetchRoles({ limit: 50 })
    roles.value = payload.data
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
    :title="t('admin.roles.title')"
    :description="t('admin.roles.description')"
    :loading="loading"
    :error="error"
    :empty="!canRead"
    :empty-text="t('admin.roles.permissionDenied')"
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
        <p class="mt-2 text-2xl font-bold tracking-tight text-highlighted">
          {{ stat.value }}
        </p>
      </BentoCard>

      <BentoCard
        :title="t('admin.roles.listTitle')"
        :description="t('admin.roles.listDescription')"
        icon="i-lucide-shield-check"
        :col-span="4"
      >
        <p v-if="!roles.length" class="py-8 text-center text-sm text-muted">
          {{ t('common.noData') }}
        </p>
        <div v-else class="mt-3 divide-y divide-default/40">
          <div v-for="role in roles" :key="role.id" class="py-4 first:pt-2 last:pb-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-sm font-semibold text-highlighted">
                {{ role.name }}
              </p>
              <UBadge :color="role.isSystem ? 'info' : 'neutral'" variant="subtle" size="sm">
                {{ role.isSystem ? t('admin.roles.system') : t('admin.roles.custom') }}
              </UBadge>
              <UBadge color="neutral" variant="subtle" size="sm">
                {{ role.id }}
              </UBadge>
              <span
                v-if="role.allowedRoutes.includes('*')"
                class="inline-flex items-center gap-1 text-xs text-muted"
              >
                <UIcon name="i-lucide-route" class="size-3.5" />
                {{ t('admin.roles.allRoutes') }}
              </span>
            </div>

            <p v-if="role.description" class="mt-1 text-xs text-muted">
              {{ role.description }}
            </p>

            <div class="mt-2.5 flex flex-wrap gap-1.5">
              <span
                v-for="permission in role.permissions"
                :key="`${role.id}-${permission.module}`"
                class="inline-flex items-center rounded-[4px] border border-default bg-elevated/30 px-2 py-0.5 text-[11px] font-medium text-muted"
              >
                {{ permissionLabel(permission.module, permission.actions) }}
              </span>
              <span v-if="!role.permissions.length" class="text-xs text-muted">
                {{ t('admin.roles.noPermissions') }}
              </span>
            </div>
          </div>
        </div>
      </BentoCard>
    </div>
  </CmsBasePage>
</template>
