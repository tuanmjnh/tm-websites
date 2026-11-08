import type { ZodType } from 'zod'

interface IssueSummary {
  path: string
  message: string
}

function summarize(error: { issues: { path: PropertyKey[], message: string }[] }): IssueSummary[] {
  return error.issues.slice(0, 20).map(issue => ({
    path: issue.path.map(segment => String(segment)).join('.'),
    message: issue.message,
  }))
}

/**
 * Parses untrusted input at an API boundary. A validation failure becomes a
 * stable 422 with field paths, never a 500 from an uncaught Zod error.
 */
export function parseInput<T>(schema: ZodType<T>, input: unknown, code: string, message: string): T {
  const parsed = schema.safeParse(input ?? {})
  if (!parsed.success) {
    return errorResponse(422, code, message, summarize(parsed.error))
  }
  return parsed.data
}
