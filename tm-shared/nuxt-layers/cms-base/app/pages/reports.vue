<script setup lang="ts">
import { CMS_MODULE_MAP } from '../utils/module-registry'

const { t } = useI18n()
const { entitled, state } = useModuleState('reports')

const definition = CMS_MODULE_MAP.reports
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
      <ModuleStatusBadges module-key="reports" />
    </template>

    <ModuleStatusBadges module-key="reports" />
  </CmsBasePage>
</template>
