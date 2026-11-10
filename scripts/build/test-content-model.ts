import assert from 'node:assert/strict'
import {
  CONTENT_SCHEMA_VERSION,
  ContentInvariantError,
  applyContentTransition,
  isPubliclyVisible,
  normalizeContentInput,
  normalizeSlug,
  toPublicContent,
} from '../../tm-cms/server/models/content.js'
import type { ContentRevisionState } from '../../tm-cms/server/models/content.js'
import { MIGRATIONS, planMigrations, readAppliedMigrations } from '../../tm-cms/server/models/migrations.js'
import { connectDatabase, closeDatabaseConnections } from '../../tm-cms/server/utils/database.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'

let checks = 0
let notRun = 0

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

function hasInvariant(code: string) {
  return (error: unknown) => error instanceof ContentInvariantError && error.code === code
}

const NOW = new Date('2026-11-06T10:00:00.000Z')

function state(overrides: Partial<ContentRevisionState> = {}): ContentRevisionState {
  return {
    status: 'draft',
    locales: [{ locale: 'vi', slug: 'trang-chu', title: 'Trang chủ', excerpt: '', body: '', seo: { title: '', description: '', image: '' } }],
    publishAt: null,
    unpublishAt: null,
    publishedAt: null,
    deletedAt: null,
    revision: 1,
    ...overrides,
  }
}

console.log('Content — model, invariants and migrations\n')

console.log('   Normalization (pure)')

check('slugs fold case, diacritics and punctuation', () => {
  assert.equal(normalizeSlug('  Sen Tuấn – Trang Chủ  '), 'sen-tuan-trang-chu')
  assert.equal(normalizeSlug('Đá Quý & Trang Sức'), 'da-quy-trang-suc')
  assert.equal(normalizeSlug('---'), '')
  assert.equal(normalizeSlug('a'.repeat(300)).length, 120)
})

check('a normalized payload is validated with defaults and de-duplicated lists', () => {
  const draft = normalizeContentInput({
    siteId: 'sentuan',
    type: 'page',
    key: '  pages/about  ',
    locales: [{ locale: 'vi', title: 'Giới thiệu', body: 'Nội dung' }],
    tags: ['bạc', 'bạc', ' ', 'vàng'],
    publishAt: '2026-11-07T00:00:00.000Z',
  })

  assert.equal(draft.key, 'pages/about')
  assert.equal(draft.locales[0]!.slug, 'gioi-thieu')
  assert.deepEqual(draft.tags, ['bạc', 'vàng'])
  assert.deepEqual(draft.categories, [])
  assert.equal(draft.locales[0]!.seo.title, '')
  assert.equal(draft.publishAt?.toISOString(), '2026-11-07T00:00:00.000Z')
})

check('server-controlled fields in a client payload are dropped', () => {
  const draft = normalizeContentInput({
    siteId: 'sentuan',
    type: 'page',
    key: 'pages/spoof',
    locales: [{ locale: 'vi', title: 'Spoof', slug: 'spoof' }],
    status: 'published',
    revision: 99,
    publishedAt: '2020-01-01T00:00:00.000Z',
    deletedAt: '2020-01-01T00:00:00.000Z',
  }) as Record<string, unknown>

  assert.equal('status' in draft, false)
  assert.equal('revision' in draft, false)
  assert.equal('publishedAt' in draft, false)
  assert.equal('deletedAt' in draft, false)
})

check('unsafe content keys are rejected', () => {
  const base = { siteId: 'sentuan', type: 'page', locales: [{ locale: 'vi', title: 'X' }] }
  assert.throws(() => normalizeContentInput({ ...base, key: '../secrets' }), hasInvariant('CONTENT_KEY_INVALID'))
  assert.throws(() => normalizeContentInput({ ...base, key: '' }), hasInvariant('CONTENT_KEY_INVALID'))
  assert.throws(() => normalizeContentInput({ ...base, key: 'a'.repeat(201) }), hasInvariant('CONTENT_KEY_INVALID'))
})

check('the same locale twice is rejected', () => {
  assert.throws(() => normalizeContentInput({
    siteId: 'sentuan',
    type: 'page',
    key: 'pages/dup',
    locales: [
      { locale: 'vi', title: 'Một', slug: 'mot' },
      { locale: 'vi', title: 'Hai', slug: 'hai' },
    ],
  }))
})

check('an inverted publish window is rejected', () => {
  assert.throws(() => normalizeContentInput({
    siteId: 'sentuan',
    type: 'page',
    key: 'pages/window',
    locales: [{ locale: 'vi', title: 'Cửa sổ', slug: 'cua-so' }],
    publishAt: '2026-11-07T00:00:00.000Z',
    unpublishAt: '2026-11-06T00:00:00.000Z',
  }))
})

