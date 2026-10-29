/**
 * Compare documents: text (line / word / character / sentence), spreadsheets
 * (cell-level, rows matched on key columns) and JSON (deep diff with paths),
 * with statistics, a unified diff, structured changes, an HTML report built
 * from escaped text only, and redline blocks for a DOCX / PDF.
 */

import { DOCUMENT_LIMITS, DocumentLimitError } from './limits'
import { escapeHtml, inlineText, type Block, type Inline } from './model'

export type TextDiffMode = 'lines' | 'words' | 'characters' | 'sentences'

export interface NormaliseOptions {
  ignoreWhitespace?: boolean
  ignoreCase?: boolean
  ignorePunctuation?: boolean
}

export function normaliser(o: NormaliseOptions): (s: string) => string {
  return (s: string) => {
    let t = s
    if (o.ignoreCase) t = t.toLowerCase()
    if (o.ignorePunctuation) t = t.replace(/[\p{P}\p{S}]/gu, '')
    if (o.ignoreWhitespace) t = t.replace(/\s+/g, '')
    return t
  }
}

export interface TextChange {
  type: 'added' | 'removed' | 'changed'
  old_text?: string
  new_text?: string
  /** 1-based line numbers (lines mode). */
  old_line?: number
  new_line?: number
}

export interface TextDiffResult {
  mode: TextDiffMode
  identical: boolean
  /** 0–100: share of the text both versions have in common. */
  similarity: number
  stats: {
    added: number
    removed: number
    changed: number
    unchanged: number
    added_lines: number
    removed_lines: number
    added_words: number
    removed_words: number
    added_characters: number
    removed_characters: number
  }
  changes: TextChange[]
  changes_truncated: boolean
  unified: string
  html: string
  /** Inline redline (inserted / deleted runs) for documents. */
  inline_html: string
}

interface Part { value: string; added?: boolean; removed?: boolean; count?: number }

const MAX_CHANGES = 2000

function countWords(s: string): number {
  return (s.match(/[\p{L}\p{N}]+/gu) ?? []).length
}

function countLines(s: string): number {
  if (!s) return 0
  const n = s.split('\n').length
  return s.endsWith('\n') ? n - 1 : n
}

async function runDiff(a: string, b: string, mode: TextDiffMode, o: NormaliseOptions): Promise<Part[]> {
  const jsdiff = await import('diff')
  const norm = normaliser(o)
  const useComparator = o.ignoreCase || o.ignorePunctuation || o.ignoreWhitespace
  const comparator = useComparator ? (l: string, r: string) => norm(l) === norm(r) : undefined
  // A budget so pathological inputs stop instead of running for minutes.
  const budget = { timeout: 15_000 }
  let parts: Part[] | undefined
  switch (mode) {
    case 'lines':
      parts = jsdiff.diffLines(a, b, { ...budget, ...(comparator ? { comparator } : {}), ignoreWhitespace: o.ignoreWhitespace, stripTrailingCr: true } as never) as Part[] | undefined
      break
    case 'words':
      parts = jsdiff.diffWordsWithSpace(a, b, { ...budget, ...(comparator ? { comparator } : {}), ignoreCase: o.ignoreCase } as never) as Part[] | undefined
      break
    case 'sentences':
      parts = jsdiff.diffSentences(a, b, { ...budget, ...(comparator ? { comparator } : {}) } as never) as Part[] | undefined
      break
    case 'characters':
      if (a.length > DOCUMENT_LIMITS.maxCharDiffChars || b.length > DOCUMENT_LIMITS.maxCharDiffChars) throw new DocumentLimitError(`Character diffs handle up to ${DOCUMENT_LIMITS.maxCharDiffChars.toLocaleString('en')} characters per side — use words or lines`)
      parts = jsdiff.diffChars(a, b, { ...budget, ignoreCase: o.ignoreCase } as never) as Part[] | undefined
      break
  }
  if (!parts) throw new DocumentLimitError('The documents are too different to compare in time — try lines mode')
  return parts
}

