<script setup lang="ts">
import { CMS_MODULE_MAP, type CmsModuleKey } from '../utils/module-registry'

const props = defineProps<{
  moduleKey: CmsModuleKey
}>()

const { t } = useI18n()
const { entitled, connected } = useModuleState(props.moduleKey)

const definition = computed(() => CMS_MODULE_MAP[props.moduleKey])
</script>

<template>
  <div class="flex max-w-xl flex-col items-center gap-2">
    <div class="flex flex-wrap items-center justify-center gap-2">
      <UBadge
        :color="entitled ? 'success' : 'neutral'"
        variant="subtle"
        size="xs"
        class="rounded-[4px]"
      >
        {{ t('modules.status.entitlement') }}:
        {{ entitled ? t('modules.status.entitled') : t('modules.status.notEntitled') }}
      </UBadge>
      <UBadge
        :color="connected ? 'success' : 'warning'"
        variant="subtle"
        size="xs"
        class="rounded-[4px]"
      >
        {{ t('modules.status.dataSource') }}:
        {{ connected ? t('modules.status.connected') : t('modules.status.pending') }}
      </UBadge>
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
