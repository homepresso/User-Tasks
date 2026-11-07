/**
 * Redaction and sensitive-information detection.
 *
 * What is found: information types from lib/documents/pii (national IDs,
 * dates of birth, card and bank numbers, contact details, health numbers,
 * keys and passwords — patterns with check digits, context words and a
 * confidence), the older presets (emails, phone numbers, card numbers,
 * IBANs, US SSNs, IP addresses, URLs, dates), literal terms and custom
 * patterns.
 *
 * Word, PowerPoint and Excel copies are redacted in place (the text runs
 * inside the package, so formatting is kept); text formats keep their
 * format; PDFs are rebuilt from the redacted text. With `detectOnly` nothing
 * is changed: the findings are reported with where they are.
 */

import { createHmac } from 'node:crypto'
import { compileUserRegex, MAX_REGEX_INPUT_LENGTH } from '@/lib/safe-regex'
import { CONFIDENCE_RANK, INFO_CATEGORIES, INFO_TYPE_BY_ID, type Confidence } from './pii/catalog'
import { detectInfoTypes, tokenFor } from './pii/detect'
import { ibanValid } from './pii/validators'
import { openZip, type ZipReader } from './zip'
import { attr, child, descendants, elements, parseXml, serializeXml, type XmlElement } from './xml'

export type RedactPreset = 'email' | 'phone' | 'credit_card' | 'iban' | 'ssn' | 'ip_address' | 'url' | 'date'
export const REDACT_PRESETS: RedactPreset[] = ['email', 'phone', 'credit_card', 'iban', 'ssn', 'ip_address', 'url', 'date']

/** mask / block: █ per character; label: [SSN]; partial: █ but the last 4; hash: [SSN:3f9a…]; text: your text. */
export type RedactStyle = 'block' | 'mask' | 'label' | 'text' | 'partial' | 'hash'
export const REDACT_STYLES: RedactStyle[] = ['block', 'mask', 'label', 'text', 'partial', 'hash']

/** Where a finding is: the unit of text it was found in. */
export interface FindingLocation {
  /** Word: body, header, footer, footnotes, endnotes, comments; PowerPoint: slide, notes, comments. */
  part?: string
  page?: number
  slide?: number
  sheet?: string
  cell?: string
  paragraph?: number
  line?: number
  row?: number
  column?: number
}

export interface RedactOptions {
  presets?: RedactPreset[]
  /** Literal words / phrases (case-insensitive). */
  terms?: string[]
  /** Custom regular expressions (ReDoS-guarded, matched line by line). */
  patterns?: string[]
  /** Information types (resolved ids, see pii/catalog resolveInfoTypes). */
  infoTypes?: string[]
  /** Minimum confidence for information types (default medium). */
  minConfidence?: Confidence
  /** Values an AI model found (person names, addresses), matched literally. */
  aiValues?: ReadonlyArray<{ type: string; text: string }>
  /** Default style. */
  replacement?: RedactStyle
  replacementText?: string
  /** Style per kind (info type id, preset, `term`, `pattern`). */
  styles?: Record<string, RedactStyle>
  /** Key for the `hash` style (per workspace), so equal values get equal tokens. */
  hashKey?: string
  /** Find only: the text is returned unchanged. */
  detectOnly?: boolean
  /** Called with every unit's hits (findings). */
  onHits?: (hits: Hit[], text: string, where: FindingLocation) => void
  /** For tests: today's date for the date-of-birth check. */
  now?: Date
}

export interface RedactTextResult { text: string; counts: Record<string, number>; total: number }

export interface Hit { start: number; end: number; kind: string; confidence: Confidence; source: 'pattern' | 'ai' | 'preset' | 'term' }

/* ── Older presets (kept as they were) ── */

