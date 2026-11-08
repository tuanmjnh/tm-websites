import assert from 'node:assert/strict'
import {
  SettingsServiceError,
  getSiteSettings,
  updateSiteSettings,
} from '../../tm-cms/server/services/settingsService.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'

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

function isSettingsError(status: number, code: string) {
  return (error: unknown) => error instanceof SettingsServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ADMIN = { id: 'user_admin', name: 'Quản trị A', email: 'admin@example.com' }
const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_settings_service' }

async function integration() {
  let connection
  try {
    connection = await connectDatabase(binding)
  } catch {
    notRun++
    console.log(`   ⚠️  NOT RUN — no MongoDB reachable at ${URI}`)
    return
  }

  try {
    await connection.db!.dropDatabase()
    const { Settings, Audit } = await prepareDatabase(connection)
    const meta = { audit: { model: Audit, actor: ADMIN, requestId: 'req_settings' } }

    await check('an unsaved site reads the defaults at revision 0', async () => {
      const settings = await getSiteSettings(Settings, SITE)
      assert.equal(settings.siteId, SITE)
      assert.equal(settings.revision, 0)
      assert.equal(settings.locales.default, 'vi')
      assert.deepEqual(settings.locales.enabled, ['vi'])
      assert.equal(settings.modules.content, true)
      assert.equal(settings.modules.catalog, false)
      assert.equal(settings.updatedAt, null)
      assert.equal(settings.updatedBy, null)
    })

    await check('the first save bumps to revision 1 and records one audit entry', async () => {
      const saved = await updateSiteSettings(Settings, SITE, {
        revision: 0,
        company: { name: 'Thành Tùng', email: 'hello@thanhtung.vn' },
        locales: { default: 'en', enabled: ['en', 'vi'] },
        modules: { catalog: true },
      }, meta)

      assert.equal(saved.revision, 1)
      assert.equal(saved.company.name, 'Thành Tùng')
      assert.deepEqual(saved.locales.enabled, ['vi', 'en'], 'enabled locales follow the canonical order')
      assert.equal(saved.locales.default, 'en')
      assert.equal(saved.modules.catalog, true)
      assert.deepEqual(saved.updatedBy, ADMIN)
      assert.ok(saved.updatedAt)

      const entries = await Audit.find({ siteId: SITE }).lean()
      assert.equal(entries.length, 1)
      assert.equal(entries[0]!.resourceType, 'settings')
      assert.equal(entries[0]!.resourceKey, 'site-settings')
      assert.equal(entries[0]!.revision, 1)
      assert.deepEqual(entries[0]!.changedFields.sort(), ['company', 'locales', 'modules'])
      assert.deepEqual(entries[0]!.actor, ADMIN)
      assert.equal(entries[0]!.requestId, 'req_settings')
    })

    await check('partial patches merge and never drop untouched sections', async () => {
      const saved = await updateSiteSettings(Settings, SITE, {
        revision: 1,
        company: { phone: '0909 000 111' },
        seo: { defaultDescription: 'Đồ gia dụng cho mọi nhà' },
      }, meta)
      assert.equal(saved.revision, 2)
      assert.equal(saved.company.name, 'Thành Tùng', 'the earlier name survives a phone-only patch')
      assert.equal(saved.company.phone, '0909 000 111')
      assert.equal(saved.seo.defaultDescription, 'Đồ gia dụng cho mọi nhà')
      assert.equal(saved.seo.titleTemplate, '%s')
      assert.equal(await Audit.countDocuments({ siteId: SITE }), 2)
    })

    await check('a stale revision is refused and writes nothing', async () => {
      await assert.rejects(
        () => updateSiteSettings(Settings, SITE, { revision: 1, company: { name: 'Stale' } }, meta),
        isSettingsError(409, 'SETTINGS_REVISION_CONFLICT'),
      )
      const current = await getSiteSettings(Settings, SITE)
      assert.equal(current.revision, 2)
      assert.equal(current.company.name, 'Thành Tùng')
      assert.equal(await Audit.countDocuments({ siteId: SITE }), 2)
    })

    await check('an empty patch is refused', async () => {
      await assert.rejects(
        () => updateSiteSettings(Settings, SITE, { revision: 2, company: { name: 'Thành Tùng' } }, meta),
        isSettingsError(422, 'SETTINGS_UPDATE_UNCHANGED'),
      )
    })

    await check('locales must keep the default among the enabled ones', async () => {
      await assert.rejects(
        () => updateSiteSettings(Settings, SITE, { revision: 2, locales: { enabled: ['vi'] } }, meta),
        isSettingsError(422, 'SETTINGS_LOCALES_INVALID'),
      )
      await assert.rejects(
        () => updateSiteSettings(Settings, SITE, { revision: 2, locales: { default: 'vi', enabled: [] } }, meta),
        isSettingsError(422, 'SETTINGS_PAYLOAD_INVALID'),
        'an empty enabled list is refused by the payload schema',
      )
      const current = await getSiteSettings(Settings, SITE)
      assert.equal(current.revision, 2)
    })

    await check('payload validation rejects a bad email and an unknown locale', async () => {
      await assert.rejects(
        () => updateSiteSettings(Settings, SITE, { revision: 2, company: { email: 'not-an-email' } }, meta),
        isSettingsError(422, 'SETTINGS_PAYLOAD_INVALID'),
      )
      await assert.rejects(
        () => updateSiteSettings(Settings, SITE, { revision: 2, locales: { default: 'fr' } }, meta),
        isSettingsError(422, 'SETTINGS_PAYLOAD_INVALID'),
      )
    })

    await check('another site keeps its own defaults and document', async () => {
      const other = await getSiteSettings(Settings, OTHER_SITE)
      assert.equal(other.revision, 0)
      assert.equal(other.company.name, '')

      const saved = await updateSiteSettings(Settings, OTHER_SITE, { revision: 0, company: { name: 'Bạg Post' } }, meta)
      assert.equal(saved.revision, 1)
      assert.equal((await getSiteSettings(Settings, SITE)).company.name, 'Thành Tùng')
      assert.equal(await Settings.countDocuments({}), 2)
      assert.equal(await Audit.countDocuments({ siteId: OTHER_SITE }), 1)
    })
  } finally {
    await closeDatabaseConnections()
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
  console.error('Settings checks failed')
}
