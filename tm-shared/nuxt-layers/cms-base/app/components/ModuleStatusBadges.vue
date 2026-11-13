<script setup lang="ts">
import { StatusBadge } from '@tuanmjnh/tm-ui'
import { CMS_MODULE_MAP, type CmsModuleKey } from '../utils/module-registry'

const props = defineProps<{
  moduleKey: CmsModuleKey
}>()

const { t } = useI18n()
const { entitled, connected } = useModuleState(props.moduleKey)

const definition = computed(() => CMS_MODULE_MAP[props.moduleKey])
const entitlementLabel = computed(
  () => `${t('modules.status.entitlement')}: ${entitled.value ? t('modules.status.entitled') : t('modules.status.notEntitled')}`,
)
const dataSourceLabel = computed(
  () => `${t('modules.status.dataSource')}: ${connected.value ? t('modules.status.connected') : t('modules.status.pending')}`,
)
</script>

<template>
  <div class="flex max-w-xl flex-col items-center gap-2">
    <div class="flex flex-wrap items-center justify-center gap-2">
      <StatusBadge
        :label="entitlementLabel"
        :color="entitled ? 'success' : 'neutral'"
        class="rounded-[4px]"
      />
      <StatusBadge
        :label="dataSourceLabel"
        :color="connected ? 'success' : 'warning'"
        class="rounded-[4px]"
      />
    </div>
    <p v-if="!entitled" class="text-xs leading-relaxed text-muted">
      {{ t('modules.status.disabledHint') }}
    </p>
    <p v-else-if="!connected" class="text-xs leading-relaxed text-muted">
      {{ t(definition.pendingHintKey) }}
    </p>
    <p v-else class="text-xs leading-relaxed text-muted">
      {{ t('modules.status.readyHint') }}
    </p>
  </div>
</template>