const DETECTORS: Record<RedactPreset, { re: RegExp; check?: (m: string) => boolean }> = {
  email: { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g },
  phone: {
    re: /(?<![\w+])(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{1,4}(?:[\s.-]?\d{2,4}){1,3}(?![\w])/g,
    check: (m) => { const d = m.replace(/\D/g, ''); return d.length >= 7 && d.length <= 15 && !/^\d{4}-\d{1,2}-\d{1,2}$/.test(m.trim()) && !/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(m.trim()) && (/[\s().+-]/.test(m) || d.length >= 9) },
  },
  credit_card: { re: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, check: (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhnOnly(d) } },
  iban: { re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g, check: ibanValid },
  ssn: { re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  ip_address: { re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  url: { re: /\bhttps?:\/\/[^\s<>"'()[\]{}]+[^\s<>"'()[\]{}.,;:!?]/gi },
  date: { re: /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})\b/gi },
}

function luhnOnly(digits: string): boolean {
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48
    if (alt) { n *= 2; if (n > 9) n -= 9 }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

/** Everything to find in one text: info types, presets, terms, patterns. Sorted, merged. */
export function findHits(text: string, o: RedactOptions): Hit[] {
  const hits: Hit[] = []
  if (o.infoTypes?.length || o.aiValues?.length) {
    for (const d of detectInfoTypes(text, { types: o.infoTypes ?? [], minConfidence: o.minConfidence, aiValues: o.aiValues, now: o.now })) {
      hits.push({ start: d.start, end: d.end, kind: d.type, confidence: d.confidence, source: d.source })
    }
  }
  for (const preset of o.presets ?? []) {
    const d = DETECTORS[preset]
    if (!d) continue
    d.re.lastIndex = 0
    for (const m of text.matchAll(d.re)) {
      if (d.check && !d.check(m[0])) continue
      // Trim trailing whitespace the phone / card patterns may include.
      const raw = m[0]
      const lead = raw.length - raw.trimStart().length
      const core = raw.trim()
      hits.push({ start: (m.index ?? 0) + lead, end: (m.index ?? 0) + lead + core.length, kind: preset, confidence: 'medium', source: 'preset' })
    }
  }
  for (const term of o.terms ?? []) {
    const t = String(term ?? '').trim()
    if (!t) continue
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    for (const m of text.matchAll(re)) hits.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind: 'term', confidence: 'high', source: 'term' })
  }
  if (o.patterns?.length) {
    const lines: Array<[number, string]> = []
    let at = 0
    for (const line of text.split('\n')) { lines.push([at, line]); at += line.length + 1 }
    for (const pattern of o.patterns) {
      if (!String(pattern ?? '').trim()) continue
      const re = compileUserRegex(String(pattern), 'gi')
      for (const [offset, line] of lines) {
        const subject = line.length > MAX_REGEX_INPUT_LENGTH ? line.slice(0, MAX_REGEX_INPUT_LENGTH) : line
        re.lastIndex = 0
        for (const m of subject.matchAll(re)) if (m[0]) hits.push({ start: offset + (m.index ?? 0), end: offset + (m.index ?? 0) + m[0].length, kind: 'pattern', confidence: 'high', source: 'term' })
      }
    }
  }
  // Earliest first; on overlap keep the longer, merging adjacent spans of one hit.
  hits.sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: Hit[] = []
  for (const h of hits) {
    const last = merged[merged.length - 1]
    if (last && h.start < last.end) { last.end = Math.max(last.end, h.end); continue }
    merged.push({ ...h })
  }
  return merged
}

/* ── Styles ── */

export function labelFor(kind: string): string {
  return INFO_TYPE_BY_ID[kind] ? tokenFor(kind) : kind.toUpperCase()
}

function hashToken(kind: string, value: string, key: string | undefined): string {
  const norm = value.replace(/[\s.-]/g, '').toLowerCase()
  const h = createHmac('sha256', key || 'usertasks-redact').update(`${kind}:${norm}`).digest('hex').slice(0, 10)
  return `[${labelFor(kind)}:${h}]`
}

function partialMask(value: string, keep = 4): string {
  // Too short to keep anything safely: mask it all.
  if (value.replace(/[^A-Za-z0-9]/g, '').length <= keep) return value.replace(/[^\s]/g, '█')
  const chars = [...value]
  let kept = 0
  for (let i = chars.length - 1; i >= 0; i--) {
    if (!/[A-Za-z0-9]/.test(chars[i])) continue
    if (kept < keep) kept++
    else chars[i] = '█'
  }
  return chars.join('')
}

export function replacementFor(hit: Pick<Hit, 'kind'>, original: string, o: RedactOptions): string {
  const mode = o.styles?.[hit.kind] ?? o.replacement ?? 'block'
  if (mode === 'label') return `[${labelFor(hit.kind)}]`
  if (mode === 'text') return o.replacementText ?? '[REDACTED]'
  if (mode === 'partial') return partialMask(original)
  if (mode === 'hash') return hashToken(hit.kind, original, o.hashKey)
  return original.replace(/[^\s]/g, '█')
}

/* ── Text ── */

export function redactText(text: string, options: RedactOptions, where: FindingLocation = {}): RedactTextResult {
  const hits = findHits(text, options)
  const counts: Record<string, number> = {}
  for (const h of hits) counts[h.kind] = (counts[h.kind] ?? 0) + 1
  if (hits.length) options.onHits?.(hits, text, where)
  if (options.detectOnly) return { text, counts, total: hits.length }
  let out = ''
  let pos = 0
  for (const h of hits) {
    out += text.slice(pos, h.start) + replacementFor(h, text.slice(h.start, h.end), options)
    pos = h.end
  }
  out += text.slice(pos)
  return { text: out, counts, total: hits.length }
}

/* ── Findings ── */

export interface Finding extends FindingLocation {
  type: string
  label: string
  category: string
  confidence: Confidence
  source: Hit['source']
  /** Masked (•) unless values are included. */
  text: string
  start: number
  end: number
  /** The text around it with every finding replaced by its [LABEL] and other long numbers masked. */
  context_snippet: string
}

const PRESET_LABELS: Record<string, string> = { email: 'Email address', phone: 'Phone number', credit_card: 'Card number', iban: 'IBAN', ssn: 'US SSN', ip_address: 'IP address', url: 'URL', date: 'Date', term: 'Word or phrase', pattern: 'Custom pattern' }

export function maskValue(value: string): string {
  return value.replace(/[\p{L}\p{N}]/gu, '•')
}

function lineStarts(text: string): number[] {
  const out = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1)
  return out
}

function lineOf(starts: number[], pos: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1 }
  return lo + 1
}

