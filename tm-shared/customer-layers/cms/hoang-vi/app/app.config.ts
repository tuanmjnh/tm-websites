export default defineAppConfig({
  customer: {
    customerId: 'hoangvi',
    tenantId: 'tenant_hoang_vi',
    cmsAppId: 'app_hoang_vi_cms',
    companyName: 'Hoàng Vi Beauty & Cosmetics',
    theme: {
      primary: 'rose',
      secondary: 'pink',
      neutral: 'stone',
      radius: '8px',
    },
    entitlements: {
      catalog: true,
      orders: true,
      inventory: false,
      purchaseOrders: false,
      finance: false,
      reports: true,
      media: true,
      aiWorkspace: true,
    },
  },
  ui: {
    colors: {
      primary: 'rose',
      secondary: 'pink',
      neutral: 'stone',
    },
  },
})

