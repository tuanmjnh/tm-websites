/**
 * Conservative HTML sanitizer for public CMS content.
 *
 * Only an allowlist of structural tags and attributes survives. Dangerous
 * elements are removed together with their content, event handlers and
 * javascript/data URLs are dropped, and every retained value is re-escaped.
 * The implementation is intentionally dependency-free so it runs identically
 * during SSR and hydration.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'small',
  'sub', 'sup', 'blockquote', 'cite', 'code', 'pre', 'ul', 'ol', 'li', 'dl',
  'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'figure',
  'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'span', 'div', 'section', 'article', 'header', 'footer', 'aside', 'main',
  'nav', 'mark', 'time',
])

const VOID_TAGS = new Set(['br', 'hr', 'img'])

const ALLOWED_ATTRS = new Set([
  'href', 'src', 'alt', 'title', 'width', 'height', 'loading', 'decoding',
  'target', 'rel', 'class', 'id', 'colspan', 'rowspan', 'scope', 'start',
  'reversed', 'datetime', 'cite', 'lang', 'dir', 'role', 'aria-label',
  'aria-hidden', 'aria-level', 'type', 'value',
])

const URL_ATTRS = new Set(['href', 'src', 'cite'])

const DANGEROUS_BLOCKS = /<\s*(script|style|iframe|object|embed|form|textarea|select|template|svg|math|noscript|link|meta|base)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi
const DANGEROUS_TAGS = /<\s*(script|style|iframe|object|embed|form|textarea|select|template|svg|math|noscript|link|meta|base)\b[^>]*\/?\s*>/gi
const COMMENTS = /<!--[\s\S]*?-->/g
const TAG_PATTERN = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)\s*(\/?)>/g
const ATTR_PATTERN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isSafeUrl(raw: string): boolean {
  const value = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim()
  if (!value) return false

  const lower = value.toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:')) {
    return false
  }
  if (lower.startsWith('//')) return true
  if (/^(https?:|mailto:|tel:)/i.test(value)) return true
  if (value.startsWith('#') || value.startsWith('/')) return true
  if (!value.includes(':')) return true
  return false
}

function sanitizeAttributes(raw: string, tag: string): string {
  const attributes: string[] = []
  const seen = new Set<string>()

  ATTR_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTR_PATTERN.exec(raw))) {
    const name = (match[1] ?? '').toLowerCase()
    if (!name || name.startsWith('on') || seen.has(name)) continue
    if (!ALLOWED_ATTRS.has(name)) continue

    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (URL_ATTRS.has(name) && !isSafeUrl(value)) continue
    if (name === 'target' && value !== '_blank' && value !== '_self') continue

    seen.add(name)
    attributes.push(`${name}="${escapeHtml(value)}"`)
  }

  if (tag === 'a' && seen.has('target') && attributes.some(attr => attr === 'target="_blank"')) {
    const relIndex = attributes.findIndex(attr => attr.startsWith('rel='))
    const rel = 'rel="noopener noreferrer"'
    if (relIndex >= 0) attributes[relIndex] = rel
    else attributes.push(rel)
  }

  return attributes.length ? ` ${attributes.join(' ')}` : ''
}

export function sanitizePublicHtml(input: string): string {
  let html = typeof input === 'string' ? input : ''

  html = html.replace(COMMENTS, '')
  html = html.replace(DANGEROUS_BLOCKS, '')
  html = html.replace(DANGEROUS_TAGS, '')

  return html.replace(
    TAG_PATTERN,
    (_full, closing: string, rawName: string, rawAttrs: string, selfClosing: string) => {
      const tag = (rawName ?? '').toLowerCase()
      if (!ALLOWED_TAGS.has(tag)) return ''

      if (closing) {
        return VOID_TAGS.has(tag) ? '' : `</${tag}>`
      }

      const attributes = sanitizeAttributes(rawAttrs ?? '', tag)
      if (VOID_TAGS.has(tag)) return `<${tag}${attributes}>`
      if (selfClosing) return `<${tag}${attributes}></${tag}>`
      return `<${tag}${attributes}>`
    },
  )
}
