import fs from 'node:fs'
import path from 'node:path'

/**
 * Gate: audited admin routes take their audit meta from the shared helpers.
 *
 * The settings route once built `audit: { model: Audit, actor, requestId }` by hand
 * and never read `x-audit-reason`, so the note an editor typed was dropped while the
 * UI still reported success. The types do not catch it — everything but `model` is
 * optional — and the services are H3-free, so no service test can see the mistake
 * either. The shape of the route is what gets checked here.
 */

const rootDir = process.cwd()
const apiDir = path.join(rootDir, 'tm-cms/server/api')
const headerReader = path.join(rootDir, 'tm-cms/server/utils/contentApi.ts')

const errors: string[] = []
let checkCount = 0

function check(condition: boolean, label: string, details: string[] = []) {
  checkCount++
  if (condition) {
    console.log(`  ✅ ${label}`)
    return
  }
  console.error(`  ❌ ${label}`)
  for (const detail of details) console.error(`      ${detail}`)
  errors.push(label)
}

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

const relative = (file: string) => path.relative(rootDir, file).split(path.sep).join('/')

/**
 * Comments are blanked out rather than removed, so offsets and line numbers stay
 * put: a route that merely mentions `x-audit-reason` in prose is not reading it.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\/[^\n]*/g, match => ' '.repeat(match.length))
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
}

/** Line of an offset, for the report only; the gate cares about the file. */
function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split(String.fromCharCode(10)).length
}

console.log('🔍 Checking that audited routes use the shared audit meta...\n')

const files = routeFiles(apiDir)
check(files.length > 0, `api routes found (${files.length} files)`)

const handBuilt: string[] = []
const readsHeader: string[] = []

for (const file of files) {
  const text = fs.readFileSync(file, 'utf-8')
  const code = stripComments(text)

  for (const match of code.matchAll(/audit:\s*\{/g)) {
    // Only the object body matters: `audit: auditMetaOf(...)` has no brace at all,
    // and a literal that names a model is the one that can forget the reason.
    const body = code.slice(match.index, code.indexOf('}', match.index) + 1 || undefined)
    if (/\bmodel\s*:/.test(body)) handBuilt.push(`${relative(file)}:${lineOf(text, match.index)}`)
  }

  if (file !== headerReader && code.includes('x-audit-reason')) readsHeader.push(relative(file))
}

check(
  handBuilt.length === 0,
  'no route builds audit meta by hand (use auditMetaOf / writeMetaOf)',
  handBuilt.map(location => `${location}: hand-built "audit: { model: … }" cannot carry x-audit-reason`),
)
check(
  readsHeader.length === 0,
  'only server/utils/contentApi.ts reads x-audit-reason',
  readsHeader.map(file => `${file}: read the note through auditMetaOf instead`),
)

const readerText = stripComments(fs.readFileSync(headerReader, 'utf-8'))
check(
  readerText.includes('normalizeAuditReason(getHeader(event, \'x-audit-reason\'))'),
  'the shared helper still turns the header into the audit reason',
)

console.log(`\n${errors.length === 0 ? '🎉' : '⚠️'} ${checkCount - errors.length}/${checkCount} checks passed.`)

if (errors.length > 0) process.exit(1)
