import assert from 'node:assert/strict'
import {
  PublicSiteSchema,
  buildPublicSite,
  findPublicMenu,
  publicMenuLabel,
} from '../../tm-shared/packages/flow-contracts/src/site-public.js'
import { connectMongo } from '../../tm-web/server/utils/mongo.js'
import {
  PUBLIC_MENU_PROJECTION,
  PUBLIC_SETTINGS_PROJECTION,
  PublicSettingsModel,
  PublicSiteMenuModel,
  buildCategorySlugMap,
} from '../../tm-web/server/models/sitePublic.js'
import { PublicCategoryModel } from '../../tm-web/server/models/contentCategoryPublic.js'

/**
 * Live checks for the storefront's public site read path: the projections must
 * drop every admin field, and a menu must resolve to real paths per locale.
 */

const DB_NAME = 'tm_test_public_site'
const URI = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'

let checks = 0
let notRun = 0

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    checks++
    console.log(`   ✅ ${name}`)
  } catch (error) {
    console.error(`   ❌ ${name}`)
    console.error(`      ${(error as Error).message}`)
    process.exitCode = 1
  }
}

const settingsDoc = {
  siteId: 'sentuan',
  revision: 4,
  company: { name: 'Sen Tuấn', email: 'hello@sentuan.vn', phone: '0909', address: 'Hà Nội', logoMediaId: 'logo1' },
  seo: { titleTemplate: '%s | Sen Tuấn', defaultDescription: 'Trang sức', defaultImageMediaId: 'img1' },
  locales: { default: 'vi', enabled: ['vi', 'en'] },
  // Private fields that must never reach the storefront.
  modules: { content: true, catalog: false },
  updatedBy: { id: 'user_admin', name: 'Admin', email: 'admin@example.com' },
}

const menus = [
  {
    siteId: 'sentuan',
    key: 'main',
    name: 'Menu chính',
    revision: 3,
    items: [
      { label: { vi: 'Giới thiệu', en: 'About us' }, link: { type: 'content', target: 'gioi-thieu' } },
      { label: { vi: 'Trang sức', en: '' }, link: { type: 'category', target: 'trang-suc' } },
      { label: { vi: 'Liên hệ', en: 'Contact' }, link: { type: 'url', target: '/lien-he' } },
      { label: { vi: 'Nội bộ', en: '' }, link: { type: 'url', target: '/api/v1/admin/content' } },
    ],
  },
  { siteId: 'sentuan', key: 'footer', name: 'Menu chân trang', revision: 1, items: [] },
]

async function load(connection: Awaited<ReturnType<typeof connectMongo>>) {
  await connection.connection.dropDatabase()
  await connection.connection.collection('settings').insertOne({ ...settingsDoc })
  await connection.connection.collection('site_menus').insertMany(menus.map(menu => ({ ...menu })))
  await connection.connection.collection('categories').insertMany([
    { key: 'trang-suc', locales: [{ locale: 'vi', name: 'Trang sức', slug: 'trang-suc' }, { locale: 'en', name: 'Jewelry', slug: 'jewelry' }] },
    { key: 'phu-kien', locales: [{ locale: 'vi', name: 'Phụ kiện', slug: 'phu-kien' }] },
  ])
}

async function readSite(locale: string) {
  const [settings, menuDocs] = await Promise.all([
    PublicSettingsModel.findOne({}).select(PUBLIC_SETTINGS_PROJECTION).lean<Record<string, unknown> | null>(),
    PublicSiteMenuModel.find({}).select(PUBLIC_MENU_PROJECTION).sort({ key: 1 }).lean<Record<string, unknown>[]>(),
  ])

  const keys = new Set<string>()
  for (const menu of menuDocs) {
    for (const raw of (menu.items as { link?: { type?: string, target?: string } }[] | undefined) ?? []) {
      if (raw.link?.type === 'category' && raw.link.target) keys.add(raw.link.target)
    }
  }

  const categoryDocs = await PublicCategoryModel
    .find({ key: { $in: [...keys] } })
    .select('key locales')
    .lean<{ key?: string, locales?: unknown }[]>()

  return buildPublicSite({
    settings,
    menus: menuDocs,
    categorySlugs: buildCategorySlugMap(categoryDocs, locale),
  })
}

