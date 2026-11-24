/**
 * HTML → plain text for an email's text part (the editor's "Generate from
 * HTML"): headings on their own lines, paragraphs separated by a blank line,
 * list items as "- ", table cells side by side and rows on lines, links as
 * "text (url)", images by their alt text, `<head>` / `<style>` / hidden
 * preheaders dropped, entities decoded, `{{variables}}` kept. Pure.
 *
 * (lib/email-templates htmlToPlainText — the fallback the service derives
 * when a template is saved without a text body — is left as it is so stored
 * templates and config-as-code plans do not change.)
 */

import { tokenizeHtml, attrValue, decodeEntities } from './html-tokens'

const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'blockquote', 'table', 'tbody', 'thead', 'tfoot', 'center', 'pre', 'address', 'figure', 'figcaption', 'form', 'nav', 'aside'])
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const DROP = new Set(['head', 'style', 'script', 'title', 'noscript'])

export function htmlToEmailText(html: string): string {
  const out: string[] = []
  const links: Array<{ href: string; start: number }> = []
  const lists: Array<{ ordered: boolean; n: number }> = []
  const hidden: string[] = []
  let dropDepth = 0
  let dropName: string | null = null
  let pre = 0
  const tokens = tokenizeHtml(String(html ?? ''))
  const newline = (count = 1) => {
    const joined = out.join('')
    const trailing = /\n*$/.exec(joined)?.[0].length ?? 0
    if (!joined.trim()) return
    if (trailing < count) out.push('\n'.repeat(count - trailing))
  }
  for (const token of tokens) {
    if (dropDepth) {
      if (token.kind === 'open' && token.name === dropName) dropDepth++
      if (token.kind === 'close' && token.name === dropName) dropDepth--
      continue
    }
    if (token.kind === 'raw') continue
    if (token.kind === 'comment' || token.kind === 'doctype') continue
    if (token.kind === 'text') {
      let text = decodeEntities(token.text)
      if (!pre) text = text.replace(/\s+/g, ' ')
      if (!pre && /^\s$/.test(text) && /(\n|\s)$/.test(out.join('').slice(-1) || '\n')) continue
      out.push(text)
      continue
    }
    if (token.kind === 'open') {
      const name = token.name
      const style = (attrValue(token.attrs, 'style') ?? '').toLowerCase().replace(/\s/g, '')
      if (DROP.has(name)) { if (!token.selfClosing) { dropDepth = 1; dropName = name } continue }
      // Hidden preheaders and MSO-only blocks.
      if (/display:none|mso-hide:all/.test(style) && !token.selfClosing) { dropDepth = 1; dropName = name; hidden.push(name); continue }
      if (HEADINGS.has(name)) { newline(2) }
      else if (BLOCK.has(name)) newline(name === 'p' || name === 'blockquote' || name === 'table' ? 2 : 1)
      else if (name === 'tr') newline(1)
      else if (name === 'br') out.push('\n')
      else if (name === 'hr') { newline(1); out.push('----------------------------------------'); newline(1) }
      else if (name === 'ul' || name === 'ol') { lists.push({ ordered: name === 'ol', n: 0 }); newline(1) }
      else if (name === 'li') {
        newline(1)
        const list = lists[lists.length - 1]
        const indent = '  '.repeat(Math.max(0, lists.length - 1))
        if (list) { list.n++; out.push(list.ordered ? `${indent}${list.n}. ` : `${indent}- `) } else out.push('- ')
      } else if (name === 'td' || name === 'th') {
        const joined = out.join('')
        if (joined && !/[\n\s]$/.test(joined)) out.push(' ')
      } else if (name === 'a') links.push({ href: attrValue(token.attrs, 'href') ?? '', start: out.join('').length })
      else if (name === 'img') {
        const alt = (attrValue(token.attrs, 'alt') ?? '').trim()
        if (alt) out.push(decodeEntities(alt))
      } else if (name === 'pre') { newline(2); pre++ }
      continue
    }
    if (token.kind === 'close') {
      const name = token.name
      if (HEADINGS.has(name)) newline(2)
      else if (name === 'p' || name === 'blockquote' || name === 'table') newline(2)
      else if (BLOCK.has(name) || name === 'tr' || name === 'li') newline(1)
      else if (name === 'ul' || name === 'ol') { lists.pop(); newline(lists.length ? 1 : 2) }
      else if (name === 'pre') { pre = Math.max(0, pre - 1); newline(2) }
      else if (name === 'a') {
        const link = links.pop()
        if (!link) continue
        const href = link.href.trim()
        const text = out.join('').slice(link.start).trim()
        if (href && !/^(#|mailto:$)/i.test(href) && href !== text && !/^javascript:/i.test(href)) {
          out.push(text ? ` (${href.replace(/^mailto:/i, '')})` : href.replace(/^mailto:/i, ''))
        }
      }
    }
  }
  return out.join('')
    .split('\n').map((line) => line.replace(/[ \t]+$/g, '').replace(/^[ \t]+(?![-\d])/g, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    // The HTML twin of a built-in has a plain-text one.
    .replace(/\{\{user_task_description_html\}\}/g, '{{user_task_description}}')
    .trim()
}
