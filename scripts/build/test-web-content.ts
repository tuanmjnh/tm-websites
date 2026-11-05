import assert from 'node:assert/strict'
import {
  HubPublicContentListSchema,
  HubPublicContentSchema,
  contentKeyFromPath,
  contentKeyToPath,
  normalizeContentKey,
  toPublicContentView,
} from '../../tm-shared/packages/flow-contracts/src/public-content.js'
import { escapeHtml, sanitizePublicHtml } from '../../tm-shared/packages/flow-utils/src/html.js'
import { renderSafeMarkdown } from '../../tm-shared/packages/flow-utils/src/markdown.js'
import {
  buildCanonicalUrl,
  buildSitemapEntries,
  buildSitemapXml,
  normalizeSiteBaseUrl,
  resolveSiteUrl,
} from '../../tm-shared/packages/flow-utils/src/seo.js'

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

console.log('Testing public content contracts and web render helpers...\n')

console.log('1. Public content contracts')
check('public content parses the safe Hub DTO', () => {
  const content = HubPublicContentSchema.parse({
    key: 'pages/about',
    title: 'About us',
    description: 'Company story',
    category: 'page',
    contentType: 'markdown',
    data: '# About',
    metadata: { image: '/branding/og-cover.png' },
    updatedAt: '2026-11-04T06:23:41.000Z',
  })
  assert.equal(content.key, 'pages/about')
  assert.equal(content.version, 1)
  assert.equal(content.metadata?.image, '/branding/og-cover.png')
})

check('public content rejects missing key/title and unknown content types', () => {
  assert.equal(HubPublicContentSchema.safeParse({ title: 'No key' }).success, false)
  assert.equal(HubPublicContentSchema.safeParse({ key: 'a', title: 'A', contentType: 'pdf', data: '' }).success, false)
})

check('public content list validates the paginated payload', () => {
  const payload = HubPublicContentListSchema.parse({
    success: true,
    data: [{ key: 'about', title: 'About', contentType: 'text', data: 'Hello' }],
    nextCursor: 'abc',
  })
  assert.equal(payload.data[0]?.key, 'about')
  assert.equal(payload.nextCursor, 'abc')
  assert.equal(HubPublicContentListSchema.safeParse({ success: true, data: [{ key: 'x' }] }).success, false)
})

console.log('\n2. Content key resolution')
check('contentKeyFromPath joins decoded catch-all segments', () => {
  assert.equal(contentKeyFromPath(['pages', 'about']), 'pages/about')
  assert.equal(contentKeyFromPath('pages/about'), 'pages/about')
  assert.equal(contentKeyFromPath(['legal', 'terms-of-service']), 'legal/terms-of-service')
})

check('contentKeyFromPath rejects traversal and malformed segments', () => {
  assert.equal(contentKeyFromPath(undefined), null)
  assert.equal(contentKeyFromPath([]), null)
  assert.equal(contentKeyFromPath(['..', 'etc']), null)
  assert.equal(contentKeyFromPath(['pages', '.', 'about']), null)
  assert.equal(contentKeyFromPath(['pages', '']), null)
  assert.equal(contentKeyFromPath(['pages%2Fabout']), null)
  assert.equal(contentKeyFromPath(['pages%5Cabout']), null)
  assert.equal(contentKeyFromPath(['bad key']), null)
})

check('normalizeContentKey and contentKeyToPath preserve nested keys', () => {
  assert.equal(normalizeContentKey('  pages/about  '), 'pages/about')
  assert.equal(normalizeContentKey('pages/../about'), null)
  assert.equal(normalizeContentKey('pages/'), null)
  assert.equal(contentKeyToPath('pages/about'), '/pages/about')
  assert.equal(contentKeyToPath('bad key'), null)
})

console.log('\n3. Public content view model')
check('content type drives the render model', () => {
  assert.deepEqual(toPublicContentView({ contentType: 'html', data: '<p>Hello</p>' }), { kind: 'html', html: '<p>Hello</p>' })
  assert.deepEqual(toPublicContentView({ contentType: 'markdown', data: '# Hello' }), { kind: 'markdown', markdown: '# Hello' })
  assert.deepEqual(toPublicContentView({ contentType: 'text', data: 'Hello' }), { kind: 'text', text: 'Hello' })
})

check('JSON content supports explicit html/markdown/text payloads', () => {
  assert.deepEqual(toPublicContentView({ contentType: 'json', data: { html: '<p>Hi</p>' } }), { kind: 'html', html: '<p>Hi</p>' })
  assert.deepEqual(toPublicContentView({ contentType: 'json', data: { markdown: '# Hi' } }), { kind: 'markdown', markdown: '# Hi' })
  assert.deepEqual(toPublicContentView({ contentType: 'json', data: { text: 'Hi' } }), { kind: 'text', text: 'Hi' })
})

check('JSON content extracts sections from common shapes', () => {
  assert.deepEqual(
    toPublicContentView({ contentType: 'json', data: { sections: [{ heading: 'Our story', body: 'Founded in 2010' }] } }),
    { kind: 'sections', sections: [{ heading: 'Our story', body: 'Founded in 2010' }] },
  )
  assert.deepEqual(
    toPublicContentView({ contentType: 'json', data: { sections: [{ title: 'Mission', text: 'Quality first' }] } }),
    { kind: 'sections', sections: [{ heading: 'Mission', body: 'Quality first' }] },
  )
  assert.deepEqual(
    toPublicContentView({ contentType: 'json', data: [{ heading: 'A', body: 'B' }] }),
    { kind: 'sections', sections: [{ heading: 'A', body: 'B' }] },
  )
})

