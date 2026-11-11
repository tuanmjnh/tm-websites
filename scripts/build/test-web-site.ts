import assert from 'node:assert/strict'
import {
  PUBLIC_MENU_FOOTER,
  PUBLIC_MENU_HEADER,
  PublicSiteSchema,
  buildPublicSite,
  emptyPublicSite,
  findPublicMenu,
  publicMenuHref,
  publicMenuLabel,
  toPublicMenu,
} from '../../tm-shared/packages/flow-contracts/src/site-public.js'
import { applySeoTitleTemplate, buildBreadcrumbJsonLd } from '../../tm-shared/packages/flow-utils/src/seo.js'

let checks = 0

function check(name: string, fn: () => void) {
  try {
    fn()
    checks++
    console.log(`   ✅ ${name}`)
  } catch (error) {
    console.error(`   ❌ ${name}`)
    console.error(`      ${(error as Error).message}`)
    process.exitCode = 1
  }
}

const settings = {
  siteId: 'sentuan',
  revision: 4,
  company: {
    name: 'Sen Tuấn',
    legalName: 'Công ty Sen Tuấn',
    taxId: '0101',
    email: 'hello@sentuan.vn',
    phone: '0909',
    address: 'Hà Nội',
    logoMediaId: 'logo1',
  },
  seo: { titleTemplate: '%s | Sen Tuấn', defaultDescription: 'Trang sức', defaultImageMediaId: 'img1' },
  locales: { default: 'vi', enabled: ['vi', 'en'] },
  // Private fields the projection must drop.
  modules: { content: true, catalog: false },
  updatedBy: { id: 'user_admin', name: 'Admin', email: 'admin@example.com' },
}

const mainMenu = {
  siteId: 'sentuan',
  key: 'main',
  name: 'Menu chính',
  revision: 3,
  items: [
    { label: { vi: 'Giới thiệu', en: 'About us' }, link: { type: 'content', target: 'gioi-thieu' } },
    { label: { vi: 'Trang sức', en: '' }, link: { type: 'category', target: 'trang-suc' } },
    { label: { vi: 'Liên hệ', en: 'Contact' }, link: { type: 'url', target: '/lien-he' } },
    { label: { vi: 'Nội bộ', en: '' }, link: { type: 'url', target: '/api/v1/admin/content' } },
    { label: { vi: '', en: '' }, link: { type: 'url', target: '/khong-nhan' } },
    { label: { vi: 'Hỏng' }, link: { type: 'url', target: 'javascript:alert(1)' } },
  ],
}

check('a content key becomes the catch-all path, folders included', () => {
  assert.equal(publicMenuHref({ type: 'content', target: 'gioi-thieu' }), '/gioi-thieu')
  assert.equal(publicMenuHref({ type: 'content', target: 'pages/dich-vu' }), '/dich-vu')
  assert.equal(publicMenuHref({ type: 'content', target: '  ' }), null)
})

check('a category uses the resolved locale slug, then the key', () => {
  assert.equal(publicMenuHref({ type: 'category', target: 'trang-suc' }, 'trang-suc-vn'), '/danh-muc/trang-suc-vn')
  assert.equal(publicMenuHref({ type: 'category', target: 'trang-suc' }), '/danh-muc/trang-suc')
  assert.equal(publicMenuHref({ type: 'category', target: 'a/b' }, null), '/danh-muc/b')
})

check('url targets keep rooted paths and absolute links only', () => {
  assert.equal(publicMenuHref({ type: 'url', target: '/lien-he' }), '/lien-he')
  assert.equal(publicMenuHref({ type: 'url', target: 'https://example.com/x' }), 'https://example.com/x')
  assert.equal(publicMenuHref({ type: 'url', target: '//evil.example' }), null)
  assert.equal(publicMenuHref({ type: 'url', target: 'lien-he' }), null)
  assert.equal(publicMenuHref({ type: 'url', target: 'javascript:alert(1)' }), null)
  assert.equal(publicMenuHref({ type: 'search', target: '/x' }), null)
})

