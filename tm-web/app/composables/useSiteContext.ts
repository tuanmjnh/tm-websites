export const useSiteContext = () => {
  const config = useRuntimeConfig()
  const { customer } = useCustomerConfig()

  const siteId = computed(() => config.public.siteId || 'default')
  const tenantId = computed(() => config.public.tenantId || customer.value?.tenantId || 'default')

  return {
    siteId,
    tenantId,
    customer,
  }
}

