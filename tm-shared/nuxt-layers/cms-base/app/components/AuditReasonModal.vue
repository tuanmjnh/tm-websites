<script setup lang="ts">
/**
 * Confirmation for an action whose only input is the audit note. The dialog owns
 * the field, so Cancel, Escape or the backdrop always drops the note with it and
 * no page has to remember to reset anything.
 */
const { t } = useI18n()

defineProps<{
  title: string
  confirmLabel: string
  confirmColor?: 'primary' | 'error'
  loading?: boolean
}>()

const emit = defineEmits<{ confirm: [reason: string | undefined] }>()

const open = defineModel<boolean>('open', { required: true })

const reason = ref('')
watch(open, (value) => {
  if (!value) reason.value = ''
})

const confirm = () => emit('confirm', reason.value.trim() || undefined)
</script>

<template>
  <UModal v-model:open="open" :title="title" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }">
    <template #body>
      <AuditReasonField v-model="reason" />
    </template>
    <template #footer="{ close }">
      <div class="flex w-full items-center justify-end gap-2">
        <UButton color="neutral" variant="ghost" size="sm" :label="t('common.cancel')" @click="close()" />
        <UButton
          :color="confirmColor ?? 'primary'"
          variant="soft"
          size="sm"
          :label="confirmLabel"
          :loading="loading"
          @click="confirm"
        />
      </div>
    </template>
  </UModal>
</template>
