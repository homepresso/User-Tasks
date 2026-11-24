/**
 * "Format HTML" for the email code editor: re-indents block structure (one
 * block element per line, two-space indent) and leaves inline content,
 * `<pre>`, `<style>` contents and conditional comments as written. Pure,
 * dependency-free; idempotent on its own output.
 */

import { tokenizeHtml, VOID_ELEMENTS } from './html-tokens'

const BLOCK = new Set([
  'html', 'head', 'body', 'title', 'meta', 'link', 'style', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'center', 'section', 'header', 'footer', 'main', 'article', 'blockquote', 'hr', 'br', 'img', 'col', 'colgroup', 'caption', 'pre', 'address', 'figure', 'nav', 'aside',
])
/** Blocks whose content stays on one line with the tags when it is short and inline-only. */
const KEEP_INLINE_CONTENT = new Set(['title', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'a', 'span', 'caption'])

export function formatEmailHtml(html: string, indentUnit = '  '): string {
  const tokens = tokenizeHtml(String(html ?? ''))
  const lines: string[] = []
  let depth = 0
  let line = ''
  let pre = 0
  const flush = () => {
    const text = line.trim()
    if (text) lines.push(indentUnit.repeat(Math.max(0, depth)) + text)
    line = ''
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (pre) {
      line += token.text
      if (token.kind === 'open' && token.name === 'pre') pre++
      if (token.kind === 'close' && token.name === 'pre') { pre--; if (!pre) flush() }
      continue
    }
    if (token.kind === 'text') {
      const text = token.text.replace(/\s+/g, ' ')
      if (text.trim() || line) line += text
      continue
    }
    if (token.kind === 'comment' || token.kind === 'doctype') {
      flush()
      lines.push(indentUnit.repeat(depth) + token.text.trim())
      continue
    }
    if (token.kind === 'raw') {
      flush()
      const body = token.text.replace(/^\s*\n|\s+$/g, '')
      if (token.name === 'style') {
        const rawLines = body.split('\n')
        const minIndent = Math.min(...rawLines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length))
        for (const l of rawLines) if (l.trim()) lines.push(indentUnit.repeat(depth) + l.slice(Number.isFinite(minIndent) ? minIndent : 0).trimEnd())
      } else if (body.trim()) lines.push(indentUnit.repeat(depth) + body.trim())
      continue
    }
    const name = token.name
    const isBlock = BLOCK.has(name)
    if (token.kind === 'open') {
      if (name === 'pre') { flush(); line = token.text; pre = 1; continue }
      if (!isBlock) { line += token.text; continue }
      const isVoid = VOID_ELEMENTS.has(name) || token.selfClosing
      // <td>short text</td> stays on one line.
      if (!isVoid && KEEP_INLINE_CONTENT.has(name)) {
        let j = i + 1
        let inline = ''
        let ok = false
        while (j < tokens.length) {
          const t = tokens[j]
          if (t.kind === 'close' && t.name === name) { ok = true; break }
          if (t.kind === 'comment' || t.kind === 'doctype' || t.kind === 'raw' || ((t.kind === 'open' || t.kind === 'close') && BLOCK.has(t.name))) break
          inline += t.kind === 'text' ? t.text.replace(/\s+/g, ' ') : t.text
          j++
        }
        if (ok && inline.length <= 160) {
          flush()
          lines.push(indentUnit.repeat(depth) + token.text + inline.trim() + tokens[j].text)
          i = j
          continue
        }
      }
      flush()
      lines.push(indentUnit.repeat(depth) + token.text)
      if (!isVoid) depth++
      continue
    }
    // close
    if (!isBlock) { line += token.text; continue }
    flush()
    depth = Math.max(0, depth - 1)
    lines.push(indentUnit.repeat(depth) + token.text)
  }
  flush()
  return lines.join('\n') + '\n'
}
