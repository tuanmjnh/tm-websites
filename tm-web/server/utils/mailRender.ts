/**
 * Text rendering for the mail queue.
 *
 * Mirrors the CMS renderer exactly (`{{ name }}` tokens, HTML-escaped inside an
 * HTML body, raw inside a subject or text body) so a template written in the CMS
 * produces the same message when the storefront queues it. Kept dependency-free
 * so it can be tested without a Nitro runtime.
 */

const TOKEN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderMailText(template: string, variables: Record<string, string>, options: { escape: boolean }): string {
  return template.replace(TOKEN, (_match, name: string) => {
    const value = variables[name] ?? ''
    return options.escape ? escapeHtml(value) : value
  })
}

/** Variable names a template references, so a missing value fails before insert. */
export function templateVariables(...texts: string[]): string[] {
  const found: string[] = []
  for (const text of texts) {
    for (const match of text.matchAll(TOKEN)) {
      const name = match[1]!
      if (!found.includes(name)) found.push(name)
    }
  }
  return found
}
