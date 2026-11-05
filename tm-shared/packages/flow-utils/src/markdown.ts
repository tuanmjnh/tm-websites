import { escapeHtml } from './html'

/**
 * Small, dependency-free Markdown renderer for public CMS content.
 *
 * The source is HTML-escaped before any markup is generated, so the output can
 * only contain the tags produced below. Links are limited to http(s), mailto,
 * tel, absolute paths and anchors.
 */

const SAFE_LINK = /^(https?:|mailto:|tel:|\/|#)/i

function renderInline(source: string): string {
  const codes: string[] = []

  let text = escapeHtml(source).replace(/`([^`]+)`/g, (_match, code: string) => {
    const token = `\u0000IC${codes.length}\u0000`
    codes.push(`<code>${code}</code>`)
    return token
  })

  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
    const value = url.trim()
    if (!SAFE_LINK.test(value)) return `[${label}](${value})`
    return `<a href="${value}" rel="noopener noreferrer">${label}</a>`
  })

  text = text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')

  codes.forEach((html, index) => {
    text = text.replace(`\u0000IC${index}\u0000`, html)
  })

  return text
}

export function renderSafeMarkdown(source: string): string {
  const input = String(source ?? '').replace(/\r\n?/g, '\n')
  if (!input.trim()) return ''

  const lines = input.split('\n')
  const blocks: string[] = []
  let paragraph: string[] = []
  let index = 0

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (/^\s*```/.test(line)) {
      flushParagraph()
      index++
      const code: string[] = []
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index++
      }
      index++
      blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      index++
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      const level = (heading[1] ?? '#').length
      blocks.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`)
      index++
      continue
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushParagraph()
      blocks.push('<hr>')
      index++
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph()
      const quote: string[] = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^\s*>\s?/, ''))
        index++
      }
      blocks.push(`<blockquote>${renderInline(quote.join(' '))}</blockquote>`)
      continue
    }

    const list = line.match(/^\s*([-*+]|\d+\.)\s+/)
    if (list) {
      flushParagraph()
      const ordered = /\d+\./.test(list[1] ?? '')
      const itemPattern = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/
      const items: string[] = []

      while (index < lines.length) {
        const item = (lines[index] ?? '').match(itemPattern)
        if (!item) break
        items.push(`<li>${renderInline(item[1] ?? '')}</li>`)
        index++
      }

      const tag = ordered ? 'ol' : 'ul'
      blocks.push(`<${tag}>${items.join('')}</${tag}>`)
      continue
    }

    paragraph.push(line.trim())
    index++
  }

  flushParagraph()
  return blocks.join('\n')
}
