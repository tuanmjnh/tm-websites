import { CMS_MODULE_MAP, type CmsModuleKey } from '../utils/module-registry'

export type CmsModuleState = 'disabled' | 'pending' | 'ready'

/**
 * Resolves the effective state of a CMS business module.
 *
 * - `disabled`: the customer entitlement is off.
 * - `pending`: entitled, but no tenant data source is wired yet.
 * - `ready`: entitled and connected; business data may be rendered.
 */
export const useModuleState = (moduleKey: CmsModuleKey) => {
  const { isModuleEnabled } = useCustomerConfig()

  const definition = computed(() => CMS_MODULE_MAP[moduleKey])
  const entitled = computed(() => isModuleEnabled(moduleKey))
  const connected = computed(() => definition.value.dataSource === 'connected')

  const state = computed<CmsModuleState>(() => {
    if (!entitled.value) return 'disabled'
    return connected.value ? 'ready' : 'pending'
  })

  return {
    definition,
    entitled,
    connected,
    state,
  }
}