check('labels fall back from the locale to vi then en', () => {
  assert.equal(publicMenuLabel({ vi: 'Giới thiệu', en: 'About us' }, 'en'), 'About us')
  assert.equal(publicMenuLabel({ vi: 'Giới thiệu', en: '' }, 'en'), 'Giới thiệu')
  assert.equal(publicMenuLabel({ vi: '', en: 'About us' }, 'vi'), 'About us')
  assert.equal(publicMenuLabel({ vi: '', en: '' }, 'vi'), '')
})

check('a stored menu drops unusable items and keeps the rest in order', () => {
  const menu = toPublicMenu(mainMenu, () => 'trang-suc')
  assert.ok(menu)
  assert.equal(menu.key, 'main')
  assert.deepEqual(menu.items.map(item => item.href), ['/gioi-thieu', '/danh-muc/trang-suc', '/lien-he', '/api/v1/admin/content'])
  assert.equal(menu.items.length, 4, 'the empty-label item and the unrooted target are dropped')
  assert.equal(toPublicMenu({ ...mainMenu, key: '' }), null)
})

check('the projection exposes the public allowlist only', () => {
  const site = buildPublicSite({ settings, menus: [mainMenu, { key: 'footer', items: [] }] })

  assert.equal(site.company.name, 'Sen Tuấn')
  assert.equal(site.company.legalName, undefined, 'the legal name is not part of the projection yet')
  assert.equal(site.company.logoMediaId, 'logo1')
  assert.equal(site.seo.titleTemplate, '%s | Sen Tuấn')
  assert.deepEqual(site.locales, { default: 'vi', enabled: ['vi', 'en'] })
  assert.deepEqual(Object.keys(site).sort(), ['company', 'locales', 'menus', 'seo'])
  assert.equal((site as Record<string, unknown>).modules, undefined)
  assert.equal((site as Record<string, unknown>).revision, undefined)
  assert.equal((site as Record<string, unknown>).updatedBy, undefined)
  assert.equal(PublicSiteSchema.safeParse(site).success, true)
})

check('locale title templates are published for enabled locales only', () => {
  const site = buildPublicSite({
    settings: {
      ...settings,
      seo: { ...settings.seo, titleTemplates: { vi: '  %s · Sen Tuấn  ', en: '', fr: '%s | X' } },
    },
    menus: [],
  })
  assert.deepEqual(site.seo.titleTemplates, { vi: '%s · Sen Tuấn' }, 'empty and not-enabled locales are dropped')
  assert.equal(PublicSiteSchema.safeParse(site).success, true)

  const plain = buildPublicSite({ settings, menus: [] })
  assert.deepEqual(plain.seo.titleTemplates, {}, 'a site without overrides publishes an empty map')
})

check('menus keep both keys, sorted, and an empty menu survives', () => {
  const site = buildPublicSite({ settings, menus: [mainMenu, { key: 'footer', items: [] }, { key: 'zzz' }] })
  assert.deepEqual(site.menus.map(menu => menu.key), ['footer', 'main', 'zzz'])
  assert.deepEqual(findPublicMenu(site.menus, PUBLIC_MENU_HEADER)?.items.length, 4)
  assert.equal(findPublicMenu(site.menus, PUBLIC_MENU_FOOTER)?.items.length, 0)
  assert.equal(findPublicMenu(site.menus, 'missing'), null)
})

check('a site without a settings document reads the defaults', () => {
  const site = buildPublicSite({ settings: null, menus: [] })
  assert.deepEqual(site.company, emptyPublicSite().company)
  assert.equal(site.seo.titleTemplate, '%s')
  assert.deepEqual(site.locales.enabled, ['vi'])
  assert.deepEqual(site.menus, [])
  assert.equal(PublicSiteSchema.safeParse(site).success, true)
})

check('a partially written settings document never yields empty arrays or nulls', () => {
  const site = buildPublicSite({
    settings: { company: { name: 'Sen Tuấn' }, locales: { enabled: 'vi' } },
    menus: [{ key: 'main', items: 'nope' }],
  })
  assert.equal(site.company.name, 'Sen Tuấn')
  assert.deepEqual(site.locales.enabled, ['vi'])
  assert.equal(site.locales.default, 'vi')
  assert.deepEqual(site.menus, [{ key: 'main', items: [] }])
})

