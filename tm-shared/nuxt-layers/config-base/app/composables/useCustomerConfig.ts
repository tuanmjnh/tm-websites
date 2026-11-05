import type { CustomerConfig } from '@tm/flow-config'

export const useCustomerConfig = () => {
  const appConfig = useAppConfig()
  const customer = computed<CustomerConfig | undefined>(() => appConfig.customer as CustomerConfig | undefined)

  const isModuleEnabled = (moduleKey: keyof NonNullable<CustomerConfig['entitlements']>) => {
    return Boolean(customer.value?.entitlements?.[moduleKey])
  }

  return {
    customer,
    isModuleEnabled,
  }
}