/** Paired removed+added parts → "changed". */
function toChanges(parts: Part[], mode: TextDiffMode): { changes: TextChange[]; truncated: boolean } {
  const changes: TextChange[] = []
  let oldLine = 1
  let newLine = 1
  let truncated = false
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k]
    const lines = countLines(p.value)
    if (!p.added && !p.removed) {
      oldLine += lines
      newLine += lines
      continue
    }
    if (changes.length >= MAX_CHANGES) { truncated = true; break }
    const next = parts[k + 1]
    if (p.removed && next?.added) {
      changes.push({ type: 'changed', old_text: p.value, new_text: next.value, ...(mode === 'lines' ? { old_line: oldLine, new_line: newLine } : {}) })
      oldLine += lines
      newLine += countLines(next.value)
      k++
      continue
    }
    if (p.removed) {
      changes.push({ type: 'removed', old_text: p.value, ...(mode === 'lines' ? { old_line: oldLine } : {}) })
      oldLine += lines
    } else {
      changes.push({ type: 'added', new_text: p.value, ...(mode === 'lines' ? { new_line: newLine } : {}) })
      newLine += lines
    }
  }
  return { changes, truncated }
}

/* ── HTML report (escaped text, inline styles: email-safe, light and dark) ── */

const STYLE = {
  wrap: 'font-family:inherit;font-size:13px;line-height:1.45;color:inherit',
  stats: 'margin:0 0 10px;padding:8px 10px;border:1px solid rgba(127,127,127,.35);border-radius:6px',
  table: 'border-collapse:collapse;width:100%;table-layout:fixed',
  th: 'text-align:left;padding:4px 6px;border-bottom:1px solid rgba(127,127,127,.45);font-weight:600',
  num: 'width:3.2em;padding:1px 6px;text-align:right;opacity:.6;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;vertical-align:top',
  cell: 'padding:1px 6px;white-space:pre-wrap;word-break:break-word;vertical-align:top;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px',
  del: 'background:rgba(239,68,68,.22);text-decoration:line-through',
  ins: 'background:rgba(16,185,129,.24);text-decoration:underline',
  delRow: 'background:rgba(239,68,68,.10)',
  insRow: 'background:rgba(16,185,129,.12)',
  gap: 'padding:3px 6px;opacity:.6;font-style:italic;text-align:center',
}

export function statsLine(stats: TextDiffResult['stats'], similarity: number): string {
  return `${stats.changed} changed · ${stats.added} added · ${stats.removed} removed · ${similarity}% similar`
}

function intraLine(a: string, b: string, jsdiff: typeof import('diff')): { left: string; right: string } {
  const parts = jsdiff.diffWordsWithSpace(a, b) as Part[]
  let left = ''
  let right = ''
  for (const p of parts) {
    const v = escapeHtml(p.value)
    if (p.removed) left += `<span style="${STYLE.del}">${v}</span>`
    else if (p.added) right += `<span style="${STYLE.ins}">${v}</span>`
    else { left += v; right += v }
  }
  return { left, right }
}

