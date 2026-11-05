export default defineAppConfig({
  customer: {
    customerId: 'default',
    tenantId: 'tenant_default',
    cmsAppId: 'app_default_cms',
    companyName: 'TM Enterprise Platform',
    theme: {
      primary: 'violet',
      secondary: 'indigo',
      neutral: 'zinc',
      radius: '6px',
    },
    entitlements: {
      catalog: true,
      orders: true,
      inventory: true,
      purchaseOrders: true,
      finance: true,
      hr: true,
      reports: true,
      media: true,
      aiWorkspace: true,
    },
  },
  ui: {
    colors: {
      primary: 'violet',
      secondary: 'indigo',
      neutral: 'zinc',
    },
  },
})

