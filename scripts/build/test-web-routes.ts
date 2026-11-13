import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Every internal target the storefront links to must resolve to a page file.
 *
 * The navigation is written by hand in three places (the fallback menus in
 * `usePublicSite`, the header/footer in the layout, and inline links in pages),
 * and a link to a page that does not exist still typechecks, still lints and
 * still builds — it only shows up as a 404 when a visitor clicks it. `/about`
 * and `/contact` shipped as dead links exactly this way.
 *
 * The catch-all page never satisfies a link: it renders CMS content by path, so
 * a missing page hides behind it and answers 404 at runtime, which is the bug
 * this gate exists to catch.
 */

const APP_DIR = path.resolve('tm-shared/nuxt-layers/web-base/app')
const PAGES_DIR = path.join(APP_DIR, 'pages')

interface PageRoute {
  route: string
  file: string
  kind: 'static' | 'param'
}

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

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return [full]
  })
}

/** Page files to routes, in the shape Nuxt derives them. */
function readPages(): PageRoute[] {
  return walk(PAGES_DIR)
    .filter(file => file.endsWith('.vue'))
    .map((file) => {
      const relative = path.relative(PAGES_DIR, file).replace(/\\/g, '/').replace(/\.vue$/, '')
      const segments = relative.split('/')
      // A catch-all renders CMS content by path and is explicitly not a route
      // the navigation may point at.
      if (segments.some(segment => segment.startsWith('[...'))) return null
      const route = `/${segments
        .map(segment => (segment === 'index' ? '' : segment))
        .filter(Boolean)
        .join('/')}`.replace(/\/$/, '') || '/'
      return {
        route,
        file: path.relative(path.resolve('.'), file).replace(/\\/g, '/'),
        kind: segments.some(segment => segment.startsWith('[')) ? 'param' as const : 'static' as const,
      }
    })
    .filter((route): route is PageRoute => route !== null)
}

interface Link {
  target: string
  source: string
}

const LINK_PATTERN = new RegExp([
  // `<NuxtLink to="/x">`, `:to="'/x'"`, `href="/x"`
  String.raw`(?:to|href)="(\/[^"$]*)`,
  // `{ label: t('nav.about'), to: '/x' }`
  String.raw`to:\s*'(\/[^']*)'`,
  // `navigateTo('/x')` / `router.push('/x')` / `$fetch('/x')` stays out: only navigation.
  String.raw`(?:navigateTo|router\.(?:push|replace))\(\s*'(\/[^']*)'`,
].join('|'), 'g')

function readLinks(): Link[] {
  return walk(APP_DIR)
    .filter(file => file.endsWith('.vue') || file.endsWith('.ts'))
    .flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8')
      const relative = path.relative(path.resolve('.'), file).replace(/\\/g, '/')
      return [...source.matchAll(LINK_PATTERN)]
        .map((match) => {
          const target = (match[1] ?? match[2] ?? match[3] ?? '').split(/[?#]/)[0]
          return { target, source: `${relative}:${source.slice(0, match.index).split('\n').length}` }
        })
        // A target with a `:` is a runtime value (`/products/${slug}`), not a literal route.
        .filter(link => link.target.startsWith('/') && !link.target.includes(':'))
    })
}

function resolve(target: string, routes: PageRoute[]): boolean {
  const wanted = target.replace(/\/$/, '') || '/'
  return routes.some((route) => {
    if (route.kind === 'static') return route.route === wanted
    const routeSegments = route.route.split('/').filter(Boolean)
    const linkSegments = wanted.split('/').filter(Boolean)
    if (routeSegments.length !== linkSegments.length) return false
    return routeSegments.every((segment, index) => segment.startsWith('[') || segment === linkSegments[index])
  })
}

const routes = readPages()
const links = readLinks()
const unique = [...new Map(links.map(link => [link.target, link])).values()].sort((a, b) => a.target.localeCompare(b.target))

console.log('   Web routes: literal internal links resolve to a page file')

check('the page manifest is read from the real pages directory', () => {
  assert.ok(routes.length >= 8, `expected the storefront pages, found ${routes.length}`)
  assert.ok(routes.some(route => route.route === '/'), 'the index page is missing')
})

check('the link scan finds the navigation (a refactor cannot silently empty this gate)', () => {
  assert.ok(unique.length >= 8, `expected at least 8 distinct targets, found ${unique.length}`)
  for (const expected of ['/', '/products', '/bai-viet']) {
    assert.ok(unique.some(link => link.target === expected), `the scan lost ${expected}`)
  }
})

check('every literal internal link resolves to a static or dynamic page', () => {
  const dead = unique.filter(link => !resolve(link.target, routes))
  assert.equal(
    dead.length,
    0,
    `links point at pages that do not exist: ${dead.map(link => `${link.target} (${link.source})`).join(', ')}`,
  )
})

/** The two pages this gate was written after, so removing a page fails loudly. */
check('the about and contact pages the navigation links to exist', () => {
  for (const route of ['/about', '/contact']) {
    assert.ok(routes.some(page => page.route === route), `${route} has no page file`)
  }
})

console.log(`\n✅ Web route checks: ${checks} passed, 0 not run`)