console.log('\n   Publication invariants (pure)')

check('publishing a draft stamps publishedAt and bumps the revision', () => {
  const next = applyContentTransition(state(), 'publish', NOW)
  assert.equal(next.status, 'published')
  assert.deepEqual(next.publishedAt, NOW)
  assert.equal(next.revision, 2)
})

check('publishing without a titled locale is rejected', () => {
  assert.throws(
    () => applyContentTransition(state({ locales: [] }), 'publish', NOW),
    hasInvariant('CONTENT_LOCALE_REQUIRED'),
  )
})

check('publishing ahead of publishAt is rejected', () => {
  assert.throws(
    () => applyContentTransition(state({ publishAt: new Date('2026-12-01T00:00:00.000Z') }), 'publish', NOW),
    hasInvariant('CONTENT_PUBLISH_AT_FUTURE'),
  )
})

check('scheduling requires a publish date', () => {
  assert.throws(() => applyContentTransition(state(), 'schedule', NOW), hasInvariant('CONTENT_PUBLISH_AT_REQUIRED'))
  const scheduled = applyContentTransition(state({ publishAt: new Date('2026-12-01T00:00:00.000Z') }), 'schedule', NOW)
  assert.equal(scheduled.status, 'scheduled')
  assert.equal(scheduled.publishedAt, null)
})

check('unpublishing clears publishedAt but keeps the record', () => {
  const published = applyContentTransition(state(), 'publish', NOW)
  const draft = applyContentTransition(published, 'unpublish', NOW)
  assert.equal(draft.status, 'draft')
  assert.equal(draft.publishedAt, null)
  assert.equal(draft.deletedAt, null)
  assert.equal(draft.revision, 3)
})

check('archive and restore go through draft, never straight back to public', () => {
  const archived = applyContentTransition(state(), 'archive', NOW)
  assert.equal(archived.status, 'archived')
  assert.throws(() => applyContentTransition(archived, 'publish', NOW), hasInvariant('CONTENT_TRANSITION_INVALID'))

  const restored = applyContentTransition(archived, 'restore', NOW)
  assert.equal(restored.status, 'draft')
})

check('deleting is recoverable and drops public visibility', () => {
  const published = applyContentTransition(state(), 'publish', NOW)
  const deleted = applyContentTransition(published, 'delete', NOW)
  assert.equal(deleted.status, 'deleted')
  assert.equal(deleted.publishedAt, null)
  assert.deepEqual(deleted.deletedAt, NOW)
  assert.throws(() => applyContentTransition(deleted, 'publish', NOW), hasInvariant('CONTENT_TRANSITION_INVALID'))

  const restored = applyContentTransition(deleted, 'restore', NOW)
  assert.equal(restored.status, 'draft')
  assert.equal(restored.deletedAt, null)
})

console.log('\n   Public projection (pure)')

check('only published records inside their window are visible', () => {
  assert.equal(isPubliclyVisible(state(), NOW), false)
  assert.equal(isPubliclyVisible(state({ status: 'scheduled', publishAt: NOW }), NOW), false)
  assert.equal(isPubliclyVisible(state({ status: 'published', publishedAt: NOW }), NOW), true)
  assert.equal(isPubliclyVisible(state({ status: 'published', publishAt: new Date('2026-12-01T00:00:00.000Z') }), NOW), false)
  assert.equal(isPubliclyVisible(state({ status: 'published', unpublishAt: new Date('2026-11-01T00:00:00.000Z') }), NOW), false)
  assert.equal(isPubliclyVisible(state({ status: 'published', deletedAt: NOW }), NOW), false)
})

check('the public projection is an allowlist with no internal fields', () => {
  const record = {
    ...state({ status: 'published', publishedAt: NOW }),
    key: 'pages/about',
    type: 'page' as const,
    updatedAt: NOW,
  }

  assert.equal(toPublicContent(record, 'en', NOW), null)

  const projected = toPublicContent(record, 'vi', NOW)
  assert.ok(projected)
  assert.deepEqual(Object.keys(projected).sort(), [
    'body',
    'excerpt',
    'format',
    'key',
    'keywords',
    'locale',
    'publishedAt',
    'seo',
    'slug',
    'title',
    'type',
    'updatedAt',
  ])
  assert.equal(projected.publishedAt, NOW.toISOString())
  assert.equal('status' in projected, false)
  assert.equal('revision' in projected, false)

  const draft = { ...record, ...state() }
  assert.equal(toPublicContent(draft, 'vi', NOW), null)
})

console.log('\n   Migration planning (pure)')

const appliedAll = MIGRATIONS.map(migration => ({
  id: migration.id,
  version: migration.version,
  checksum: migration.checksum,
  appliedAt: NOW,
}))
const appliedFirst = appliedAll[0]!