/** Side-by-side, line-aligned report with intra-line word highlights; long unchanged runs collapsed. */
async function sideBySide(parts: Part[], titles: { old: string; new: string }, context = 3): Promise<string> {
  const jsdiff = await import('diff')
  type Row = { kind: 'same' | 'del' | 'ins' | 'chg'; ol?: number; nl?: number; l: string; r: string }
  const rows: Row[] = []
  let ol = 1
  let nl = 1
  const split = (v: string) => { const ls = v.split('\n'); if (v.endsWith('\n')) ls.pop(); return ls }
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k]
    if (!p.added && !p.removed) {
      for (const line of split(p.value)) rows.push({ kind: 'same', ol: ol++, nl: nl++, l: escapeHtml(line), r: escapeHtml(line) })
      continue
    }
    const next = parts[k + 1]
    if (p.removed && next?.added) {
      const a = split(p.value)
      const b = split(next.value)
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (i < a.length && i < b.length) {
          const { left, right } = intraLine(a[i], b[i], jsdiff)
          rows.push({ kind: 'chg', ol: ol++, nl: nl++, l: left, r: right })
        } else if (i < a.length) rows.push({ kind: 'del', ol: ol++, l: `<span style="${STYLE.del}">${escapeHtml(a[i])}</span>`, r: '' })
        else rows.push({ kind: 'ins', nl: nl++, l: '', r: `<span style="${STYLE.ins}">${escapeHtml(b[i])}</span>` })
      }
      k++
      continue
    }
    for (const line of split(p.value)) {
      if (p.removed) rows.push({ kind: 'del', ol: ol++, l: `<span style="${STYLE.del}">${escapeHtml(line)}</span>`, r: '' })
      else rows.push({ kind: 'ins', nl: nl++, l: '', r: `<span style="${STYLE.ins}">${escapeHtml(line)}</span>` })
    }
  }
  // Collapse unchanged runs beyond `context` lines around changes.
  const keep = rows.map((r) => r.kind !== 'same')
  const show = rows.map((_, i) => {
    for (let d = -context; d <= context; d++) if (keep[i + d]) return true
    return false
  })
  const html: string[] = []
  let hidden = 0
  let emitted = 0
  for (let i = 0; i < rows.length; i++) {
    if (!show[i]) { hidden++; continue }
    if (hidden) { html.push(`<tr><td colspan="4" style="${STYLE.gap}">… ${hidden} unchanged line${hidden === 1 ? '' : 's'} …</td></tr>`); hidden = 0 }
    if (++emitted > 5000) { html.push(`<tr><td colspan="4" style="${STYLE.gap}">… report cut at 5,000 lines …</td></tr>`); break }
    const r = rows[i]
    const lbg = r.kind === 'del' || r.kind === 'chg' ? STYLE.delRow : ''
    const rbg = r.kind === 'ins' || r.kind === 'chg' ? STYLE.insRow : ''
    html.push(`<tr><td style="${STYLE.num}">${r.ol ?? ''}</td><td style="${STYLE.cell};${lbg}">${r.l}</td><td style="${STYLE.num}">${r.nl ?? ''}</td><td style="${STYLE.cell};${rbg}">${r.r}</td></tr>`)
  }
  if (hidden) html.push(`<tr><td colspan="4" style="${STYLE.gap}">… ${hidden} unchanged line${hidden === 1 ? '' : 's'} …</td></tr>`)
  return `<table style="${STYLE.table}"><colgroup><col style="width:3.2em"><col><col style="width:3.2em"><col></colgroup><thead><tr><th style="${STYLE.th}"></th><th style="${STYLE.th}">${escapeHtml(titles.old)}</th><th style="${STYLE.th}"></th><th style="${STYLE.th}">${escapeHtml(titles.new)}</th></tr></thead><tbody>${html.join('')}</tbody></table>`
}

function inlineRedline(parts: Part[]): string {
  return parts.map((p) => {
    const v = escapeHtml(p.value).replace(/\n/g, '<br>')
    if (p.removed) return `<del style="${STYLE.del}">${v}</del>`
    if (p.added) return `<ins style="${STYLE.ins}">${v}</ins>`
    return v
  }).join('')
}

export function reportShell(title: string, statsText: string, body: string): string {
  return `<div style="${STYLE.wrap}"><p style="${STYLE.stats}"><strong>${escapeHtml(title)}</strong><br>${escapeHtml(statsText)}</p>${body}</div>`
}

