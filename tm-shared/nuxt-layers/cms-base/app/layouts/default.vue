<script setup lang="ts">
import { CMS_MODULE_MAP, type CmsModuleKey } from '../utils/module-registry'

const { t } = useI18n()
const { customer, isModuleEnabled } = useCustomerConfig()
const { user, logout, hasCapability } = useHub()

const moduleItem = (key: CmsModuleKey) => {
  const definition = CMS_MODULE_MAP[key]
  return { label: t(definition.navKey), icon: definition.icon, to: definition.route }
}

const gatedModuleItems = (key: CmsModuleKey) => (isModuleEnabled(key) ? [moduleItem(key)] : [])

const navItems = computed(() => [
  { label: t('nav.dashboard'), icon: 'i-lucide-layout-dashboard', to: '/' },
  ...gatedModuleItems('catalog'),
  ...gatedModuleItems('orders'),
  ...gatedModuleItems('inventory'),
  ...gatedModuleItems('finance'),
  ...gatedModuleItems('reports'),
  ...gatedModuleItems('media'),
  { label: t('nav.content'), icon: 'i-lucide-file-pen', to: '/content' },
  ...gatedModuleItems('aiWorkspace'),
  ...(hasCapability('users.read') ? [{ label: t('nav.users'), icon: 'i-lucide-users', to: '/users' }] : []),
  ...(hasCapability('roles.read') ? [{ label: t('nav.roles'), icon: 'i-lucide-shield-check', to: '/roles' }] : []),
  ...(hasCapability('configs.read') ? [{ label: t('nav.configs'), icon: 'i-lucide-key-round', to: '/configs' }] : []),
  ...(hasCapability('routes.read') ? [{ label: t('nav.routes'), icon: 'i-lucide-route', to: '/routes' }] : []),
  ...(hasCapability('connections.read') ? [{ label: t('nav.connections'), icon: 'i-lucide-cable', to: '/connections' }] : []),
  ...(hasCapability('apps.logs.read') ? [{ label: t('nav.audit'), icon: 'i-lucide-history', to: '/audit' }] : []),
  ...(hasCapability('notifications.read') ? [{ label: t('nav.notifications'), icon: 'i-lucide-bell', to: '/notifications' }] : []),
  ...(hasCapability('mail.manage') ? [{ label: t('nav.mail'), icon: 'i-lucide-mail', to: '/mail' }] : []),
  { label: t('nav.settings'), icon: 'i-lucide-settings', to: '/settings' },
])

const mobilePrimary = computed(() => navItems.value.slice(0, 4))

const mobileOverflowItems = computed(() => navItems.value.slice(4).map(item => ({
  label: item.label,
  icon: item.icon,
  onSelect: () => navigateTo(item.to),
})))
</script>

<template>
  <div class="relative flex min-h-screen">
    <!-- Desktop Sidebar -->
    <aside class="hidden w-64 shrink-0 border-r border-default bg-elevated/40 backdrop-blur-xl md:flex md:flex-col">
      <!-- Brand Logo / Customer Name -->
      <div class="flex h-16 items-center gap-3 border-b border-default px-5">
        <div class="flex size-8 items-center justify-center rounded-[4px] bg-primary/20 text-primary">
          <UIcon name="i-lucide-layers" class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <h2 class="truncate text-sm font-semibold text-highlighted">
            {{ customer?.companyName || 'TM CMS' }}
          </h2>
          <p class="truncate text-xs text-muted">
            {{ customer?.customerId || 'Admin Suite' }}
          </p>
        </div>
      </div>

      <!-- Navigation Menu -->
      <nav class="flex-1 space-y-1 overflow-y-auto p-3 scroll-thin">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-[4px] px-3 py-2 text-sm font-medium transition-colors hover:bg-elevated/80"
          active-class="bg-primary/10 text-primary font-semibold"
        >
          <UIcon :name="item.icon" class="size-4 shrink-0" />
          <span class="truncate">{{ item.label }}</span>
        </NuxtLink>
      </nav>

      <!-- User Profile Card -->
      <div class="border-t border-default p-3">
        <div class="panel flex items-center justify-between p-2">
          <div class="min-w-0 flex-1 pr-2">
            <p class="truncate text-xs font-medium text-highlighted">
              {{ user?.name || 'Administrator' }}
            </p>
            <p class="truncate text-[10px] text-muted">
              {{ user?.email || 'admin@customer.com' }}
            </p>
          </div>
          <UButton
            icon="i-lucide-log-out"
            color="neutral"
            variant="ghost"
            size="xs"
            :title="t('auth.logout')"
            @click="logout"
          />
        </div>
      </div>
    </aside>

    <!-- Main Workspace Container -->
    <div class="flex min-w-0 flex-1 flex-col pb-14 md:pb-0">
      <slot />
    </div>

    <!-- Mobile Global Bottom Navigation -->
    <nav class="fixed inset-x-0 bottom-0 z-40 grid h-14 grid-cols-5 border-t border-default bg-elevated/80 backdrop-blur-xl md:hidden">
      <NuxtLink
        v-for="item in mobilePrimary"
        :key="item.to"
        :to="item.to"
        class="flex min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-[10px] text-muted"
        active-class="text-primary font-semibold"
      >
        <UIcon :name="item.icon" class="size-4" />
        <span class="w-full truncate text-center">{{ item.label }}</span>
      </NuxtLink>
      <UDropdownMenu
        :items="mobileOverflowItems"
        :content="{ side: 'top', align: 'end' }"
      >
        <button
          type="button"
          class="flex min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-[10px] text-muted"
          :aria-label="t('common.more')"
        >
          <UIcon name="i-lucide-ellipsis" class="size-4" />
          <span class="w-full truncate text-center">{{ t('common.more') }}</span>
        </button>
      </UDropdownMenu>
    </nav>
  </div>
</template>
