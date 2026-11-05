export default defineNuxtConfig({
  app: {
    head: {
      title: 'Sen Tuấn CMS',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/branding/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/branding/icon-192.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
      meta: [
        { name: 'description', content: 'Quản trị Sen Tuấn Jewelry & Gemstones' },
        { name: 'theme-color', content: '#f59e0b' },
        { name: 'apple-mobile-web-app-title', content: 'SenTuấn' },
      ],
    },
  },
})
