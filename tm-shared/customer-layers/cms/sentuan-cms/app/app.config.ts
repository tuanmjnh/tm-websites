export default defineAppConfig({
  customer: {
    customerId: 'sentuan',
    tenantId: 'tenant_sentuan',
    cmsAppId: 'app_sentuan_cms',
    companyName: 'Sen Tuấn Jewelry & Gemstones',
    theme: {
      primary: 'amber',
      secondary: 'rose',
      neutral: 'stone',
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
      aiWorkspace: true,
    },
  },
  ui: {
    colors: {
      primary: 'amber',
      secondary: 'rose',
      neutral: 'stone',
    },
  },
})

