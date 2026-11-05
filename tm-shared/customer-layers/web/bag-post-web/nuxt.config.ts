export default defineNuxtConfig({
  app: {
    head: {
      title: 'Bag Post Logistics & Packaging',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/branding/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/branding/logo.svg' },
      ],
      meta: [
        { name: 'description', content: 'Giải pháp đóng gói & vận chuyển Bag Post' },
        { name: 'theme-color', content: '#10b981' },
        { property: 'og:type', content: 'website' },
        { property: 'og:title', content: 'Bag Post Logistics & Packaging' },
        { property: 'og:description', content: 'Giải pháp đóng gói & vận chuyển Bag Post' },
        { property: 'og:image', content: '/branding/og-cover.png' },
        { name: 'twitter:card', content: 'summary_large_image' },
      ],
    },
  },
})
