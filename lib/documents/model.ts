/**
 * The neutral document model every reader produces and every writer
 * consumes: a list of blocks (headings, paragraphs, list items, tables, code,
 * quotes, rules) made of inline runs. Text, Markdown and HTML renderings are
 * derived from it, so every format reads the same way. HTML is built from
 * escaped text only (never from input markup), so it is safe by
 * construction.
 */

export interface Inline {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
  href?: string
  /** Tracked change / redline: inserted or deleted text. */
  ins?: boolean
  del?: boolean
}

export type Block =
  | { type: 'heading'; level: number; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list_item'; ordered: boolean; level: number; inlines: Inline[] }
  | { type: 'table'; rows: string[][]; header: boolean }
  | { type: 'code'; text: string; lang?: string }
  | { type: 'quote'; inlines: Inline[] }
  | { type: 'hr' }
  | { type: 'page_break' }

export function plain(text: string): Inline[] {
  return text ? [{ text }] : []
}

export function inlineText(inlines: Inline[]): string {
  return inlines.map((i) => i.text).join('')
}

/* ── Text ───────────────────────────────────────────────────────────── */

export function blocksToText(blocks: Block[]): string {
  const out: string[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': case 'paragraph': case 'quote':
        out.push(inlineText(b.inlines))
        break
      case 'list_item':
        out.push(`${'  '.repeat(b.level)}${b.ordered ? '-' : '•'} ${inlineText(b.inlines)}`)
        break
      case 'table':
        out.push(b.rows.map((r) => r.join('\t')).join('\n'))
        break
      case 'code':
        out.push(b.text)
        break
      case 'hr': case 'page_break':
        out.push('')
        break
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/* ── Markdown ───────────────────────────────────────────────────────── */

function mdEscape(text: string): string {
  return text.replace(/([\\`*_[\]<>|])/g, '\\$1').replace(/^(\s*)([#>+-]|\d+\.)(\s)/, '$1\\$2$3')
}

function inlinesToMarkdown(inlines: Inline[]): string {
  return inlines.map((i) => {
    if (!i.text) return ''
    if (i.code) return `\`${i.text.replace(/`/g, 'ˋ')}\``
    let t = mdEscape(i.text)
    const lead = t.match(/^\s*/)![0]
    const trail = t.match(/\s*$/)![0]
    let core = t.trim()
    if (!core) return t
    if (i.del || i.strike) core = `~~${core}~~`
    if (i.bold) core = `**${core}**`
    if (i.italic) core = `*${core}*`
    if (i.ins && !i.underline) core = `<ins>${core}</ins>`
    if (i.href && safeHref(i.href)) core = `[${core}](${i.href.replace(/[()\s]/g, encodeURIComponent)})`
    t = lead + core + trail
    return t
  }).join('')
}

function tableCell(text: string): string {
  return mdEscape(text).replace(/\r?\n/g, '<br>')
}

export function blocksToMarkdown(blocks: Block[]): string {
  const out: string[] = []
  let prevList = false
  for (const b of blocks) {
    const isList = b.type === 'list_item'
    if (prevList && !isList) out.push('')
    switch (b.type) {
      case 'heading':
        out.push(`${'#'.repeat(Math.min(6, Math.max(1, b.level)))} ${inlinesToMarkdown(b.inlines)}`, '')
        break
      case 'paragraph': {
        const md = inlinesToMarkdown(b.inlines)
        if (md.trim()) out.push(md, '')
        break
      }
      case 'quote':
        out.push(`> ${inlinesToMarkdown(b.inlines)}`, '')
        break
      case 'list_item':
        out.push(`${'  '.repeat(b.level)}${b.ordered ? '1.' : '-'} ${inlinesToMarkdown(b.inlines)}`)
        break
      case 'table': {
        if (!b.rows.length) break
        const width = Math.max(...b.rows.map((r) => r.length))
        const pad = (r: string[]) => Array.from({ length: width }, (_, k) => tableCell(r[k] ?? ''))
        const head = b.header ? b.rows[0] : Array.from({ length: width }, (_, k) => `Column ${k + 1}`)
        const body = b.header ? b.rows.slice(1) : b.rows
        out.push(`| ${pad(head).join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`)
        for (const r of body) out.push(`| ${pad(r).join(' | ')} |`)
        out.push('')
        break
      }
      case 'code': {
        const fence = b.text.includes('```') ? '~~~~' : '```'
        out.push(`${fence}${b.lang ?? ''}`, b.text, fence, '')
        break
      }
      case 'hr': case 'page_break':
        out.push('---', '')
        break
    }
    prevList = isList
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/* ── HTML (escaped; safe by construction) ───────────────────────────── */

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** http(s) / mailto / relative / in-page links only. */
export function safeHref(href: string): boolean {
  // eslint-disable-next-line no-control-regex -- strip whitespace / control characters browsers ignore
  const h = href.replace(/[\u0000-\u0020\u007f]/g, '').toLowerCase()
  if (!h) return false
  if (h.startsWith('#') || h.startsWith('/') && !h.startsWith('//')) return true
  return /^(https?:|mailto:)/.test(h)
}

function inlinesToHtml(inlines: Inline[]): string {
  return inlines.map((i) => {
    let t = escapeHtml(i.text).replace(/\r?\n/g, '<br>')
    if (i.code) t = `<code>${t}</code>`
    if (i.bold) t = `<strong>${t}</strong>`
    if (i.italic) t = `<em>${t}</em>`
    // <u> / <s> (not <ins> / <del>) so the allowlist sanitiser keeps tracked changes visible.
    if (i.underline || i.ins) t = `<u>${t}</u>`
    if (i.strike || i.del) t = `<s>${t}</s>`
    if (i.href && safeHref(i.href)) t = `<a href="${escapeHtml(i.href)}" rel="noopener noreferrer" target="_blank">${t}</a>`
    return t
  }).join('')
}

export function blocksToHtml(blocks: Block[]): string {
  const out: string[] = []
  const listStack: Array<'ul' | 'ol'> = []
  const closeLists = (depth: number) => {
    while (listStack.length > depth) out.push(`</li></${listStack.pop()}>`)
  }
  for (const b of blocks) {
    if (b.type !== 'list_item') closeLists(0)
    switch (b.type) {
      case 'heading': {
        const level = Math.min(6, Math.max(1, b.level))
        out.push(`<h${level}>${inlinesToHtml(b.inlines)}</h${level}>`)
        break
      }
      case 'paragraph':
        if (b.inlines.some((i) => i.text.trim())) out.push(`<p>${inlinesToHtml(b.inlines)}</p>`)
        break
      case 'quote':
        out.push(`<blockquote>${inlinesToHtml(b.inlines)}</blockquote>`)
        break
      case 'list_item': {
        const tag = b.ordered ? 'ol' : 'ul'
        const depth = Math.min(8, b.level) + 1
        if (listStack.length === depth) out.push('</li>')
        else if (listStack.length > depth) { closeLists(depth); out.push('</li>') }
        while (listStack.length < depth) { out.push(`<${tag}>`); listStack.push(tag) }
        out.push(`<li>${inlinesToHtml(b.inlines)}`)
        break
      }
      case 'table': {
        if (!b.rows.length) break
        const rows = b.rows.map((r, idx) => {
          const cell = b.header && idx === 0 ? 'th' : 'td'
          return `<tr>${r.map((c) => `<${cell}>${escapeHtml(c).replace(/\r?\n/g, '<br>')}</${cell}>`).join('')}</tr>`
        })
        if (b.header) out.push(`<table><thead>${rows[0]}</thead><tbody>${rows.slice(1).join('')}</tbody></table>`)
        else out.push(`<table><tbody>${rows.join('')}</tbody></table>`)
        break
      }
      case 'code':
        out.push(`<pre><code>${escapeHtml(b.text)}</code></pre>`)
        break
      case 'hr': case 'page_break':
        out.push('<hr>')
        break
    }
  }
  closeLists(0)
  return out.join('\n')
}

/* ── Structure helpers ──────────────────────────────────────────────── */

export function headingsOf(blocks: Block[]): Array<{ level: number; text: string }> {
  return blocks.filter((b): b is Extract<Block, { type: 'heading' }> => b.type === 'heading')
    .map((b) => ({ level: b.level, text: inlineText(b.inlines).trim() }))
    .filter((h) => h.text)
}

export function linksOf(blocks: Block[]): Array<{ text: string; href: string }> {
  const out: Array<{ text: string; href: string }> = []
  for (const b of blocks) {
    if (!('inlines' in b)) continue
    for (const i of b.inlines) if (i.href) out.push({ text: i.text, href: i.href })
  }
  // Merge adjacent runs of the same link.
  const merged: typeof out = []
  for (const l of out) {
    const last = merged[merged.length - 1]
    if (last && last.href === l.href) last.text += l.text
    else merged.push({ ...l })
  }
  return merged
}

export interface TableOut {
  header: string[]
  rows: string[][]
  /** Rows as objects keyed by the header (when the table has one). */
  records: Record<string, string>[]
}

export function tableToOut(rows: string[][], header: boolean): TableOut {
  if (!rows.length) return { header: [], rows: [], records: [] }
  const head = header ? uniqueHeaders(rows[0]) : rows[0].map((_, k) => `column_${k + 1}`)
  const body = header ? rows.slice(1) : rows
  return {
    header: head,
    rows: body,
    records: body.map((r) => Object.fromEntries(head.map((h, k) => [h, r[k] ?? '']))),
  }
}

export function tablesOf(blocks: Block[]): TableOut[] {
  return blocks.filter((b): b is Extract<Block, { type: 'table' }> => b.type === 'table').map((t) => tableToOut(t.rows, t.header))
}

export function uniqueHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>()
  return raw.map((h, k) => {
    const base = String(h ?? '').trim() || `column_${k + 1}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n ? `${base}_${n}` : base
  })
}

/* ── Counts ─────────────────────────────────────────────────────────── */

export interface TextStats {
  words: number
  characters: number
  characters_no_spaces: number
  lines: number
  paragraphs: number
  sentences: number
  reading_time_minutes: number
}

/** Word/character counts; reading time at 230 words per minute (rounded up, 0 for empty text). */
export function textStats(text: string, wordsPerMinute = 230): TextStats {
  const trimmed = text.trim()
  const words = trimmed ? (trimmed.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) ?? []).length : 0
  return {
    words,
    characters: [...text].length,
    characters_no_spaces: [...text.replace(/\s/g, '')].length,
    lines: trimmed ? text.split(/\r?\n/).length : 0,
    paragraphs: trimmed ? trimmed.split(/\n\s*\n/).filter((p) => p.trim()).length : 0,
    sentences: trimmed ? (trimmed.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) ?? []).filter((s) => s.trim()).length : 0,
    reading_time_minutes: words ? Math.max(1, Math.ceil(words / wordsPerMinute)) : 0,
  }
}

/** Plain text → blocks (blank-line separated paragraphs). */
export function textToBlocks(text: string): Block[] {
  return text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => ({ type: 'paragraph' as const, inlines: plain(p) }))
}