async function integration() {
  let connection
  try {
    connection = await connectMongo({ uri: URI, database: DB_NAME })
  } catch {
    notRun++
    console.log(`   ⚠️  NOT RUN — no MongoDB reachable at ${URI}`)
    return
  }

  try {
    await check('the settings projection drops modules, revision and actor', async () => {
      await load(connection)
      const doc = await PublicSettingsModel.findOne({}).select(PUBLIC_SETTINGS_PROJECTION).lean<Record<string, unknown>>()
      assert.ok(doc)
      assert.deepEqual(Object.keys(doc).sort(), ['_id', 'company', 'locales', 'seo'])
      assert.equal(doc.modules, undefined)
      assert.equal(doc.revision, undefined)
      assert.equal(doc.updatedBy, undefined)
      assert.equal((doc.company as { name: string }).name, 'Sen Tuấn')
    })

    await check('the menu projection keeps ordered items and drops site and revision', async () => {
      const docs = await PublicSiteMenuModel.find({}).select(PUBLIC_MENU_PROJECTION).sort({ key: 1 }).lean<Record<string, unknown>[]>()
      assert.deepEqual(docs.map(doc => doc.key), ['footer', 'main'])
      assert.deepEqual(Object.keys(docs[1]!).sort(), ['_id', 'items', 'key'])
      assert.equal((docs[1]!.items as unknown[]).length, 4)
      assert.equal(docs[0]!.items && (docs[0]!.items as unknown[]).length, 0)
    })

    await check('the header menu resolves to locale paths', async () => {
      const vi = await readSite('vi')
      const header = findPublicMenu(vi.menus, 'main')
      assert.ok(header)
      assert.deepEqual(header.items.map(item => `${publicMenuLabel(item.label, 'vi')} ${item.href}`), [
        'Giới thiệu /gioi-thieu',
        'Trang sức /danh-muc/trang-suc',
        'Liên hệ /lien-he',
        'Nội bộ /api/v1/admin/content',
      ])

      const en = await readSite('en')
      assert.deepEqual(findPublicMenu(en.menus, 'main')!.items.map(item => publicMenuLabel(item.label, 'en')), [
        'About us',
        'Trang sức',
        'Contact',
        'Nội bộ',
      ])
      assert.equal(findPublicMenu(en.menus, 'main')!.items[1]!.href, '/danh-muc/jewelry')
    })

    await check('a category with only a vi slug falls back instead of breaking', async () => {
      const map = buildCategorySlugMap(
        [{ key: 'phu-kien', locales: [{ locale: 'vi', name: 'Phụ kiện', slug: 'phu-kien' }] }],
        'en',
      )
      assert.equal(map.get('phu-kien'), 'phu-kien')
      assert.equal(buildCategorySlugMap([{ key: 'empty', locales: [] }], 'en').get('empty'), 'empty')
      assert.equal(buildCategorySlugMap([{ locales: [] }], 'en').size, 0)
    })

    await check('the assembled document matches the public contract', async () => {
      const site = await readSite('vi')
      const parsed = PublicSiteSchema.safeParse(site)
      assert.equal(parsed.success, true)
      assert.equal(site.company.email, 'hello@sentuan.vn')
      assert.equal(site.seo.titleTemplate, '%s | Sen Tuấn')
      assert.deepEqual(site.locales, { default: 'vi', enabled: ['vi', 'en'] })
      assert.equal(JSON.stringify(site).includes('admin@example.com'), false)
      assert.equal(JSON.stringify(site).includes('revision'), false)
    })

    await check('an empty database reads defaults rather than failing', async () => {
      await connection.connection.dropDatabase()
      const site = await readSite('vi')
      assert.equal(site.company.name, '')
      assert.equal(site.seo.titleTemplate, '%s')
      assert.deepEqual(site.menus, [])
      assert.equal(PublicSiteSchema.safeParse(site).success, true)
    })
  } finally {
    await connection.connection.dropDatabase().catch(() => undefined)
    await connection.disconnect()
  }
}

try {
  await integration()
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
}

console.log(`\n${checks} checks passed${notRun ? `, ${notRun} not run` : ''}`)
if (process.exitCode) {
  console.error('Public site checks failed')
}