const SNIPPET = 32

/** Findings for one unit's hits. `withLines`: add the line number (text files). */
export function buildFindings(hits: Hit[], text: string, where: FindingLocation, opts: { includeValues?: boolean; withLines?: boolean } = {}): Finding[] {
  const starts = opts.withLines ? lineStarts(text) : null
  return hits.map((h, k) => {
    const meta = INFO_TYPE_BY_ID[h.kind]
    // Snippet: the text around it, every finding in it replaced by its label.
    const from = Math.max(0, h.start - SNIPPET)
    let to = Math.min(text.length, h.end + SNIPPET)
    let j = k
    while (j > 0 && hits[j - 1].end > from) j--
    let pos = from
    let snippet = ''
    for (; j < hits.length && hits[j].start < to; j++) {
      const o = hits[j]
      if (o.start > pos) snippet += text.slice(pos, o.start)
      snippet += `[${labelFor(o.kind)}]`
      pos = Math.max(pos, o.end)
      if (pos > to) to = pos
    }
    if (pos < to) snippet += text.slice(pos, to)
    const context = `${from > 0 ? '…' : ''}${snippet.replace(/\s+/g, ' ').replace(/\d{4,}/g, (d) => '#'.repeat(d.length)).trim()}${to < text.length ? '…' : ''}`
    const value = text.slice(h.start, h.end)
    return {
      type: h.kind,
      label: meta?.label ?? PRESET_LABELS[h.kind] ?? h.kind,
      category: meta?.category ?? (h.kind === 'term' || h.kind === 'pattern' ? 'custom' : INFO_TYPE_BY_ID[h.kind === 'ssn' ? 'us_ssn' : h.kind]?.category ?? 'custom'),
      confidence: h.confidence,
      source: h.source,
      text: opts.includeValues ? value : maskValue(value),
      ...where,
      ...(starts ? { line: lineOf(starts, h.start) } : {}),
      start: h.start,
      end: h.end,
      context_snippet: context,
    }
  })
}

