export default defineAppConfig({
  customer: {
    customerId: 'default',
    tenantId: 'tenant_default',
    webAppId: 'app_default_web',
    companyName: 'TM Enterprise Storefront',
    domains: ['localhost', 'tm-web.vercel.app'],
    theme: {
      primary: 'violet',
      secondary: 'indigo',
      neutral: 'zinc',
      radius: '6px',
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

