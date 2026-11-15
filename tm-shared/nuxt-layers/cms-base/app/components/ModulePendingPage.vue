<script setup lang="ts">
import { CMS_MODULE_MAP, type CmsModuleKey } from '../utils/module-registry'

/**
 * The whole body of a business module that is not wired to tenant data yet. The
 * five stub pages were the same file with one key swapped, and none of them may
 * render business records: the page only states its entitlement and data source.
 */
const props = defineProps<{ moduleKey: CmsModuleKey }>()

const { t } = useI18n()
const { entitled, state } = useModuleState(props.moduleKey)

const definition = CMS_MODULE_MAP[props.moduleKey]
const title = computed(() => t(definition.navKey))
const statusText = computed(() =>
  entitled.value
    ? t('modules.status.pendingText', { module: title.value })
    : t('modules.status.disabledText', { module: title.value }),
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
      <ModuleStatusBadges :module-key="moduleKey" />
    </template>

    <ModuleStatusBadges :module-key="moduleKey" />
  </CmsBasePage>
</template>