check('JSON content falls back to pretty-printed JSON', () => {
  const view = toPublicContentView({ contentType: 'json', data: { foo: 'bar' } })
  assert.equal(view.kind, 'json')
  if (view.kind !== 'json') return
  assert.ok(view.json.includes('"foo": "bar"'))
})

console.log('\n4. HTML sanitizer')
check('sanitizePublicHtml keeps allowlisted markup', () => {
  assert.equal(
    sanitizePublicHtml('<p class="lead">Hi <strong>there</strong></p>'),
    '<p class="lead">Hi <strong>there</strong></p>',
  )
  assert.equal(
    sanitizePublicHtml('<a href="https://sentuan.vn" target="_blank">Shop</a>'),
    '<a href="https://sentuan.vn" target="_blank" rel="noopener noreferrer">Shop</a>',
  )
})

check('sanitizePublicHtml removes scripts, handlers and unsafe URLs', () => {
  const output = sanitizePublicHtml(
    '<script>alert(1)</script><p onclick="alert(1)">Safe</p><a href="javascript:alert(1)">x</a><img src="x" onerror="alert(1)">',
  )
  assert.ok(!output.includes('<script'))
  assert.ok(!output.includes('onclick'))
  assert.ok(!output.includes('onerror'))
  assert.ok(!output.includes('javascript:'))
  assert.ok(output.includes('<p>Safe</p>'))
})

check('sanitizePublicHtml removes dangerous embedded elements', () => {
  const output = sanitizePublicHtml('<iframe src="https://evil.example"></iframe><p>After</p><svg><script>alert(1)</script></svg>')
  assert.ok(!output.includes('iframe'))
  assert.ok(!output.includes('<svg'))
  assert.ok(output.includes('<p>After</p>'))
})

check('escapeHtml escapes markup characters', () => {
  assert.equal(escapeHtml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;')
})

console.log('\n5. Safe Markdown renderer')
check('renderSafeMarkdown renders headings, emphasis and safe links', () => {
  const html = renderSafeMarkdown('# Title\n\nHello **world** and [shop](https://sentuan.vn).')
  assert.ok(html.includes('<h1>Title</h1>'))
  assert.ok(html.includes('<strong>world</strong>'))
  assert.ok(html.includes('<a href="https://sentuan.vn" rel="noopener noreferrer">shop</a>'))
})

check('renderSafeMarkdown renders lists, quotes and code fences', () => {
  const html = renderSafeMarkdown('- one\n- two\n\n> quoted\n\n```\nconst a = 1\n```')
  assert.ok(html.includes('<ul><li>one</li><li>two</li></ul>'))
  assert.ok(html.includes('<blockquote>quoted</blockquote>'))
  assert.ok(html.includes('<pre><code>const a = 1</code></pre>'))
})

check('renderSafeMarkdown escapes raw HTML and rejects unsafe links', () => {
  const html = renderSafeMarkdown('<script>alert(1)</script> [x](javascript:alert(1))')
  assert.ok(!html.includes('<script>'))
  assert.ok(!html.includes('href="javascript:'))
})

console.log('\n6. Canonical URLs and sitemap')
check('buildCanonicalUrl normalizes base and path', () => {
  assert.equal(normalizeSiteBaseUrl('  https://sentuan.vn/// '), 'https://sentuan.vn')
  assert.equal(buildCanonicalUrl('https://sentuan.vn/', '/pages/about/'), 'https://sentuan.vn/pages/about')
  assert.equal(buildCanonicalUrl('https://sentuan.vn', '/'), 'https://sentuan.vn/')
  assert.equal(buildCanonicalUrl('https://sentuan.vn', '/about?utm=x#top'), 'https://sentuan.vn/about')
})

check('resolveSiteUrl handles absolute, protocol-relative and relative values', () => {
  assert.equal(resolveSiteUrl('https://sentuan.vn', 'https://cdn.example/x.png'), 'https://cdn.example/x.png')
  assert.equal(resolveSiteUrl('https://sentuan.vn', '//cdn.example/x.png'), 'https://cdn.example/x.png')
  assert.equal(resolveSiteUrl('https://sentuan.vn', '/branding/og-cover.png'), 'https://sentuan.vn/branding/og-cover.png')
  assert.equal(resolveSiteUrl('https://sentuan.vn', ''), '')
})

check('buildSitemapEntries includes published pages once and keeps lastmod', () => {
  const entries = buildSitemapEntries('https://sentuan.vn', [
    { path: '/about' },
    { path: '/about' },
    { path: '/blog', lastmod: '2026-11-04T06:23:41.000Z' },
  ])
  assert.deepEqual(entries.map(entry => entry.loc), [
    'https://sentuan.vn/',
    'https://sentuan.vn/about',
    'https://sentuan.vn/blog',
  ])
  assert.equal(entries[2]?.lastmod, '2026-11-04T06:23:41.000Z')
})

check('buildSitemapXml produces a valid escaped urlset', () => {
  const xml = buildSitemapXml([{ loc: 'https://sentuan.vn/?a=1&b=2', lastmod: '2026-11-04' }])
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'))
  assert.ok(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'))
  assert.ok(xml.includes('<loc>https://sentuan.vn/?a=1&amp;b=2</loc>'))
  assert.ok(xml.includes('<lastmod>2026-11-04</lastmod>'))
})

console.log(`\n${process.exitCode ? '⚠️' : '🎉'} ${checks} public content checks passed${process.exitCode ? ' (with failures)' : ' successfully'}!`)

if (process.exitCode) {
  process.exit(process.exitCode)
}