/** A standalone HTML document around a report fragment (for the saved report file). */
export function htmlDocument(title: string, fragment: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)}</title></head><body style="margin:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">${fragment}</body></html>`
}

/**
 * 0–100. Characters mode: shared characters; otherwise shared words (a
 * one-word edit in a long line counts as one word, not the whole line).
 */
async function similarityOf(A: string, B: string, mode: TextDiffMode, wordParts: Part[] | null, commonChars: number, o: NormaliseOptions): Promise<number> {
  const pct = (common: number, total: number) => (total === 0 ? 100 : Math.round(((2 * common) / total) * 1000) / 10)
  if (mode === 'characters') return pct(commonChars, A.length + B.length)
  let parts = wordParts
  if (!parts) {
    try { parts = await runDiff(A, B, 'words', o) } catch { return pct(commonChars, A.length + B.length) }
  }
  let common = 0
  for (const p of parts) if (!p.added && !p.removed) common += countWords(p.value)
  return pct(common, countWords(A) + countWords(B))
}

export async function diffText(a: string, b: string, options: NormaliseOptions & { mode?: TextDiffMode; context?: number; oldName?: string; newName?: string } = {}): Promise<TextDiffResult> {
  if (a.length > DOCUMENT_LIMITS.maxDiffChars || b.length > DOCUMENT_LIMITS.maxDiffChars) throw new DocumentLimitError(`Each side can have at most ${DOCUMENT_LIMITS.maxDiffChars.toLocaleString('en')} characters`)
  const mode = options.mode ?? 'lines'
  // Ignored punctuation is removed and whitespace runs collapsed before comparing
  // (case is ignored by the comparator, so the text keeps its case).
  const prepare = (t: string) => {
    let s = t.replace(/\r\n?/g, '\n')
    if (options.ignorePunctuation) s = s.replace(/[\p{P}\p{S}]/gu, '')
    if (options.ignoreWhitespace) s = s.replace(/[ \t\f\v\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim()
    return s
  }
  const A = prepare(a)
  const B = prepare(b)
  const parts = await runDiff(A, B, mode, options)
  const stats = { added: 0, removed: 0, changed: 0, unchanged: 0, added_lines: 0, removed_lines: 0, added_words: 0, removed_words: 0, added_characters: 0, removed_characters: 0 }
  let common = 0
  for (const p of parts) {
    if (p.added) { stats.added_lines += countLines(p.value); stats.added_words += countWords(p.value); stats.added_characters += p.value.length }
    else if (p.removed) { stats.removed_lines += countLines(p.value); stats.removed_words += countWords(p.value); stats.removed_characters += p.value.length }
    else { common += p.value.length; stats.unchanged += mode === 'lines' ? countLines(p.value) : 1 }
  }
  const { changes, truncated } = toChanges(parts, mode)
  for (const c of changes) stats[c.type]++
  const similarity = await similarityOf(A, B, mode, mode === 'words' ? parts : null, common, options)
  const identical = parts.every((p) => !p.added && !p.removed)
  const jsdiff = await import('diff')
  const oldName = options.oldName ?? 'Original'
  const newName = options.newName ?? 'Revised'
  const unified = identical ? '' : jsdiff.createTwoFilesPatch(oldName, newName, A.endsWith('\n') ? A : `${A}\n`, B.endsWith('\n') ? B : `${B}\n`, '', '', { context: options.context ?? 3, ignoreWhitespace: options.ignoreWhitespace } as never) as unknown as string
  const lineParts = mode === 'lines' ? parts : await runDiff(A, B, 'lines', options)
  const sbs = await sideBySide(lineParts, { old: oldName, new: newName }, options.context ?? 3)
  const result: TextDiffResult = {
    mode,
    identical,
    similarity,
    stats,
    changes,
    changes_truncated: truncated,
    unified,
    html: '',
    inline_html: inlineRedline(mode === 'lines' ? await runDiff(A, B, 'words', options) : parts),
  }
  result.html = reportShell(`${oldName} → ${newName}`, identical ? 'No differences' : statsLine(stats, similarity), sbs)
  return result
}

/* ── Redline blocks (for DOCX / PDF) ────────────────────────────────── */

function blockKey(b: Block): string {
  if ('inlines' in b) return inlineText(b.inlines)
  if (b.type === 'table') return b.rows.map((r) => r.join('\t')).join('\n')
  if (b.type === 'code') return b.text
  return `[${b.type}]`
}

function withInlines(b: Block, inlines: Inline[]): Block {
  if ('inlines' in b) return { ...b, inlines }
  return { type: 'paragraph', inlines }
}

function mark(b: Block, flag: 'ins' | 'del'): Block[] {
  if ('inlines' in b) return [{ ...b, inlines: b.inlines.map((i) => ({ ...i, [flag]: true })) }]
  if (b.type === 'table') return b.rows.map((r) => ({ type: 'paragraph' as const, inlines: [{ text: r.join(' | '), [flag]: true }] }))
  if (b.type === 'code') return [{ type: 'paragraph', inlines: [{ text: b.text, code: true, [flag]: true }] }]
  return [b]
}

/** Paragraph-aligned redline: unchanged blocks kept, changed ones word-diffed, the rest inserted / deleted. */
export async function redlineBlocks(a: Block[], b: Block[], options: NormaliseOptions = {}): Promise<Block[]> {
  const jsdiff = await import('diff')
  const norm = normaliser(options)
  const ak = a.map(blockKey)
  const bk = b.map(blockKey)
  const parts = jsdiff.diffArrays(ak, bk, { comparator: (l: string, r: string) => norm(l) === norm(r) } as never) as unknown as Array<{ value: string[]; added?: boolean; removed?: boolean }>
  const out: Block[] = []
  let ai = 0
  let bi = 0
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k]
    if (!p.added && !p.removed) {
      for (let n = 0; n < p.value.length; n++) out.push(b[bi + n])
      ai += p.value.length
      bi += p.value.length
      continue
    }
    const next = parts[k + 1]
    if (p.removed && next?.added) {
      const removed = a.slice(ai, ai + p.value.length)
      const added = b.slice(bi, bi + next.value.length)
      const pairs = Math.min(removed.length, added.length)
      for (let n = 0; n < pairs; n++) {
        const oldB = removed[n]
        const newB = added[n]
        if ('inlines' in oldB && 'inlines' in newB) {
          const wd = jsdiff.diffWordsWithSpace(inlineText(oldB.inlines), inlineText(newB.inlines)) as Part[]
          out.push(withInlines(newB, wd.filter((x) => x.value).map((x) => ({ text: x.value, ...(x.added ? { ins: true } : {}), ...(x.removed ? { del: true } : {}) }))))
        } else if (oldB.type === 'table' && newB.type === 'table') {
          const rows = newB.rows.map((r, ri) => r.map((cell, ci) => {
            const before = oldB.rows[ri]?.[ci] ?? ''
            return norm(before) === norm(cell) ? cell : before ? `${cell}  [was: ${before}]` : cell
          }))
          out.push({ type: 'quote', inlines: [{ text: 'Table changed — changed cells show their previous value.', italic: true }] })
          out.push({ ...newB, rows })
        } else {
          out.push(...mark(oldB, 'del'), ...mark(newB, 'ins'))
        }
      }
      for (const extra of removed.slice(pairs)) out.push(...mark(extra, 'del'))
      for (const extra of added.slice(pairs)) out.push(...mark(extra, 'ins'))
      ai += p.value.length
      bi += next.value.length
      k++
      continue
    }
    if (p.removed) {
      for (const blk of a.slice(ai, ai + p.value.length)) out.push(...mark(blk, 'del'))
      ai += p.value.length
    } else {
      for (const blk of b.slice(bi, bi + p.value.length)) out.push(...mark(blk, 'ins'))
      bi += p.value.length
    }
  }
  return out
}

/* ── Spreadsheet diff ───────────────────────────────────────────────── */

export interface SheetDiffOptions extends NormaliseOptions {
  keyColumns?: string[]
  compareColumns?: string[]
  ignoreColumns?: string[]
  /** Numbers within this difference are equal (default 0). */
  numericTolerance?: number
}

export interface CellChange { column: string; old: unknown; new: unknown }
export interface RowChange {
  type: 'added' | 'removed' | 'changed'
  key: Record<string, unknown>
  /** 1-based data row numbers. */
  old_row?: number
  new_row?: number
  old?: Record<string, unknown>
  new?: Record<string, unknown>
  columns?: CellChange[]
}

export interface SheetDiffResult {
  mode: 'sheet'
  identical: boolean
  similarity: number
  key_columns: string[]
  stats: { rows_old: number; rows_new: number; added: number; removed: number; changed: number; unchanged: number; cells_changed: number; columns_added: string[]; columns_removed: string[] }
  changes: RowChange[]
  changes_truncated: boolean
  warnings: string[]
  html: string
}

function sameValue(a: unknown, b: unknown, o: SheetDiffOptions, norm: (s: string) => string): boolean {
  const blank = (v: unknown) => v === null || v === undefined || v === ''
  if (blank(a) && blank(b)) return true
  const na = typeof a === 'number' ? a : typeof a === 'string' && a.trim() !== '' && Number.isFinite(Number(a)) ? Number(a) : NaN
  const nb = typeof b === 'number' ? b : typeof b === 'string' && b.trim() !== '' && Number.isFinite(Number(b)) ? Number(b) : NaN
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return Math.abs(na - nb) <= (o.numericTolerance ?? 0)
  return norm(String(a ?? '')) === norm(String(b ?? ''))
}

export function diffRows(oldRows: Record<string, unknown>[], newRows: Record<string, unknown>[], options: SheetDiffOptions = {}): SheetDiffResult {
  if (oldRows.length > DOCUMENT_LIMITS.maxDiffRows || newRows.length > DOCUMENT_LIMITS.maxDiffRows) throw new DocumentLimitError(`Each sheet can have at most ${DOCUMENT_LIMITS.maxDiffRows.toLocaleString('en')} rows to compare`)
  const norm = normaliser(options)
  const keyNorm = normaliser({ ignoreCase: options.ignoreCase, ignoreWhitespace: true })
  const colsOld = [...new Set(oldRows.flatMap((r) => Object.keys(r)))]
  const colsNew = [...new Set(newRows.flatMap((r) => Object.keys(r)))]
  const keys = (options.keyColumns ?? []).map((k) => k.trim()).filter(Boolean)
  const warnings: string[] = []
  for (const k of keys) if (!colsOld.includes(k) || !colsNew.includes(k)) warnings.push(`Key column "${k}" is missing from ${!colsOld.includes(k) ? 'the original' : 'the revised'} sheet`)
  const ignore = new Set(options.ignoreColumns ?? [])
  const compare = (options.compareColumns?.length ? options.compareColumns : [...new Set([...colsOld, ...colsNew])]).filter((c) => !ignore.has(c) && !keys.includes(c))
  const keyOf = (row: Record<string, unknown>, idx: number) => (keys.length ? keys.map((k) => keyNorm(String(row[k] ?? ''))).join('\u0001') : `#${idx}`)
  const index = (rows: Record<string, unknown>[], side: string) => {
    const map = new Map<string, { row: Record<string, unknown>; n: number }>()
    rows.forEach((row, i) => {
      let key = keyOf(row, i)
      if (map.has(key)) {
        let d = 2
        while (map.has(`${key}\u0002${d}`)) d++
        if (d === 2) warnings.push(`Duplicate key ${JSON.stringify(keys.map((k) => row[k]))} in the ${side} sheet — matched in order`)
        key = `${key}\u0002${d}`
      }
      map.set(key, { row, n: i + 1 })
    })
    return map
  }
  const A = index(oldRows, 'original')
  const B = index(newRows, 'revised')
  const changes: RowChange[] = []
  let unchanged = 0
  let cellsChanged = 0
  let truncated = false
  const keyObj = (row: Record<string, unknown>, n: number) => (keys.length ? Object.fromEntries(keys.map((k) => [k, row[k] ?? null])) : { row: n })
  const push = (c: RowChange) => { if (changes.length < MAX_CHANGES) changes.push(c); else truncated = true }
  let changed = 0
  let added = 0
  let removed = 0
  for (const [key, { row, n }] of A) {
    const other = B.get(key)
    if (!other) { removed++; push({ type: 'removed', key: keyObj(row, n), old_row: n, old: row }); continue }
    const cols: CellChange[] = []
    for (const c of compare) if (!sameValue(row[c], other.row[c], options, norm)) cols.push({ column: c, old: row[c] ?? null, new: other.row[c] ?? null })
    if (cols.length) { changed++; cellsChanged += cols.length; push({ type: 'changed', key: keyObj(other.row, other.n), old_row: n, new_row: other.n, columns: cols }) }
    else unchanged++
  }
  for (const [key, { row, n }] of B) if (!A.has(key)) { added++; push({ type: 'added', key: keyObj(row, n), new_row: n, new: row }) }
  const union = A.size + added
  const result: SheetDiffResult = {
    mode: 'sheet',
    identical: !changed && !added && !removed,
    similarity: union ? Math.round((unchanged / union) * 1000) / 10 : 100,
    key_columns: keys,
    stats: {
      rows_old: oldRows.length, rows_new: newRows.length, added, removed, changed, unchanged, cells_changed: cellsChanged,
      columns_added: colsNew.filter((c) => !colsOld.includes(c)), columns_removed: colsOld.filter((c) => !colsNew.includes(c)),
    },
    changes,
    changes_truncated: truncated,
    warnings,
    html: '',
  }
  result.html = sheetReport(result)
  return result
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return ''
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

