export default defineNuxtConfig({
  app: {
    head: {
      title: 'Thanh Tùng CMS',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/branding/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/branding/icon-192.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
      meta: [
        { name: 'description', content: 'Quản trị Thanh Tùng Industrial Commerce' },
        { name: 'theme-color', content: '#3b82f6' },
        { name: 'apple-mobile-web-app-title', content: 'ThanhTùng' },
      ],
    },
  },
})
