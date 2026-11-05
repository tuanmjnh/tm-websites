export default defineNuxtConfig({
  app: {
    head: {
      title: 'TM Enterprise CMS',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/branding/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/branding/icon-192.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
      meta: [
        { name: 'description', content: 'TM Enterprise administration suite' },
        { name: 'theme-color', content: '#8b5cf6' },
        { name: 'apple-mobile-web-app-title', content: 'TM CMS' },
      ],
    },
  },
})
