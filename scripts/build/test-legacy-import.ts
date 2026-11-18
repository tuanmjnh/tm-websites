import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  asLegacyRecord,
  legacyAttributeList,
  legacyCatalogStatus,
  legacyContentAttributes,
  legacyContentStatus,
  legacyDate,
  legacyImageList,
  legacyImageUrl,
  legacyKeywords,
  legacyLocalized,
  legacyNumber,
  legacySlugMap,
  legacyTags,
  legacyText,
} from '../../tm-cms/server/utils/legacyImport.js'

/**
 * The legacy importers are the one place where a wrong field rule does not fail:
 * it just writes less data. `migrate:catalog` shipped that way and dropped all
 * 230 tagged items, and `migrate-content` kept `legacy.thumbnail` only when it
 * was a string while 7 of `bag-post`'s 18 records store `{ url }`. So the rules
 * are pure, shared, and checked here — including that the two CLIs use them
 * instead of declaring their own copy again.
 */

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

check('asLegacyRecord only accepts plain objects', () => {
  assert.deepEqual(asLegacyRecord({ a: 1 }), { a: 1 })
  assert.deepEqual(asLegacyRecord([1, 2]), {})
  assert.deepEqual(asLegacyRecord('x'), {})
  assert.deepEqual(asLegacyRecord(null), {})
})

check('legacyText trims a string and ignores anything else', () => {
  assert.equal(legacyText('  hi  '), 'hi')
  assert.equal(legacyText(5), '')
  assert.equal(legacyText({ title: 'x' }), '')
  assert.equal(legacyText(undefined), '')
})

check('legacyLocalized drops blanks, caps length and the locale key', () => {
  assert.deepEqual(legacyLocalized({ vi: ' Xin chào ', en: '   ', fr: 42 }, 4), { vi: 'Xin ' })
  assert.deepEqual(legacyLocalized({ 'vietnamese-long': 'a' }), { vietnamese: 'a' })
  assert.deepEqual(legacyLocalized('not a map'), {})
})

check('legacySlugMap lower-cases and drops empty slugs', () => {
  assert.deepEqual(legacySlugMap({ vi: 'Trang-Suc', en: '' }), { vi: 'trang-suc' })
  assert.deepEqual(legacySlugMap(null), {})
})

check('legacyNumber falls back on a non-finite value', () => {
  assert.equal(legacyNumber('12'), 12)
  assert.equal(legacyNumber('abc', 7), 7)
  assert.equal(legacyNumber(undefined), 0)
  assert.equal(legacyNumber(null, -1), 0)
})

check('legacyDate rejects an unparsable value and passes a Date through', () => {
  const now = new Date('2026-11-18T00:00:00.000Z')
  assert.equal(legacyDate(now), now)
  assert.equal(legacyDate('2026-11-18T00:00:00.000Z')?.toISOString(), now.toISOString())
  assert.equal(legacyDate('not a date'), null)
  assert.equal(legacyDate(''), null)
})

check('legacyTags keeps `{ title }` documents — the CAT-01 regression', () => {
  assert.deepEqual(
    legacyTags([{ title: 'furniture', slug: 'furniture' }, { title: 'interior', slug: 'interior' }]),
    ['furniture', 'interior'],
  )
})

check('legacyTags accepts a plain string, `{ name }` and skips a slug-only entry', () => {
  assert.deepEqual(legacyTags([' plain ', { name: 'named' }, { slug: 'slug-only' }]), ['plain', 'named'])
})

check('legacyTags dedupes, caps each tag at 60 and the list at 50', () => {
  assert.deepEqual(legacyTags([{ title: 'a' }, 'a', { title: 'a' }]), ['a'])
  assert.equal(legacyTags(['x'.repeat(80)])[0]!.length, 60)
  const many = Array.from({ length: 60 }, (_, index) => `tag-${index}`)
  assert.equal(legacyTags(many).length, 50)
  assert.deepEqual(legacyTags('not an array'), [])
})

check('legacyKeywords caps each keyword at 60 and the list at 20', () => {
  assert.equal(legacyKeywords(['y'.repeat(80)])[0]!.length, 60)
  assert.equal(legacyKeywords(Array.from({ length: 30 }, (_, index) => `k${index}`)).length, 20)
  assert.deepEqual(legacyKeywords(['  ', 'ok']), ['ok'])
})

check('legacyImageUrl reads a string and the three storage shapes', () => {
  assert.equal(legacyImageUrl(' https://cdn/x.png '), 'https://cdn/x.png')
  assert.equal(legacyImageUrl({ url: 'https://cdn/url.png' }), 'https://cdn/url.png')
  assert.equal(legacyImageUrl({ secure_url: 'https://cdn/secure.png' }), 'https://cdn/secure.png')
  assert.equal(legacyImageUrl({ src: 'https://cdn/src.png' }), 'https://cdn/src.png')
  assert.equal(legacyImageUrl({ publicId: 'only-id' }), null)
  assert.equal(legacyImageUrl('   '), null)
  assert.equal(legacyImageUrl(['https://cdn/x.png']), null)
})

