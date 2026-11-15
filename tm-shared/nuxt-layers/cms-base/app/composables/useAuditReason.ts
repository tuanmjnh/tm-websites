import type { Ref } from 'vue'

/**
 * The note an editor attaches to one audited action. It belongs to the dialog it
 * was typed in, so closing any of those dialogs drops it: a cancelled note must
 * never ride along with the next publish, archive or delete.
 */
export const useAuditReason = () => {
  const reason = ref('')

  /** Every dialog that collects a note, so closing one clears the field. */
  const resetOnClose = (...dialogs: Ref<boolean>[]) => {
    for (const open of dialogs) {
      watch(open, (value) => {
        if (!value) reason.value = ''
      })
    }
  }

  return { reason, resetOnClose }
}
