<script setup lang="ts">
/**
 * The reason field every audited action shows. One component so the label, the
 * placeholder and the 500-character cap the API enforces cannot drift apart.
 */
const { t } = useI18n()

const reason = defineModel<string>({ required: true })
</script>

<template>
  <UInput
    v-model="reason"
    class="w-full"
    :maxlength="500"
    :placeholder="t('common.auditReasonPlaceholder')"
    :aria-label="t('common.auditReason')"
  />
</template>
