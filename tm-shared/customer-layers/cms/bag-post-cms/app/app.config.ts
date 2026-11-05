export default defineAppConfig({
  customer: {
    customerId: 'bagpost',
    tenantId: 'tenant_bag_post',
    cmsAppId: 'app_bag_post_cms',
    companyName: 'Bag Post Logistics & Packaging',
    theme: {
      primary: 'emerald',
      secondary: 'cyan',
      neutral: 'zinc',
      radius: '6px',
    },
    entitlements: {
      catalog: true,
      orders: true,
      inventory: true,
      purchaseOrders: true,
      finance: false,
      reports: true,
      media: true,
      aiWorkspace: false,
    },
  },
  ui: {
    colors: {
      primary: 'emerald',
      secondary: 'cyan',
      neutral: 'zinc',
    },
  },
})

