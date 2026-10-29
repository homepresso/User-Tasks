/**
 * HTML input → the document model (text, links, tables, headings). A
 * tolerant tokenizer, not a browser: scripts, styles and other active
 * content are dropped with their content, and the output HTML is always
 * re-rendered from the model (escaped), never passed through.
 */

import { decodeEntities } from '@/lib/html-sanitize'
import type { Block, Inline } from './model'

export interface HtmlReadResult {
  blocks: Block[]
  title: string | null
  meta: Record<string, string>
}

const DROP = new Set(['script', 'style', 'template', 'noscript', 'svg', 'math', 'iframe', 'object', 'embed', 'canvas', 'select', 'textarea', 'button', 'audio', 'video', 'map'])
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'figure', 'figcaption', 'address', 'dl', 'dt', 'dd', 'form', 'fieldset', 'legend', 'details', 'summary', 'center', 'body', 'html'])
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'area', 'base', 'wbr', 'source', 'track', 'param', 'embed'])

interface Token { kind: 'open' | 'close' | 'text'; name?: string; attrs?: Record<string, string>; text?: string; selfClosing?: boolean }

function tokenize(html: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) { out.push({ kind: 'text', text: html.slice(i) }); break }
    if (lt > i) out.push({ kind: 'text', text: html.slice(i, lt) })
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      i = end === -1 ? html.length : end + 3
      continue
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt)
      i = end === -1 ? html.length : end + 1
      continue
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt, lt + 64))
    if (!m) { out.push({ kind: 'text', text: '<' }); i = lt + 1; continue }
    // Find the end of the tag, respecting quotes.
    let j = lt + m[0].length
    let quote = ''
    for (; j < html.length; j++) {
      const ch = html[j]
      if (quote) { if (ch === quote) quote = '' } else if (ch === '"' || ch === "'") quote = ch
      else if (ch === '>') break
    }
    const inner = html.slice(lt + m[0].length, j)
    const name = m[2].toLowerCase()
    i = j + 1
    if (m[1]) { out.push({ kind: 'close', name }); continue }
    const attrs: Record<string, string> = {}
    const re = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
    let a: RegExpExecArray | null
    while ((a = re.exec(inner))) attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '')
    out.push({ kind: 'open', name, attrs, selfClosing: inner.trim().endsWith('/') })
    if (DROP.has(name) && !VOID.has(name)) {
      // Skip to the matching close tag (raw text elements).
      const close = html.toLowerCase().indexOf(`</${name}`, i)
      i = close === -1 ? html.length : html.indexOf('>', close) + 1 || html.length
      out.push({ kind: 'close', name })
    }
  }
  return out
}

