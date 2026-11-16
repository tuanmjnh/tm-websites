<script setup lang="ts">
import { CMS_MODULE_MAP, type CmsModuleDefinition, type CmsModuleKey } from '../utils/module-registry'

/**
 * The whole body of a business module that is not wired to tenant data yet. The
 * five stub pages were the same file with one key swapped, and none of them may
 * render business records: the page only states its entitlement and data source.
 */
const props = defineProps<{ moduleKey: CmsModuleKey }>()

const { t } = useI18n()
const { entitled, state } = useModuleState(props.moduleKey)

// Typed by the interface, not the literal union: only a pending entry has a blocker.
const definition = CMS_MODULE_MAP[props.moduleKey] as CmsModuleDefinition
const title = computed(() => t(definition.navKey))
/**
 * The reason, not just the fact: promising "waiting for a data connection" for a
 * module that has no accepted data model would send the editor to ask for the
 * wrong thing.
 */
const statusText = computed(() => {
  if (!entitled.value) return t('modules.status.disabledText', { module: title.value })
  if (definition.blocker === 'out-of-scope') return t('modules.status.outOfScopeText', { module: title.value })
  if (definition.blocker === 'waiting-decision') return t('modules.status.decisionText', { module: title.value })
  return t('modules.status.pendingText', { module: title.value })
})
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
