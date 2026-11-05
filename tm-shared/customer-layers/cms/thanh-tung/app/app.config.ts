export default defineAppConfig({
  customer: {
    customerId: 'thanhtung',
    tenantId: 'tenant_thanh_tung',
    cmsAppId: 'app_thanh_tung_cms',
    companyName: 'Thanh Tùng Industrial Commerce',
    theme: {
      primary: 'blue',
      secondary: 'slate',
      neutral: 'slate',
      radius: '4px',
    },
    entitlements: {
      catalog: true,
      orders: true,
      inventory: true,
      purchaseOrders: true,
      finance: true,
      reports: true,
      media: true,
      aiWorkspace: false,
    },
  },
  ui: {
    colors: {
      primary: 'blue',
      secondary: 'slate',
      neutral: 'slate',
    },
  },
})