check('a page title is rendered through the template saved in settings', () => {
  assert.equal(applySeoTitleTemplate('Trang sức', '%s | Sen Tuấn'), 'Trang sức | Sen Tuấn')
  assert.equal(applySeoTitleTemplate('Trang sức', '%s'), 'Trang sức')
  assert.equal(applySeoTitleTemplate('Trang sức', ''), 'Trang sức')
  assert.equal(applySeoTitleTemplate('  Trang sức  ', '  '), 'Trang sức')
  assert.equal(applySeoTitleTemplate('Trang sức', 'Sen Tuấn'), 'Trang sức | Sen Tuấn')
  assert.equal(applySeoTitleTemplate('', '%s | Sen Tuấn'), 'Sen Tuấn', 'an empty page title leaves no dangling separator')
  assert.equal(applySeoTitleTemplate('', ''), '')
  assert.equal(applySeoTitleTemplate('Sen Tuấn', '%s · Sen Tuấn'), 'Sen Tuấn', 'the brand is not repeated on the home page')
  assert.equal(applySeoTitleTemplate('Giới thiệu Sen Tuấn', '%s | Sen Tuấn'), 'Giới thiệu Sen Tuấn', 'a title that already names the brand keeps its wording')
  assert.equal(applySeoTitleTemplate('Sen Tuấn', 'Sen Tuấn | %s'), 'Sen Tuấn')
})

check('a breadcrumb trail becomes BreadcrumbList data with absolute steps', () => {
  const data = buildBreadcrumbJsonLd('https://shop.test/', [
    { name: '  Trang chủ  ', path: '/' },
    { name: 'Sản phẩm', path: '/products' },
    { name: 'Nhẫn bạc', path: '/products/nhan-bac' },
  ])
  assert.equal(data?.['@type'], 'BreadcrumbList')
  assert.deepEqual((data?.itemListElement as any[]).map(step => [step.position, step.name, step.item]), [
    [1, 'Trang chủ', 'https://shop.test/'],
    [2, 'Sản phẩm', 'https://shop.test/products'],
    [3, 'Nhẫn bạc', 'https://shop.test/products/nhan-bac'],
  ])
  assert.deepEqual((data?.itemListElement as any[])[2]['@type'], 'ListItem')
})

check('a breadcrumb drops unlabelled and repeated steps, and needs two', () => {
  const data = buildBreadcrumbJsonLd('https://shop.test', [
    { name: 'Trang chủ', path: '/' },
    { name: '   ', path: '/products' },
    { name: 'Nhẫn bạc', path: '/products/nhan-bac' },
    { name: 'Nhẫn bạc nữa', path: '/products/nhan-bac' },
  ])
  assert.deepEqual((data?.itemListElement as any[]).map(step => step.name), ['Trang chủ', 'Nhẫn bạc'])
  assert.equal(buildBreadcrumbJsonLd('https://shop.test', [{ name: 'Trang chủ', path: '/' }]), null)
  assert.equal(buildBreadcrumbJsonLd('https://shop.test', []), null)
})

check('a step that is already an absolute URL is not prefixed twice', () => {
  const data = buildBreadcrumbJsonLd('https://shop.test', [
    { name: 'Trang chủ', path: '/' },
    { name: 'Giới thiệu', path: 'https://shop.test/gioi-thieu' },
  ])
  assert.equal((data?.itemListElement as any[])[1].item, 'https://shop.test/gioi-thieu')
})

check('category slug overrides are applied per menu item', () => {
  const site = buildPublicSite({
    settings,
    menus: [mainMenu],
    categorySlugs: new Map([['trang-suc', 'jewelry']]),
  })
  assert.equal(site.menus[0]!.items[1]!.href, '/danh-muc/jewelry')

  const plain = buildPublicSite({ settings, menus: [mainMenu], categorySlugs: { 'trang-suc': 'do-trang-suc' } })
  assert.equal(plain.menus[0]!.items[1]!.href, '/danh-muc/do-trang-suc')
})

console.log(`\n${checks} checks passed`)
if (process.exitCode) {
  console.error('Web site projection checks failed')
}