export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries([...INFO_CATEGORIES.map((c) => [c.id, c.label]), ['custom', 'Custom']])

export function meetsConfidence(c: Confidence, min: Confidence): boolean {
  return CONFIDENCE_RANK[c] >= CONFIDENCE_RANK[min]
}

/* ── Office packages ── */

/** Redact the text of one paragraph spread over several text nodes, in place. */
function redactRuns(nodes: XmlElement[], options: RedactOptions, counts: Record<string, number>, where: FindingLocation): number {
  const texts = nodes.map((n) => n.children.filter((c): c is string => typeof c === 'string').join(''))
  const joined = texts.join('')
  if (!joined.trim()) return 0
  const hits = findHits(joined, options)
  if (!hits.length) return 0
  options.onHits?.(hits, joined, where)
  for (const h of hits) counts[h.kind] = (counts[h.kind] ?? 0) + 1
  if (options.detectOnly) return hits.length
  const starts: number[] = []
  let acc = 0
  for (const t of texts) { starts.push(acc); acc += t.length }
  const next = texts.slice()
  // Apply from the end so offsets stay valid.
  for (const h of [...hits].reverse()) {
    const replacement = replacementFor(h, joined.slice(h.start, h.end), options)
    let placed = false
    for (let k = texts.length - 1; k >= 0; k--) {
      const s = starts[k]
      const e = s + texts[k].length
      if (e <= h.start || s >= h.end) continue
      const from = Math.max(h.start, s) - s
      const to = Math.min(h.end, e) - s
      const isFirst = h.start >= s
      next[k] = next[k].slice(0, from) + (isFirst && !placed ? replacement : '') + next[k].slice(to)
      if (isFirst) placed = true
    }
  }
  nodes.forEach((n, k) => {
    n.children = next[k] ? [next[k]] : []
    if (next[k] !== next[k].trim()) n.attrs['xml:space'] = 'preserve'
  })
  return hits.length
}

/** Text nodes directly in a paragraph (not in nested paragraphs, e.g. text boxes). */
function textNodes(p: XmlElement, paragraph: string, text: string): XmlElement[] {
  const nodes: XmlElement[] = []
  const stack = [...elements(p)].reverse()
  while (stack.length) {
    const el = stack.pop()!
    if (el.local === paragraph) continue
    if (el.local === text || el.local === 'delText') nodes.push(el)
    else stack.push(...[...elements(el)].reverse())
  }
  return nodes
}

function redactXmlPart(xml: string, paragraph: string, text: string, options: RedactOptions, counts: Record<string, number>, where: (p: XmlElement, index: number) => FindingLocation): { xml: string; hits: number } {
  const root = parseXml(xml)
  let hits = 0
  descendants(root, paragraph).forEach((p, index) => {
    hits += redactRuns(textNodes(p, paragraph, text), options, counts, where(p, index))
  })
  return { xml: hits && !options.detectOnly ? serializeXml(root) : xml, hits }
}