check('legacyImageList keeps only resolvable images', () => {
  assert.deepEqual(
    legacyImageList(['https://cdn/a.png', { url: 'https://cdn/b.png' }, { publicId: 'c' }, '  ']),
    ['https://cdn/a.png', 'https://cdn/b.png'],
  )
  assert.deepEqual(legacyImageList('https://cdn/a.png'), [])
})

check('legacyAttributeList reads localized `{ k, v }` and drops an entry with no value', () => {
  assert.deepEqual(
    legacyAttributeList([
      { k: { vi: 'Chất liệu', en: 'Material' }, v: { vi: 'Bạc', en: 'Silver' } },
      { k: 'Orphan' },
      { v: 'Value only' },
    ]),
    [{ name: { vi: 'Chất liệu', en: 'Material' }, value: { vi: 'Bạc', en: 'Silver' } }],
  )
  assert.deepEqual(legacyAttributeList('not an array'), [])
})

check('legacyContentAttributes keeps a `{ url }` thumbnail — the silent drop', () => {
  assert.deepEqual(
    legacyContentAttributes({ thumbnail: { url: 'https://cdn/thumb.png' } }),
    { 'legacy.thumbnail': 'https://cdn/thumb.png' },
  )
  assert.deepEqual(
    legacyContentAttributes({ thumbnail: ' https://cdn/thumb.png ' }),
    { 'legacy.thumbnail': 'https://cdn/thumb.png' },
  )
})

check('legacyContentAttributes carries only a non-standard format', () => {
  assert.deepEqual(legacyContentAttributes({ format: 'standard' }), {})
  assert.deepEqual(legacyContentAttributes({ format: 'gallery' }), { 'legacy.format': 'gallery' })
  assert.equal(legacyContentAttributes({ format: 'z'.repeat(900) })['legacy.format']!.toString().length, 500)
})

check('legacyContentAttributes carries template, parent, sort, home flag and counters', () => {
  assert.deepEqual(
    legacyContentAttributes({
      template: 'landing',
      parent: 'root',
      sort: 3,
      views: 12,
      display: { showOnHome: true, priority: 2 },
    }),
    {
      'legacy.template': 'landing',
      'legacy.parent': 'root',
      'legacy.sort': 3,
      'legacy.showOnHome': true,
      'legacy.priority': 2,
      'legacy.views': 12,
    },
  )
  assert.deepEqual(legacyContentAttributes({ display: { showOnHome: false, priority: 0 } }), {})
})

check('legacyContentStatus: deleted wins, unknown is a draft', () => {
  assert.equal(legacyContentStatus({ status: 'published', isDeleted: true }), 'deleted')
  assert.equal(legacyContentStatus({ status: 'published' }), 'published')
  assert.equal(legacyContentStatus({ status: 'archived' }), 'archived')
  assert.equal(legacyContentStatus({ status: 'scheduled' }), 'draft')
  assert.equal(legacyContentStatus({}), 'draft')
})

check('legacyCatalogStatus: published needs isActive, archived is kept', () => {
  assert.equal(legacyCatalogStatus({ status: 'published', isActive: true }), 'published')
  assert.equal(legacyCatalogStatus({ status: 'published' }), 'published')
  assert.equal(legacyCatalogStatus({ status: 'published', isActive: false }), 'draft')
  assert.equal(legacyCatalogStatus({ status: 'archived', isActive: false }), 'archived')
  assert.equal(legacyCatalogStatus({ status: 'weird' }), 'draft')
  assert.equal(legacyCatalogStatus({ status: 'published', isDeleted: true }), 'deleted')
})

check('both importers import the shared rules instead of declaring their own', () => {
  const files = ['migrate-catalog.ts', 'migrate-content.ts']
  for (const file of files) {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'scripts/ops', file), 'utf-8')
    assert.match(
      source,
      /from '\.\.\/\.\.\/tm-cms\/server\/utils\/legacyImport\.js'/,
      `${file} does not import the shared legacy rules`,
    )
    const local = source.match(/^function (text|tagNames|imageUrl|imageList|localized|number|asRecord|slugMap|keywords|date|list)\b/gm)
    assert.equal(local, null, `${file} still declares its own copy: ${local?.join(', ')}`)
    assert.doesNotMatch(source, /legacy\.thumbnail/, `${file} builds its own legacy.thumbnail instead of the shared rule`)
  }
})

console.log(`\n${checks} checks passed`)
if (process.exitCode) {
  console.error('Legacy import mapping checks failed')
}