function sheetReport(r: SheetDiffResult): string {
  const rows = r.changes.slice(0, 2000).map((c) => {
    const key = escapeHtml(Object.entries(c.key).map(([k, v]) => `${k}=${fmt(v)}`).join(', '))
    if (c.type === 'changed') {
      const cells = (c.columns ?? []).map((x) => `${escapeHtml(x.column)}: <span style="${STYLE.del}">${escapeHtml(fmt(x.old))}</span> → <span style="${STYLE.ins}">${escapeHtml(fmt(x.new))}</span>`).join('<br>')
      return `<tr><td style="${STYLE.cell}">changed</td><td style="${STYLE.cell}">${key}</td><td style="${STYLE.cell}">${cells}</td></tr>`
    }
    const row = c.type === 'added' ? c.new : c.old
    const text = escapeHtml(Object.entries(row ?? {}).map(([k, v]) => `${k}: ${fmt(v)}`).join(' · '))
    return `<tr style="${c.type === 'added' ? STYLE.insRow : STYLE.delRow}"><td style="${STYLE.cell}">${c.type}</td><td style="${STYLE.cell}">${key}</td><td style="${STYLE.cell}">${text}</td></tr>`
  }).join('')
  const s = r.stats
  const extra = [s.columns_added.length ? `columns added: ${s.columns_added.join(', ')}` : '', s.columns_removed.length ? `columns removed: ${s.columns_removed.join(', ')}` : ''].filter(Boolean).join(' · ')
  const statsText = `${s.changed} rows changed (${s.cells_changed} cells) · ${s.added} added · ${s.removed} removed · ${s.unchanged} unchanged · ${r.similarity}% similar${extra ? ` · ${extra}` : ''}`
  const body = r.identical ? '' : `<table style="${STYLE.table}"><colgroup><col style="width:6em"><col style="width:28%"><col></colgroup><thead><tr><th style="${STYLE.th}">Change</th><th style="${STYLE.th}">Row</th><th style="${STYLE.th}">Values</th></tr></thead><tbody>${rows}</tbody></table>`
  return reportShell('Spreadsheet comparison', r.identical ? 'No differences' : statsText, body)
}

