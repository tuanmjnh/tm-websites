import fs from 'node:fs'
import path from 'node:path'

/**
 * Gate: a route must not answer for an error it raised itself.
 *
 * `errorResponse()` throws. A `try` whose body raises one of those answers and a
 * `catch` that replies with a fixed error — typically `502 HUB_UNAVAILABLE` — turns
 * the answer into the catch's: the Hub proxy told clients the Hub was unreachable
 * when the real answer was "sign in again", and nothing in the suite noticed until
 * the branch was exercised by hand. A catch may answer a fixed error only if it
 * rethrows the errors it does not recognise (`instanceof H3Error` or `throw error`).
 *
 * Catches that delegate to a translator (`translateContentError`,
 * `translateHubAuthError`) are fine by contract: those rethrow anything foreign.
 */

const rootDir = process.cwd()
const routesDir = path.join(rootDir, 'tm-cms/server/api')

/** Answers a catch must hand back untouched when it did not raise them. */
const RETHROW = /instanceof\s+H3Error|instanceof\s+HubRequestError[^\n]*\n?[^\n]*throw\s+error|throw\s+error\b/

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

/** Index of the brace that closes the one opened at `open`. */
function blockEnd(code: string, open: number): number {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return code.length
}

const failures: Array<{ where: string, answer: string }> = []
let files = 0
let riskyCatches = 0

for (const file of listFiles(routesDir)) {
  files++
  const code = stripComments(fs.readFileSync(file, 'utf-8'))
  let index = code.indexOf('try {')

  while (index !== -1) {
    const tryLine = code.slice(0, index).split('\n').length
    const bodyStart = code.indexOf('{', index)
    const bodyEnd = blockEnd(code, bodyStart)
    const body = code.slice(bodyStart + 1, bodyEnd)
    const rest = code.slice(bodyEnd + 1)
    const catchKeyword = rest.match(/^\s*catch\s*(\([^)]*\))?\s*\{/)
    index = code.indexOf('try {', bodyEnd)

    if (!catchKeyword || !/errorResponse\(/.test(body)) continue

    const catchOpen = bodyEnd + 1 + catchKeyword[0].length - 1
    const catchBody = code.slice(catchOpen + 1, blockEnd(code, catchOpen))
    const answer = catchBody.match(/errorResponse\(\s*(\d{3})\s*,\s*['"]([A-Z_]+)['"]/)
    if (!answer || RETHROW.test(catchBody)) continue

    riskyCatches++
    failures.push({
      where: `${path.relative(rootDir, file).split(path.sep).join('/')}:${tryLine}`,
      answer: `${answer[1]} ${answer[2]}`,
    })
  }
}

console.log(`🔍 Checking ${files} route files for catches that answer over their own errors...\n`)

if (failures.length === 0) {
  console.log(`🎉 ${files} route files clean; ${riskyCatches} fixed answers hiding a raised one.`)
  process.exit(0)
}

for (const failure of failures) {
  console.error(`  ❌ ${failure.where} answers ${failure.answer} over an error its own try raised`)
  console.error(`      rethrow first: if (error instanceof H3Error) throw error`)
}

console.log(`\n⚠️  ${failures.length}/${files} route files swallow an answer they raised.`)
process.exit(1)
