import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Every internal target the navigation links to must resolve to a page file.
 *
 * The navigation is written by hand in both apps (the storefront's fallback
 * menus in `usePublicSite`, its header/footer and inline page links, and the
 * CMS sidebar in `layouts/default.vue`), and a link to a page that does not
 * exist still typechecks, still lints and still builds — it only shows up as a
 * 404 when a visitor clicks it. `/about` and `/contact` shipped as dead links
 * exactly this way.
 *
 * The catch-all page never satisfies a link: it renders CMS content by path, so
 * a missing page hides behind it and answers 404 at runtime, which is the bug
 * this gate exists to catch.
 */

interface PageRoute {
  route: string
  file: string
  kind: 'static' | 'param'
}

interface Link {
  target: string
  source: string
}

interface App {
  name: string
  root: string
}

const APPS: App[] = [
  { name: 'web', root: path.resolve('tm-shared/nuxt-layers/web-base/app') },
  { name: 'cms', root: path.resolve('tm-shared/nuxt-layers/cms-base/app') },
]

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

function readPages(root: string): PageRoute[] {
  const pagesDir = path.join(root, 'pages')
  return walk(pagesDir)
    .filter(file => file.endsWith('.vue'))
    .map((file) => {
      const relative = path.relative(pagesDir, file).replace(/\\/g, '/').replace(/\.vue$/, '')
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

const LINK_PATTERN = new RegExp([
  String.raw`(?:to|href)="(\/[^"$]*)`,
  String.raw`to:\s*'(\/[^']*)'`,
  String.raw`(?:navigateTo|router\.(?:push|replace))\(\s*'(\/[^']*)'`,
].join('|'), 'g')

function readLinks(root: string): Link[] {
  return walk(root)
    .filter(file => file.endsWith('.vue') || file.endsWith('.ts'))
    .flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8')
      const relative = path.relative(path.resolve('.'), file).replace(/\\/g, '/')
      return [...source.matchAll(LINK_PATTERN)]
        .map((match) => {
          const target = (match[1] ?? match[2] ?? match[3] ?? '').split(/[?#]/)[0]
          return { target, source: `${relative}:${source.slice(0, match.index).split('\n').length}` }
        })
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

console.log('   Web and CMS routes: literal internal links resolve to a page file')

for (const app of APPS) {
  const routes = readPages(app.root)
  const links = readLinks(app.root)
  const unique = [...new Map(links.map(link => [link.target, link])).values()]
    .sort((a, b) => a.target.localeCompare(b.target))
  const minimumLinks = app.name === 'web' ? 8 : 5

  check(`${app.name}: the page manifest is read from the real pages directory`, () => {
    assert.ok(routes.length >= (app.name === 'web' ? 8 : 18), `${app.name}: expected at least ${app.name === 'web' ? 8 : 18} pages, found ${routes.length}`)
  })

  check(`${app.name}: the link scan finds the navigation`, () => {
    assert.ok(unique.length >= minimumLinks, `${app.name}: expected at least ${minimumLinks} distinct targets, found ${unique.length}`)
  })

  check(`${app.name}: every literal internal link resolves to a static or dynamic page`, () => {
    const dead = unique.filter(link => !resolve(link.target, routes))
    assert.equal(
      dead.length,
      0,
      `${app.name}: links point at pages that do not exist: ${dead.map(link => `${link.target} (${link.source})`).join(', ')}`,
    )
  })
}

// The two pages this gate was written after, so removing one fails loudly.
check('the storefront pages the header and footer link to exist', () => {
  const routes = readPages(APPS[0].root)
  for (const route of ['/about', '/contact']) {
    assert.ok(routes.some(page => page.route === route), `${route} has no page file`)
  }
})

const totalChecks = checks
console.log(`\n✅ Web and CMS route checks: ${totalChecks} passed, 0 not run`)
