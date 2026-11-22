/**
 * One CSV cell, safe to open in a spreadsheet: quotes doubled, and a value that
 * starts with `=`, `+`, `-` or `@` is prefixed with an apostrophe so Excel treats
 * it as text instead of a formula. Codes and notes come from operators, and a
 * value like `=HYPERLINK(...)` must never become executable in an export.
 *
 * The exports (finance ledger, audit trail, attendance) share this so a fix in
 * one place cannot leave another export unsafe.
 */
export function csvCell(value: string | number): string {
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