check('a fresh database runs every migration in version order', () => {
  const plan = planMigrations([], MIGRATIONS)
  assert.deepEqual(plan.conflicts, [])
  assert.deepEqual(plan.pending.map(migration => migration.id), [...MIGRATIONS].sort((a, b) => a.version - b.version).map(migration => migration.id))
})

check('an applied migration is skipped when its checksum matches', () => {
  const plan = planMigrations(appliedAll, MIGRATIONS)
  assert.equal(plan.pending.length, 0)
  assert.deepEqual(plan.conflicts, [])
})

check('a changed body under an applied id is a conflict, not a re-run', () => {
  const plan = planMigrations([{ ...appliedFirst, checksum: 'stale' }, ...appliedAll.slice(1)], MIGRATIONS)
  assert.equal(plan.pending.length, 0)
  assert.equal(plan.conflicts.length, 1)
})

check('a migration numbered below an applied version is a conflict', () => {
  const plan = planMigrations(
    [{ id: 'later', version: 5, checksum: 'later@5', appliedAt: NOW }],
    [{ id: 'earlier', version: 2, checksum: 'earlier@2', apply: async () => {} }],
  )
  assert.equal(plan.pending.length, 0)
  assert.equal(plan.conflicts.length, 1)
})

console.log('\n   Prepared database (live MongoDB)')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_content' }

function contentFixture(key: string, slug: string) {
  const draft = normalizeContentInput({
    siteId: 'sentuan',
    type: 'page',
    key,
    locales: [{ locale: 'vi', title: slug.replace(/-/g, ' '), slug }],
  })
  return { ...draft, status: 'draft' as const, revision: 1, schemaVersion: CONTENT_SCHEMA_VERSION }
}

async function integration() {
  let connection
  try {
    connection = await connectDatabase(binding)
  } catch {
    notRun++
    console.log(`   ⚠️  NOT RUN — no MongoDB reachable at ${URI}`)
    console.log('      Start a local MongoDB and re-run `pnpm test:content`.')
    return
  }

  try {
    await connection.db!.dropDatabase()

    const models = await prepareDatabase(connection, NOW)
    checks++
    console.log('   ✅ prepareDatabase registers models and creates the content indexes')

    const indexNames = (await models.Content.collection.indexes()).map(index => index.name)
    assert.ok(indexNames.includes('content_site_key'))
    assert.ok(indexNames.includes('content_site_locale_slug'))
    assert.ok(indexNames.includes('content_site_status_published'))
    checks++
    console.log('   ✅ the declared unique and query indexes exist')

    await models.Content.create(contentFixture('pages/about', 'gioi-thieu'))

    await assert.rejects(
      () => models.Content.create(contentFixture('pages/about', 'gioi-thieu-khac')),
      (error: { code?: number }) => error.code === 11000,
      'a duplicate (siteId, key) must be rejected by the unique index',
    )
    checks++
    console.log('   ✅ a duplicate content key is rejected by the database')

    await assert.rejects(
      () => models.Content.create(contentFixture('pages/contact', 'gioi-thieu')),
      (error: { code?: number }) => error.code === 11000,
      'a duplicate (siteId, locale, slug) must be rejected by the unique index',
    )
    checks++
    console.log('   ✅ a duplicate locale slug is rejected by the database')

    const appliedAfterFirstRun = await readAppliedMigrations(connection)
    assert.equal(appliedAfterFirstRun.length, MIGRATIONS.length)
    assert.deepEqual(
      appliedAfterFirstRun.map(entry => entry.id),
      MIGRATIONS.map(migration => migration.id),
      'every declared migration must be recorded',
    )
    for (const record of appliedAfterFirstRun) {
      const declared = MIGRATIONS.find(migration => migration.id === record.id)!
      assert.equal(record.version, declared.version)
      assert.equal(record.checksum, declared.checksum)
      assert.deepEqual(record.appliedAt, NOW)
    }
    checks++
    console.log('   ✅ the migration record stores id, version, checksum and timestamp')

    const second = await prepareDatabase(connection, new Date('2026-11-08T00:00:00.000Z'))
    const appliedAfterSecondRun = await readAppliedMigrations(connection)
    assert.equal(appliedAfterSecondRun.length, MIGRATIONS.length)
    assert.deepEqual(appliedAfterSecondRun[0]!.appliedAt, NOW, 'a re-run must not rewrite the applied timestamp')
    assert.equal(await second.Content.countDocuments({}), 1, 'the rejected duplicates must not have been stored')
    checks++
    console.log('   ✅ preparing twice is idempotent and keeps the existing records')
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} Content checks: ${checks} passed, ${notRun} not run\n`)
