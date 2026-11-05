<script setup lang="ts">
import { CMS_MODULE_MAP } from '../utils/module-registry'

const { t } = useI18n()
const { entitled, state } = useModuleState('orders')

const definition = CMS_MODULE_MAP.orders
const title = computed(() => t(definition.navKey))
const statusText = computed(() =>
  entitled.value
    ? t('modules.status.pendingText', { module: title.value })
    : t('modules.status.disabledText', { module: title.value })
)
const statusIcon = computed(() => (entitled.value ? 'i-lucide-plug-zap' : definition.disabledIcon))
</script>

<template>
  <CmsBasePage
    :title="title"
    :description="t(definition.descriptionKey)"
    :empty="state !== 'ready'"
    :empty-text="statusText"
    :empty-icon="statusIcon"
  >
    <template #emptyAction>
      <ModuleStatusBadges module-key="orders" />
    </template>

    <ModuleStatusBadges module-key="orders" />
  </CmsBasePage>
</template>