export function readHtml(html: string): HtmlReadResult {
  const tokens = tokenize(html)
  const blocks: Block[] = []
  const meta: Record<string, string> = {}
  let title: string | null = null
  let inlines: Inline[] = []
  let current: { type: 'paragraph' | 'heading' | 'quote' | 'list_item'; level: number; ordered: boolean } = { type: 'paragraph', level: 0, ordered: false }
  const fmt = { bold: 0, italic: 0, underline: 0, strike: 0, code: 0 }
  const hrefs: string[] = []
  const lists: Array<'ul' | 'ol'> = []
  let pre: string | null = null
  type TableState = { rows: string[][]; row: string[] | null; cell: string | null; header: boolean }
  let table: TableState | null = null
  const tableStack: TableState[] = []
  let dropDepth = 0
  let inTitle = false

  const flush = () => {
    const text = inlines.map((x) => x.text).join('')
    if (text.trim()) {
      // Collapse whitespace at the edges.
      const first = inlines[0]
      if (first) first.text = first.text.replace(/^\s+/, '')
      const last = inlines[inlines.length - 1]
      if (last) last.text = last.text.replace(/\s+$/, '')
      const clean = inlines.filter((x) => x.text)
      if (current.type === 'heading') blocks.push({ type: 'heading', level: current.level, inlines: clean })
      else if (current.type === 'list_item') blocks.push({ type: 'list_item', ordered: current.ordered, level: current.level, inlines: clean })
      else if (current.type === 'quote') blocks.push({ type: 'quote', inlines: clean })
      else blocks.push({ type: 'paragraph', inlines: clean })
    }
    inlines = []
  }
  const addText = (raw: string) => {
    if (table && table.cell !== null) { table.cell += raw; return }
    const text = raw.replace(/\s+/g, ' ')
    if (!text) return
    const prev = inlines[inlines.length - 1]
    const piece: Inline = { text }
    if (fmt.bold) piece.bold = true
    if (fmt.italic) piece.italic = true
    if (fmt.underline) piece.underline = true
    if (fmt.strike) piece.strike = true
    if (fmt.code) piece.code = true
    if (hrefs.length && hrefs[hrefs.length - 1]) piece.href = hrefs[hrefs.length - 1]
    if (prev && prev.text.endsWith(' ') && text.startsWith(' ')) piece.text = text.slice(1)
    if (prev && JSON.stringify({ ...prev, text: '' }) === JSON.stringify({ ...piece, text: '' })) prev.text += piece.text
    else if (piece.text) inlines.push(piece)
  }

  for (const t of tokens) {
    if (t.kind === 'text') {
      if (dropDepth) continue
      const text = decodeEntities(t.text ?? '')
      if (inTitle) { title = (title ?? '') + text; continue }
      if (pre !== null) { pre += text; continue }
      addText(text)
      continue
    }
    const name = t.name!
    if (t.kind === 'open') {
      if (name === 'title') { inTitle = true; continue }
      if (name === 'meta') {
        const key = (t.attrs?.name ?? t.attrs?.property ?? '').toLowerCase()
        if (key && t.attrs?.content) meta[key] = t.attrs.content
        continue
      }
      if (DROP.has(name)) { if (name !== 'head') dropDepth++; continue }
      if (dropDepth) continue
      if (pre !== null) { if (name === 'br') pre += '\n'; continue }
      if (table && table.cell !== null) {
        if (name === 'br' || name === 'p' || name === 'div') table.cell += '\n'
        if (name === 'table') { tableStack.push(table); table = { rows: [], row: null, cell: null, header: false } }
        else continue
      }
      switch (name) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
          flush(); current = { type: 'heading', level: Number(name[1]), ordered: false }; break
        case 'ul': case 'ol': flush(); lists.push(name); break
        case 'li': flush(); current = { type: 'list_item', level: Math.max(0, lists.length - 1), ordered: lists[lists.length - 1] === 'ol' }; break
        case 'blockquote': flush(); current = { type: 'quote', level: 0, ordered: false }; break
        case 'pre': flush(); pre = ''; break
        case 'table': flush(); if (table) tableStack.push(table); table = { rows: [], row: null, cell: null, header: false }; break
        case 'tr': if (table) table.row = []; break
        case 'td': case 'th': if (table) { table.cell = ''; if (name === 'th' && table.rows.length === 0) table.header = true } break
        case 'br': { const last = inlines[inlines.length - 1]; if (last) last.text = last.text.replace(/ $/, ''); inlines.push({ text: '\n' }); break }
        case 'hr': flush(); blocks.push({ type: 'hr' }); break
        case 'b': case 'strong': fmt.bold++; break
        case 'i': case 'em': case 'cite': fmt.italic++; break
        case 'u': case 'ins': fmt.underline++; break
        case 's': case 'strike': case 'del': fmt.strike++; break
        case 'code': case 'kbd': case 'samp': case 'tt': fmt.code++; break
        case 'a': hrefs.push(t.attrs?.href ?? ''); if (t.selfClosing) hrefs.pop(); break
        case 'img': if (t.attrs?.alt) addText(`[${t.attrs.alt}]`); break
        default:
          if (BLOCK.has(name)) { flush(); if (current.type !== 'list_item') current = { type: 'paragraph', level: 0, ordered: false } }
      }
      continue
    }
    // close
    if (name === 'title') { inTitle = false; continue }
    if (DROP.has(name)) { if (name !== 'head' && dropDepth) dropDepth--; continue }
    if (dropDepth) continue
    if (pre !== null) {
      if (name === 'pre') { blocks.push({ type: 'code', text: pre.replace(/^\n/, '').replace(/\s+$/, '') }); pre = null }
      continue
    }
    if (table) {
      if (name === 'td' || name === 'th') {
        if (table.row && table.cell !== null) table.row.push(table.cell.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim())
        table.cell = null
        continue
      }
      if (name === 'tr') { if (table.row) table.rows.push(table.row); table.row = null; continue }
      if (name === 'table') {
        const done = table
        const parent: TableState | null = tableStack.pop() ?? null
        table = parent
        const rows = done.rows.filter((r) => r.length)
        if (parent && parent.cell !== null) parent.cell += rows.map((r) => r.join(' | ')).join('\n')
        else if (rows.length) blocks.push({ type: 'table', rows, header: done.header || rows.length > 1 })
        continue
      }
      if (table.cell !== null) continue
    }
    switch (name) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': case 'blockquote':
        flush(); current = { type: 'paragraph', level: 0, ordered: false }; break
      case 'li': flush(); current = lists.length ? { type: 'list_item', level: lists.length - 1, ordered: lists[lists.length - 1] === 'ol' } : { type: 'paragraph', level: 0, ordered: false }; break
      case 'ul': case 'ol': flush(); lists.pop(); current = { type: 'paragraph', level: 0, ordered: false }; break
      case 'b': case 'strong': fmt.bold = Math.max(0, fmt.bold - 1); break
      case 'i': case 'em': case 'cite': fmt.italic = Math.max(0, fmt.italic - 1); break
      case 'u': case 'ins': fmt.underline = Math.max(0, fmt.underline - 1); break
      case 's': case 'strike': case 'del': fmt.strike = Math.max(0, fmt.strike - 1); break
      case 'code': case 'kbd': case 'samp': case 'tt': fmt.code = Math.max(0, fmt.code - 1); break
      case 'a': hrefs.pop(); break
      default:
        if (BLOCK.has(name)) flush()
    }
  }
  if (pre !== null) blocks.push({ type: 'code', text: pre })
  flush()
  return { blocks, title: title?.trim() || null, meta }
}