/** Excel: worksheet part → sheet name, and shared-string index → first cell using it. */
function workbookMap(zip: ZipReader): { sheetByPart: Map<string, string>; cellByString: Map<number, { sheet: string; cell: string }> } {
  const sheetByPart = new Map<string, string>()
  const cellByString = new Map<number, { sheet: string; cell: string }>()
  try {
    const wb = zip.readText('xl/workbook.xml')
    const rels = zip.readText('xl/_rels/workbook.xml.rels')
    if (!wb || !rels) return { sheetByPart, cellByString }
    const targets = new Map(descendants(parseXml(rels), 'Relationship').map((r) => [attr(r, 'Id') ?? '', (attr(r, 'Target') ?? '').replace(/^\/?xl\//, '').replace(/^\//, '')]))
    for (const s of descendants(parseXml(wb), 'sheet')) {
      const target = targets.get(attr(s, 'r:id') ?? attr(s, 'id') ?? '')
      if (target) sheetByPart.set(`xl/${target}`, attr(s, 'name') ?? '')
    }
    for (const [part, sheet] of sheetByPart) {
      const xml = zip.readText(part)
      if (!xml) continue
      for (const c of descendants(parseXml(xml), 'c')) {
        if (attr(c, 't') !== 's') continue
        const vEl = child(c, 'v')
        const idx = vEl ? Number(vEl.children.join('')) : NaN
        if (Number.isInteger(idx) && !cellByString.has(idx)) cellByString.set(idx, { sheet, cell: attr(c, 'r') ?? '' })
      }
    }
  } catch { /* locations are best effort */ }
  return { sheetByPart, cellByString }
}

function partLocation(kind: 'docx' | 'pptx' | 'xlsx', name: string): FindingLocation {
  if (kind === 'docx') {
    const m = /^word\/([a-z]+)/.exec(name)
    return { part: m?.[1] === 'document' ? 'body' : m?.[1] ?? 'body' }
  }
  if (kind === 'pptx') {
    const slide = /slide(\d+)\.xml$/i.exec(name)
    if (name.includes('notesSlides')) return { part: 'notes', slide: slide ? Number(slide[1]) : undefined }
    if (name.includes('comments')) return { part: 'comments' }
    return { part: 'slide', slide: slide ? Number(slide[1]) : undefined }
  }
  return {}
}

/** Redact (or, with detectOnly, scan) a DOCX / PPTX / XLSX package in place. */
export async function redactOoxml(bytes: Uint8Array, kind: 'docx' | 'pptx' | 'xlsx', options: RedactOptions & { clearAuthor?: boolean }): Promise<{ bytes: Buffer | null; counts: Record<string, number>; total: number }> {
  const zip = openZip(bytes)
  const counts: Record<string, number> = {}
  let total = 0
  const changed = new Map<string, string>()
  const parts = zip.names().filter((n) => n.endsWith('.xml') && (
    kind === 'docx' ? /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(n)
      : kind === 'pptx' ? /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+|comments\/comment\d+)\.xml$/.test(n)
        : /^xl\/(sharedStrings|worksheets\/sheet\d+|comments\d*)\.xml$/.test(n)))
  const book = kind === 'xlsx' && options.onHits ? workbookMap(zip) : null
  for (const name of parts) {
    const xml = zip.readText(name)
    if (!xml) continue
    const base = partLocation(kind, name)
    let r: { xml: string; hits: number }
    if (kind === 'xlsx' && name.includes('worksheets')) {
      // Inline strings: each cell's <is>, located by its reference.
      const sheet = book?.sheetByPart.get(name)
      const root = parseXml(xml)
      let hits = 0
      for (const c of descendants(root, 'c')) {
        const is = elements(c).find((e) => e.local === 'is')
        if (!is) continue
        hits += redactRuns(descendants(is, 't'), options, counts, { sheet, cell: attr(c, 'r') })
      }
      r = { xml: hits && !options.detectOnly ? serializeXml(root) : xml, hits }
    } else if (kind === 'xlsx' && name.includes('sharedStrings')) {
      r = redactXmlPart(xml, 'si', 't', options, counts, (_p, i) => ({ ...(book?.cellByString.get(i) ?? {}) }))
    } else {
      const [para, txt] = kind === 'xlsx' ? ['text', 't'] : ['p', 't']
      r = redactXmlPart(xml, para, txt, options, counts, (_p, i) => ({ ...base, paragraph: i + 1 }))
    }
    if (r.hits) { if (!options.detectOnly) changed.set(name, r.xml); total += r.hits }
  }
  if (options.detectOnly) return { bytes: null, counts, total }
  if (options.clearAuthor !== false) {
    const core = zip.readText('docProps/core.xml')
    if (core) {
      const root = parseXml(core)
      for (const el of elements(root)) if (el.local === 'creator' || el.local === 'lastModifiedBy') el.children = []
      changed.set('docProps/core.xml', serializeXml(root))
    }
  }
  const PizZip = (await import('pizzip')).default
  const out = new PizZip()
  for (const name of zip.names()) {
    if (name.endsWith('/')) continue
    const replaced = changed.get(name)
    out.file(name, replaced ?? zip.read(name)!, replaced ? {} : { binary: true })
  }
  return { bytes: out.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer, counts, total }
}
