export default defineNuxtConfig({
  app: {
    head: {
      title: 'Hoàng Vi CMS',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/branding/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/branding/icon-192.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
      meta: [
        { name: 'description', content: 'Quản trị Hoàng Vi Beauty & Cosmetics' },
        { name: 'theme-color', content: '#f43f5e' },
        { name: 'apple-mobile-web-app-title', content: 'HoàngVi' },
      ],
    },
  },
})