/* ── JSON deep diff ─────────────────────────────────────────────────── */

export interface JsonChange { type: 'added' | 'removed' | 'changed'; path: string; old?: unknown; new?: unknown }

export interface JsonDiffResult {
  mode: 'json'
  identical: boolean
  similarity: number
  stats: { added: number; removed: number; changed: number; unchanged: number }
  changes: JsonChange[]
  changes_truncated: boolean
  html: string
}

function pathJoin(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`
  return /^[A-Za-z_$][\w$]*$/.test(key) ? (base ? `${base}.${key}` : key) : `${base}[${JSON.stringify(key)}]`
}

export function diffJson(a: unknown, b: unknown, options: NormaliseOptions & { arrayKey?: string } = {}): JsonDiffResult {
  const norm = normaliser(options)
  const changes: JsonChange[] = []
  let unchanged = 0
  let truncated = false
  let steps = 0
  const add = (c: JsonChange) => { if (changes.length < MAX_CHANGES) changes.push(c); else truncated = true }
  const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
  const walk = (x: unknown, y: unknown, path: string, depth: number) => {
    if (++steps > 2_000_000 || depth > 200) throw new DocumentLimitError('The JSON is too large or too deep to compare')
    if (isObj(x) && isObj(y)) {
      for (const k of Object.keys(x)) {
        if (!(k in y)) add({ type: 'removed', path: pathJoin(path, k), old: x[k] })
        else walk(x[k], y[k], pathJoin(path, k), depth + 1)
      }
      for (const k of Object.keys(y)) if (!(k in x)) add({ type: 'added', path: pathJoin(path, k), new: y[k] })
      return
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      const key = options.arrayKey
      if (key && [...x, ...y].every((e) => isObj(e) && key in e)) {
        const mx = new Map(x.map((e) => [String((e as Record<string, unknown>)[key]), e]))
        const my = new Map(y.map((e) => [String((e as Record<string, unknown>)[key]), e]))
        for (const [k, v] of mx) {
          const p = `${path}[${key}=${JSON.stringify(k)}]`
          if (!my.has(k)) add({ type: 'removed', path: p, old: v })
          else walk(v, my.get(k), p, depth + 1)
        }
        for (const [k, v] of my) if (!mx.has(k)) add({ type: 'added', path: `${path}[${key}=${JSON.stringify(k)}]`, new: v })
        return
      }
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if (i >= y.length) add({ type: 'removed', path: pathJoin(path, i), old: x[i] })
        else if (i >= x.length) add({ type: 'added', path: pathJoin(path, i), new: y[i] })
        else walk(x[i], y[i], pathJoin(path, i), depth + 1)
      }
      return
    }
    const same = typeof x === 'string' && typeof y === 'string' ? norm(x) === norm(y) : JSON.stringify(x) === JSON.stringify(y)
    if (same) unchanged++
    else add({ type: 'changed', path: path || '$', old: x, new: y })
  }
  walk(a, b, '', 0)
  const stats = { added: 0, removed: 0, changed: 0, unchanged }
  for (const c of changes) stats[c.type]++
  const total = stats.added + stats.removed + stats.changed + unchanged
  const result: JsonDiffResult = {
    mode: 'json',
    identical: changes.length === 0,
    similarity: total ? Math.round((unchanged / total) * 1000) / 10 : 100,
    stats,
    changes,
    changes_truncated: truncated,
    html: '',
  }
  const rows = changes.map((c) => `<tr style="${c.type === 'added' ? STYLE.insRow : c.type === 'removed' ? STYLE.delRow : ''}"><td style="${STYLE.cell}">${c.type}</td><td style="${STYLE.cell}">${escapeHtml(c.path)}</td><td style="${STYLE.cell}">${c.type !== 'added' ? `<span style="${STYLE.del}">${escapeHtml(fmt(c.old))}</span>` : ''}${c.type === 'changed' ? ' → ' : ''}${c.type !== 'removed' ? `<span style="${STYLE.ins}">${escapeHtml(fmt(c.new))}</span>` : ''}</td></tr>`).join('')
  result.html = reportShell('JSON comparison', result.identical ? 'No differences' : `${stats.changed} changed · ${stats.added} added · ${stats.removed} removed · ${result.similarity}% similar`, result.identical ? '' : `<table style="${STYLE.table}"><colgroup><col style="width:6em"><col style="width:30%"><col></colgroup><thead><tr><th style="${STYLE.th}">Change</th><th style="${STYLE.th}">Path</th><th style="${STYLE.th}">Value</th></tr></thead><tbody>${rows}</tbody></table>`)
  return result
}
