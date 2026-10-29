/**
 * Redaction: PII presets (emails, phone numbers, card numbers with a Luhn
 * check, IBANs with the mod-97 check, US SSNs, IP addresses, URLs, dates),
 * literal terms and custom patterns. Word, PowerPoint and Excel copies are
 * redacted in place (the text runs inside the package, so formatting is
 * kept); text formats keep their format; PDFs are rebuilt from the redacted
 * text (the original text layer is gone, the layout is not kept).
 */

import { compileUserRegex, MAX_REGEX_INPUT_LENGTH } from '@/lib/safe-regex'
import { openZip } from './zip'
import { descendants, elements, parseXml, serializeXml, type XmlElement } from './xml'

export type RedactPreset = 'email' | 'phone' | 'credit_card' | 'iban' | 'ssn' | 'ip_address' | 'url' | 'date'
export const REDACT_PRESETS: RedactPreset[] = ['email', 'phone', 'credit_card', 'iban', 'ssn', 'ip_address', 'url', 'date']

export interface RedactOptions {
  presets?: RedactPreset[]
  /** Literal words / phrases (case-insensitive). */
  terms?: string[]
  /** Custom regular expressions (ReDoS-guarded, matched line by line). */
  patterns?: string[]
  /** block: █ per character (keeps the length); label: [EMAIL]; text: `replacementText`. */
  replacement?: 'block' | 'label' | 'text'
  replacementText?: string
}

export interface RedactTextResult { text: string; counts: Record<string, number>; total: number }

interface Hit { start: number; end: number; kind: string }

function luhn(digits: string): boolean {
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

function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false
  const moved = s.slice(4) + s.slice(0, 4)
  let rem = 0
  for (const ch of moved) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of v) rem = (rem * 10 + Number(d)) % 97
  }
  return rem === 1
}

const DETECTORS: Record<RedactPreset, { re: RegExp; check?: (m: string) => boolean }> = {
  email: { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g },
  phone: {
    re: /(?<![\w+])(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{1,4}(?:[\s.-]?\d{2,4}){1,3}(?![\w])/g,
    check: (m) => { const d = m.replace(/\D/g, ''); return d.length >= 7 && d.length <= 15 && !/^\d{4}-\d{1,2}-\d{1,2}$/.test(m.trim()) && !/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(m.trim()) && (/[\s().+-]/.test(m) || d.length >= 9) },
  },
  credit_card: { re: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, check: (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d) } },
  iban: { re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g, check: ibanValid },
  ssn: { re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  ip_address: { re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  url: { re: /\bhttps?:\/\/[^\s<>"'()[\]{}]+[^\s<>"'()[\]{}.,;:!?]/gi },
  date: { re: /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})\b/gi },
}

function findHits(text: string, o: RedactOptions): Hit[] {
  const hits: Hit[] = []
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
      hits.push({ start: (m.index ?? 0) + lead, end: (m.index ?? 0) + lead + core.length, kind: preset })
    }
  }
  for (const term of o.terms ?? []) {
    const t = String(term ?? '').trim()
    if (!t) continue
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    for (const m of text.matchAll(re)) hits.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind: 'term' })
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
        for (const m of subject.matchAll(re)) if (m[0]) hits.push({ start: offset + (m.index ?? 0), end: offset + (m.index ?? 0) + m[0].length, kind: 'pattern' })
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

function replacementFor(hit: Hit, original: string, o: RedactOptions): string {
  const mode = o.replacement ?? 'block'
  if (mode === 'label') return `[${hit.kind.toUpperCase()}]`
  if (mode === 'text') return o.replacementText ?? '[REDACTED]'
  return original.replace(/[^\s]/g, '█')
}

export function redactText(text: string, options: RedactOptions): RedactTextResult {
  const hits = findHits(text, options)
  const counts: Record<string, number> = {}
  let out = ''
  let pos = 0
  for (const h of hits) {
    out += text.slice(pos, h.start) + replacementFor(h, text.slice(h.start, h.end), options)
    pos = h.end
    counts[h.kind] = (counts[h.kind] ?? 0) + 1
  }
  out += text.slice(pos)
  return { text: out, counts, total: hits.length }
}

/** Redact the text of one paragraph spread over several text nodes, in place. */
function redactRuns(nodes: XmlElement[], options: RedactOptions, counts: Record<string, number>): number {
  const texts = nodes.map((n) => n.children.filter((c): c is string => typeof c === 'string').join(''))
  const joined = texts.join('')
  if (!joined.trim()) return 0
  const hits = findHits(joined, options)
  if (!hits.length) return 0
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
    counts[h.kind] = (counts[h.kind] ?? 0) + 1
  }
  nodes.forEach((n, k) => {
    n.children = next[k] ? [next[k]] : []
    if (next[k] !== next[k].trim()) n.attrs['xml:space'] = 'preserve'
  })
  return hits.length
}

function redactXmlPart(xml: string, paragraph: string, text: string, options: RedactOptions, counts: Record<string, number>): { xml: string; hits: number } {
  const root = parseXml(xml)
  let hits = 0
  for (const p of descendants(root, paragraph)) {
    // Text nodes directly in this paragraph (not in nested paragraphs, e.g. text boxes).
    const nodes: XmlElement[] = []
    const stack = [...elements(p)].reverse()
    while (stack.length) {
      const el = stack.pop()!
      if (el.local === paragraph) continue
      if (el.local === text || el.local === 'delText') nodes.push(el)
      else stack.push(...[...elements(el)].reverse())
    }
    hits += redactRuns(nodes, options, counts)
  }
  return { xml: hits ? serializeXml(root) : xml, hits }
}

/** Redact a DOCX / PPTX / XLSX package in place; returns the new package. */
export async function redactOoxml(bytes: Uint8Array, kind: 'docx' | 'pptx' | 'xlsx', options: RedactOptions & { clearAuthor?: boolean }): Promise<{ bytes: Buffer; counts: Record<string, number>; total: number }> {
  const zip = openZip(bytes)
  const counts: Record<string, number> = {}
  let total = 0
  const changed = new Map<string, string>()
  const parts = zip.names().filter((n) => n.endsWith('.xml') && (
    kind === 'docx' ? /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(n)
      : kind === 'pptx' ? /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+|comments\/comment\d+)\.xml$/.test(n)
        : /^xl\/(sharedStrings|worksheets\/sheet\d+|comments\d*)\.xml$/.test(n)))
  for (const name of parts) {
    const xml = zip.readText(name)
    if (!xml) continue
    const [para, txt] = kind === 'docx' ? ['p', 't'] : kind === 'pptx' ? ['p', 't'] : name.includes('worksheets') ? ['is', 't'] : name.includes('comments') ? ['text', 't'] : ['si', 't']
    const r = redactXmlPart(xml, para, txt, options, counts)
    if (r.hits) { changed.set(name, r.xml); total += r.hits }
  }
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
