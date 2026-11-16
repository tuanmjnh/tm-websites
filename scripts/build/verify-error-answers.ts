import fs from 'node:fs'
import path from 'node:path'

/**
 * Gate: a route must not answer for an error it raised itself.
 *
 * `errorResponse()` throws. A `try` that raises one of those answers and a `catch`
 * that replies with a fixed error — typically `502 HUB_UNAVAILABLE` — replaces the
 * answer with the catch's: the Hub proxy told clients the Hub was unreachable when
 * the real answer was "sign in again", and nothing in the suite noticed until the
 * branch was exercised by hand.
 *
 * A catch may answer a fixed error only if it hands h3 errors back: `instanceof
 * H3Error` or h3's `isError(error)`. Catches that delegate to a translator
 * (`translateContentError`, `translateHubAuthError`) are fine by contract — those
 * rethrow anything foreign.
 */

const rootDir = process.cwd()
const routesDir = path.join(rootDir, 'tm-cms/server/api')

const RETHROWS_H3 = /instanceof\s+H3Error|isError\(\s*error\s*\)/
const FIXED_ANSWER = /errorResponse\(\s*(\d{3})\s*,\s*['"]([A-Z_]+)['"]/

/** A catch needs a guard only when it answers with a fixed error. */
function shouldFlag(catchBody: string) {
  return FIXED_ANSWER.test(catchBody) && !RETHROWS_H3.test(catchBody)
}

/**
 * The rule checks itself first: both accepted guards and the rejected shape, so a
 * future edit to the regexes cannot quietly change what the scan means.
 */
const FIXTURES: Array<[label: string, catchBody: string, flagged: boolean]> = [
  ['instanceof H3Error', `if (error instanceof H3Error) throw error
    return errorResponse(502, 'HUB_UNAVAILABLE', 'x')`, false],
  ['isError', `if (isError(error)) throw error
    return errorResponse(502, 'HUB_UNAVAILABLE', 'x')`, false],
  ['no guard', `return errorResponse(502, 'HUB_UNAVAILABLE', 'x')`, true],
  ['translator only', `return translateHubAuthError(error)`, false],
]

/** Comments out, offsets kept: prose must never match a pattern. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, match => ' '.repeat(match.length))
}

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listFiles(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

/** Index of the brace closing the block opened at `open`, or the end of the file. */
function blockEnd(code: string, open: number): number {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}' && --depth === 0) return i
  }
  return code.length
}

const lines = (code: string, index: number) => code.slice(0, index).split('\n').length

for (const [label, catchBody, flagged] of FIXTURES) {
  if (shouldFlag(catchBody) !== flagged) {
    console.error(`  ❌ the rule misclassifies its own "${label}" fixture`)
    process.exit(1)
  }
}

const failures: string[] = []
let files = 0

for (const file of listFiles(routesDir)) {
  files++
  const code = stripComments(fs.readFileSync(file, 'utf-8'))
  const where = path.relative(rootDir, file).split(path.sep).join('/')

  for (let at = code.indexOf('try {'); at !== -1; at = code.indexOf('try {', at + 1)) {
    const body = code.slice(at + 4, blockEnd(code, code.indexOf('{', at)))
    if (!body.includes('errorResponse(')) continue

    const rest = code.slice(at + 4 + body.length + 1)
    const match = rest.match(/^\s*catch\s*(?:\([^)]*\))?\s*\{/)
    if (!match) continue

    const catchBody = rest.slice(match[0].length, blockEnd(rest, match[0].length - 1))
    if (!shouldFlag(catchBody)) continue

    const answer = catchBody.match(FIXED_ANSWER)!
    failures.push(`  ❌ ${where}:${lines(code, at)} answers ${answer[1]} ${answer[2]} over an error its own try raised`)
    failures.push(`      rethrow first: if (error instanceof H3Error) throw error`)
  }
}

console.log(`🔍 Checking ${files} route files (${FIXTURES.length} rule fixtures passed)...\n`)

if (failures.length === 0) {
  console.log(`🎉 ${files}/${files} route files clean.`)
  process.exit(0)
}

console.error(failures.join('\n'))
const count = failures.length / 2
console.log(`\n⚠️  ${count} catch${count === 1 ? '' : 'es'} swallow an answer they raised.`)
process.exit(1)
