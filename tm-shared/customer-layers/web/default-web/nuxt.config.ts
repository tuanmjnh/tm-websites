export default defineNuxtConfig({
  app: {
    head: {
      title: 'TM Enterprise Storefront',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/branding/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/branding/logo.svg' },
      ],
      meta: [
        { name: 'description', content: 'TM Enterprise public storefront' },
        { name: 'theme-color', content: '#8b5cf6' },
        { property: 'og:type', content: 'website' },
        { property: 'og:title', content: 'TM Enterprise Storefront' },
        { property: 'og:description', content: 'TM Enterprise public storefront' },
        { property: 'og:image', content: '/branding/og-cover.png' },
        { name: 'twitter:card', content: 'summary_large_image' },
      ],
    },
  },
})
