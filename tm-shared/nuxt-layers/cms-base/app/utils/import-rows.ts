/**
 * Input parsing for the bulk import dialogs.
 *
 * Two shapes are accepted because the operator usually has one or the other:
 * a JSON array (exactly what the admin route takes) or CSV with a header row.
 * CSV cells are coerced so a numeric price or a `{"vi":"..."}` title object
 * survives the trip, and an empty cell is omitted rather than sent as `''`
 * (the services treat a missing field differently from an empty one).
 */

export interface ImportRowResult {
  row: number
  key: string | null
  status: string
  code: string | null
  message: string | null
}

export interface ImportOutcome {
  total: number
  created: number
  updated: number
  failed: number
  results: ImportRowResult[]
}

// `empty` is not an error the dialog shows: it is the empty textarea before typing.
export type ImportParseError = 'empty' | 'invalid' | 'no-rows'

const MAX_ROWS = 500

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        value += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        value += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      cells.push(value)
      value = ''
    } else {
      value += char
    }
  }
  cells.push(value)
  return cells
}

function coerceCell(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  // A leading zero (a phone number, a zero-padded code) stays text; only plain
  // numeric cells become numbers, which is what price/stock columns need.
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(raw)) return Number(raw)
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return raw
}

export function parseImportRows(text: string): { rows: Record<string, unknown>[], error: ImportParseError | null } {
  const trimmed = text.trim()
  if (!trimmed) return { rows: [], error: 'empty' }

  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (!Array.isArray(parsed)) return { rows: [], error: 'invalid' }
      const rows = parsed.filter(row => row !== null && typeof row === 'object' && !Array.isArray(row)) as Record<string, unknown>[]
      if (rows.length === 0) return { rows: [], error: 'no-rows' }
      if (rows.length > MAX_ROWS) return { rows: [], error: 'invalid' }
      return { rows, error: null }
    } catch {
      return { rows: [], error: 'invalid' }
    }
  }

  const lines = trimmed.split(/\r?\n/).filter(line => line.trim().length > 0)
  if (lines.length < 2) return { rows: [], error: 'no-rows' }
  const header = splitCsvLine(lines[0]!).map(cell => cell.trim())
  if (header.some(cell => !cell) || header.length === 0) return { rows: [], error: 'invalid' }
  if (lines.length - 1 > MAX_ROWS) return { rows: [], error: 'invalid' }

  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    const row: Record<string, unknown> = {}
    header.forEach((key, index) => {
      const raw = (cells[index] ?? '').trim()
      if (raw !== '') row[key] = coerceCell(raw)
    })
    return row
  })

  return { rows, error: null }
}
