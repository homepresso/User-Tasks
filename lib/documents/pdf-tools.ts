/**
 * PDF manipulation on @cantoo/pdf-lib (pure JS): merge, split, extract and
 * rotate pages, watermark / stamp text, fill and read AcroForm fields, and a
 * simple renderer from the document model (headings, paragraphs, lists,
 * tables, code, redline colours) for Markdown / HTML / DOCX → PDF and diff
 * reports.
 *
 * The standard PDF fonts only cover Windows-1252 (Latin) text; other
 * characters are replaced with "?" and reported as a warning. For other
 * scripts, or high-fidelity Office → PDF, configure the external converter
 * (DOCUMENT_CONVERTER_URL, lib/documents/external-converter).
 */

import type { Block, Inline } from './model'
import { DOCUMENT_LIMITS } from './limits'

type PdfLib = typeof import('@cantoo/pdf-lib')
type PDFDocument = import('@cantoo/pdf-lib').PDFDocument
type PDFFont = import('@cantoo/pdf-lib').PDFFont

async function lib(): Promise<PdfLib> {
  return import('@cantoo/pdf-lib')
}

export async function loadPdf(bytes: Uint8Array, name = 'PDF'): Promise<PDFDocument> {
  const { PDFDocument } = await lib()
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false })
  } catch (e) {
    const msg = (e as Error).message
    if (/encrypt/i.test(msg)) throw new Error(`"${name}" is encrypted (password-protected) and cannot be changed`)
    throw new Error(`"${name}" is not a readable PDF: ${msg}`)
  }
}

/** "1-3, 5, 8-" → 0-based page indexes within `count` (in the order given, duplicates kept). */
export function parsePageRanges(spec: string | null | undefined, count: number): number[] {
  const text = String(spec ?? '').trim()
  if (!text || text.toLowerCase() === 'all') return Array.from({ length: count }, (_, k) => k)
  const out: number[] = []
  for (const part of text.split(/[,;]/)) {
    const p = part.trim().toLowerCase()
    if (!p) continue
    const m = /^(\d+|last)?\s*(?:-\s*(\d+|last)?)?$/.exec(p)
    if (!m || (!m[1] && !m[2] && !p.includes('-'))) throw new Error(`Invalid page range "${part.trim()}" — use e.g. 1-3, 5, 8-`)
    const num = (v: string | undefined, dflt: number) => (v === undefined ? dflt : v === 'last' ? count : Number(v))
    const start = num(m[1], 1)
    const end = p.includes('-') ? num(m[2], count) : start
    if (start < 1 || end < 1) throw new Error(`Pages start at 1 ("${part.trim()}")`)
    const step = start <= end ? 1 : -1
    for (let n = start; step > 0 ? n <= end : n >= end; n += step) if (n <= count) out.push(n - 1)
  }
  if (!out.length) throw new Error(`No pages in "${text}" (the document has ${count})`)
  return out
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await loadPdf(bytes)).getPageCount()
}

export async function mergePdfs(files: Array<{ name: string; bytes: Uint8Array; pages?: string }>): Promise<{ bytes: Uint8Array; pages: number }> {
  if (files.length > DOCUMENT_LIMITS.maxMergeFiles) throw new Error(`At most ${DOCUMENT_LIMITS.maxMergeFiles} files can be merged at once`)
  const { PDFDocument } = await lib()
  const out = await PDFDocument.create()
  for (const f of files) {
    const src = await loadPdf(f.bytes, f.name)
    const idx = parsePageRanges(f.pages, src.getPageCount())
    const copied = await out.copyPages(src, idx)
    for (const p of copied) out.addPage(p)
  }
  return { bytes: await out.save(), pages: out.getPageCount() }
}

export async function extractPages(bytes: Uint8Array, spec: string, name = 'PDF'): Promise<{ bytes: Uint8Array; pages: number }> {
  const { PDFDocument } = await lib()
  const src = await loadPdf(bytes, name)
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, parsePageRanges(spec, src.getPageCount()))
  for (const p of copied) out.addPage(p)
  return { bytes: await out.save(), pages: out.getPageCount() }
}

/** Split by explicit ranges ("1-3; 4-6") or every N pages. */
export async function splitPdf(bytes: Uint8Array, options: { ranges?: string; everyN?: number }, name = 'PDF'): Promise<Array<{ bytes: Uint8Array; pages: number; range: string }>> {
  const src = await loadPdf(bytes, name)
  const count = src.getPageCount()
  const groups: string[] = []
  if (options.ranges && options.ranges.trim()) groups.push(...options.ranges.split(';').map((s) => s.trim()).filter(Boolean))
  else {
    const n = Math.max(1, Math.floor(options.everyN ?? 1))
    for (let start = 1; start <= count; start += n) groups.push(`${start}-${Math.min(count, start + n - 1)}`)
  }
  if (groups.length > 500) throw new Error('A split can produce at most 500 files')
  const { PDFDocument } = await lib()
  const out: Array<{ bytes: Uint8Array; pages: number; range: string }> = []
  for (const g of groups) {
    const doc = await PDFDocument.create()
    const copied = await doc.copyPages(src, parsePageRanges(g, count))
    for (const p of copied) doc.addPage(p)
    out.push({ bytes: await doc.save(), pages: doc.getPageCount(), range: g })
  }
  return out
}

export async function rotatePages(bytes: Uint8Array, degrees: number, spec?: string): Promise<Uint8Array> {
  const { degrees: deg } = await lib()
  const doc = await loadPdf(bytes)
  const turn = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360
  for (const idx of parsePageRanges(spec, doc.getPageCount())) {
    const page = doc.getPage(idx)
    page.setRotation(deg((page.getRotation().angle + turn) % 360))
  }
  return doc.save()
}

/** Replace characters the standard fonts cannot encode. */
const CHARSETS = new WeakMap<PDFFont, Set<number>>()

function encodable(font: PDFFont, text: string, warnings?: Set<string>): string {
  let charset = CHARSETS.get(font)
  if (!charset) { charset = new Set(font.getCharacterSet()); CHARSETS.set(font, charset) }
  let out = ''
  for (const ch of text.replace(/\t/g, '    ')) {
    if (charset.has(ch.codePointAt(0)!) || ch === '\n') out += ch
    else {
      const fallback = ({ '‑': '-', '−': '-', '•': '-', '◦': '-', '▪': '-', '→': '->', '←': '<-', '✓': 'v', '✗': 'x', '≥': '>=', '≤': '<=', '≠': '!=', ' ': ' ' } as Record<string, string>)[ch]
      if (fallback !== undefined) out += fallback
      else {
        out += '?'
        warnings?.add('Some characters are outside the standard PDF fonts (Latin only) and were replaced with "?"')
      }
    }
  }
  return out
}

export interface WatermarkOptions {
  text: string
  /** center (diagonal), top, bottom, top-left, top-right, bottom-left, bottom-right. */
  position?: string
  size?: number
  opacity?: number
  rotation?: number
  color?: string
  pages?: string
}

function hexColor(rgb: PdfLib['rgb'], hex: string | undefined, fallback: [number, number, number]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim())
  if (!m) return rgb(...fallback)
  const n = parseInt(m[1], 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

export async function watermarkPdf(bytes: Uint8Array, options: WatermarkOptions): Promise<{ bytes: Uint8Array; pages: number; warnings: string[] }> {
  const { StandardFonts, rgb, degrees } = await lib()
  const doc = await loadPdf(bytes)
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  const warnings = new Set<string>()
  const lines = encodable(font, String(options.text ?? '').slice(0, 500), warnings).split(/\r?\n/)
  const position = options.position ?? 'center'
  const color = hexColor(rgb, options.color, [0.6, 0.6, 0.6])
  const opacity = Math.min(1, Math.max(0.02, Number(options.opacity ?? (position === 'center' ? 0.25 : 0.8))))
  let stamped = 0
  for (const idx of parsePageRanges(options.pages, doc.getPageCount())) {
    const page = doc.getPage(idx)
    const { width, height } = page.getSize()
    const diag = position === 'center'
    const size = Number(options.size) || (diag ? Math.min(72, Math.max(18, (Math.hypot(width, height) * 0.6) / Math.max(1, Math.max(...lines.map((l) => l.length))) * 1.6)) : 12)
    const rotation = options.rotation !== undefined && options.rotation !== null && String(options.rotation) !== '' ? Number(options.rotation) : diag ? (Math.atan2(height, width) * 180) / Math.PI : 0
    const lineHeight = size * 1.2
    lines.forEach((line, k) => {
      const w = font.widthOfTextAtSize(line, size)
      let x: number
      let y: number
      if (diag) {
        const rad = (rotation * Math.PI) / 180
        const offset = (k - (lines.length - 1) / 2) * lineHeight
        x = width / 2 - (w / 2) * Math.cos(rad) + offset * Math.sin(rad)
        y = height / 2 - (w / 2) * Math.sin(rad) - offset * Math.cos(rad)
      } else {
        const margin = 24
        x = position.endsWith('left') ? margin : position.endsWith('right') ? width - margin - w : (width - w) / 2
        const top = position.startsWith('top')
        y = top ? height - margin - size - k * lineHeight : margin + (lines.length - 1 - k) * lineHeight
      }
      page.drawText(line, { x, y, size, font, color, opacity, rotate: degrees(rotation) })
    })
    stamped++
  }
  return { bytes: await doc.save(), pages: stamped, warnings: [...warnings] }
}

export interface FormFieldOut { name: string; type: string; value: unknown; options?: string[]; read_only: boolean; required: boolean }

export async function readFormFields(bytes: Uint8Array): Promise<FormFieldOut[]> {
  const doc = await loadPdf(bytes)
  const m = await lib()
  const form = doc.getForm()
  return form.getFields().map((f) => {
    const base = { name: f.getName(), read_only: f.isReadOnly(), required: f.isRequired() }
    if (f instanceof m.PDFTextField) return { ...base, type: 'text', value: f.getText() ?? '' }
    if (f instanceof m.PDFCheckBox) return { ...base, type: 'checkbox', value: f.isChecked() }
    if (f instanceof m.PDFRadioGroup) return { ...base, type: 'radio', value: f.getSelected() ?? null, options: f.getOptions() }
    if (f instanceof m.PDFDropdown) return { ...base, type: 'dropdown', value: f.getSelected()[0] ?? null, options: f.getOptions() }
    if (f instanceof m.PDFOptionList) return { ...base, type: 'list', value: f.getSelected(), options: f.getOptions() }
    if (f instanceof m.PDFSignature) return { ...base, type: 'signature', value: null }
    if (f instanceof m.PDFButton) return { ...base, type: 'button', value: null }
    return { ...base, type: 'unknown', value: null }
  })
}

const truthy = (v: unknown) => v === true || (typeof v === 'string' && /^(true|yes|on|1|x|checked)$/i.test(v.trim())) || v === 1

export async function fillForm(bytes: Uint8Array, values: Record<string, unknown>, options: { flatten?: boolean; strict?: boolean } = {}): Promise<{ bytes: Uint8Array; filled: string[]; missing: string[]; warnings: string[] }> {
  const doc = await loadPdf(bytes)
  const m = await lib()
  const form = doc.getForm()
  const filled: string[] = []
  const missing: string[] = []
  const warnings: string[] = []
  const byName = new Map(form.getFields().map((f) => [f.getName(), f]))
  for (const [name, raw] of Object.entries(values)) {
    const field = byName.get(name)
    if (!field) { missing.push(name); continue }
    try {
      if (field instanceof m.PDFTextField) field.setText(raw === null || raw === undefined ? '' : String(raw))
      else if (field instanceof m.PDFCheckBox) { if (truthy(raw)) field.check(); else field.uncheck() }
      else if (field instanceof m.PDFRadioGroup) field.select(String(raw))
      else if (field instanceof m.PDFDropdown) field.select(String(raw))
      else if (field instanceof m.PDFOptionList) field.select(Array.isArray(raw) ? raw.map(String) : String(raw))
      else { warnings.push(`Field "${name}" cannot be filled`); continue }
      filled.push(name)
    } catch (e) {
      warnings.push(`Field "${name}": ${(e as Error).message}`)
    }
  }
  if (options.strict && missing.length) throw new Error(`The PDF has no field named ${missing.map((n) => `"${n}"`).join(', ')}`)
  if (options.flatten) {
    try { form.flatten() } catch (e) { warnings.push(`Could not flatten the form: ${(e as Error).message}`) }
  }
  return { bytes: await doc.save(), filled, missing, warnings }
}

/* ── Document model → PDF ───────────────────────────────────────────── */

export interface RenderPdfOptions {
  title?: string
  author?: string
  pageSize?: 'A4' | 'Letter'
  /** Redline colours for inserted / deleted runs. */
  redline?: boolean
}

interface Word { text: string; font: PDFFont; size: number; inline: Inline; space: boolean }

export async function renderPdf(blocks: Block[], options: RenderPdfOptions = {}): Promise<{ bytes: Uint8Array; pages: number; warnings: string[] }> {
  const { PDFDocument, StandardFonts, rgb } = await lib()
  const doc = await PDFDocument.create()
  if (options.title) doc.setTitle(options.title)
  doc.setAuthor(options.author ?? 'UserTasks')
  doc.setProducer('UserTasks document actions')
  doc.setCreator('UserTasks')
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
  }
  const warnings = new Set<string>()
  const [pw, ph] = options.pageSize === 'Letter' ? [612, 792] : [595.28, 841.89]
  const margin = 56
  const maxW = pw - margin * 2
  let page = doc.addPage([pw, ph])
  let y = ph - margin
  const black = rgb(0.1, 0.1, 0.12)
  const grey = rgb(0.45, 0.45, 0.5)
  const green = rgb(0.04, 0.48, 0.23)
  const red = rgb(0.71, 0.14, 0.09)
  const blue = rgb(0.02, 0.35, 0.75)

  const newPage = () => { page = doc.addPage([pw, ph]); y = ph - margin }
  const ensure = (h: number) => { if (y - h < margin) newPage() }

  const fontFor = (i: Inline): PDFFont => (i.code ? fonts.mono : i.bold && i.italic ? fonts.boldItalic : i.bold ? fonts.bold : i.italic ? fonts.italic : fonts.regular)

  function words(inlines: Inline[], size: number, forceBold = false): Word[][] {
    // Returns lines of words split at explicit newlines.
    const lines: Word[][] = [[]]
    for (const raw of inlines) {
      const inline = forceBold ? { ...raw, bold: true } : raw
      const font = fontFor(inline)
      const parts = encodable(font, inline.text, warnings).split(/(\n)/)
      for (const part of parts) {
        if (part === '\n') { lines.push([]); continue }
        const tokens = part.split(/( +)/)
        for (const tok of tokens) {
          if (!tok) continue
          if (/^ +$/.test(tok)) { const line = lines[lines.length - 1]; if (line.length) line[line.length - 1].space = true; continue }
          lines[lines.length - 1].push({ text: tok, font, size: inline.code ? size * 0.92 : size, inline, space: false })
        }
      }
    }
    return lines
  }

  function drawInlines(inlines: Inline[], size: number, opts: { indent?: number; bold?: boolean; color?: ReturnType<typeof rgb>; prefix?: string } = {}) {
    const indent = opts.indent ?? 0
    const width = maxW - indent
    const lineHeight = size * 1.38
    const paragraphs = words(inlines, size, opts.bold)
    let first = true
    for (const para of paragraphs) {
      let line: Word[] = []
      let lineW = 0
      const flushLine = () => {
        ensure(lineHeight)
        y -= lineHeight
        if (first && opts.prefix) page.drawText(encodable(fonts.regular, opts.prefix, warnings), { x: margin + indent - 14, y, size, font: fonts.regular, color: black })
        first = false
        let x = margin + indent
        for (const w of line) {
          const ww = w.font.widthOfTextAtSize(w.text, w.size)
          const color = options.redline && w.inline.ins ? green : options.redline && w.inline.del ? red : w.inline.href ? blue : opts.color ?? black
          page.drawText(w.text, { x, y, size: w.size, font: w.font, color })
          const spaceW = w.space ? w.font.widthOfTextAtSize(' ', w.size) : 0
          if (w.inline.underline || w.inline.ins || w.inline.href) page.drawLine({ start: { x, y: y - 1.5 }, end: { x: x + ww + (w.inline.ins ? spaceW : 0), y: y - 1.5 }, thickness: 0.6, color })
          if (w.inline.strike || w.inline.del) page.drawLine({ start: { x, y: y + w.size * 0.3 }, end: { x: x + ww + (w.inline.del ? spaceW : 0), y: y + w.size * 0.3 }, thickness: 0.7, color })
          x += ww + spaceW
        }
        line = []
        lineW = 0
      }
      for (const w of para) {
        const ww = w.font.widthOfTextAtSize(w.text, w.size)
        const sp = w.space ? w.font.widthOfTextAtSize(' ', w.size) : 0
        if (lineW + ww > width && line.length) flushLine()
        if (ww > width) {
          // Break a very long word.
          let rest = w.text
          while (rest) {
            let n = rest.length
            while (n > 1 && w.font.widthOfTextAtSize(rest.slice(0, n), w.size) > width) n--
            line.push({ ...w, text: rest.slice(0, n), space: false })
            flushLine()
            rest = rest.slice(n)
          }
          continue
        }
        line.push(w)
        lineW += ww + sp
      }
      flushLine()
    }
  }

  function drawTable(rows: string[][], header: boolean) {
    const cols = Math.max(1, ...rows.map((r) => r.length))
    const size = cols > 6 ? 7.5 : 9
    const colW = maxW / cols
    const pad = 3
    const lineH = size * 1.3
    const wrap = (text: string, font: PDFFont) => {
      const out: string[] = []
      for (const para of encodable(font, text, warnings).split('\n')) {
        let line = ''
        for (const word of para.split(/\s+/)) {
          const cand = line ? `${line} ${word}` : word
          if (font.widthOfTextAtSize(cand, size) <= colW - pad * 2 || !line) {
            if (font.widthOfTextAtSize(cand, size) > colW - pad * 2 && !line) {
              // Hard-break a long token.
              let rest = word
              while (font.widthOfTextAtSize(rest, size) > colW - pad * 2 && rest.length > 1) {
                let n = rest.length
                while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > colW - pad * 2) n--
                out.push(rest.slice(0, n))
                rest = rest.slice(n)
              }
              line = rest
            } else line = cand
          } else { out.push(line); line = word }
        }
        out.push(line)
      }
      return out
    }
    rows.forEach((row, r) => {
      const font = header && r === 0 ? fonts.bold : fonts.regular
      const cells = Array.from({ length: cols }, (_, c) => wrap(String(row[c] ?? ''), font))
      const h = Math.max(...cells.map((c) => c.length)) * lineH + pad * 2
      ensure(h)
      cells.forEach((lines, c) => {
        const x = margin + c * colW
        page.drawRectangle({ x, y: y - h, width: colW, height: h, borderColor: rgb(0.7, 0.7, 0.72), borderWidth: 0.5, ...(header && r === 0 ? { color: rgb(0.94, 0.94, 0.95) } : {}) })
        lines.forEach((l, k) => page.drawText(l, { x: x + pad, y: y - pad - (k + 1) * lineH + size * 0.3, size, font, color: black }))
      })
      y -= h
    })
    y -= 8
  }

  if (options.title) {
    drawInlines([{ text: options.title, bold: true }], 18)
    y -= 6
  }
  let counters: number[] = []
  for (const b of blocks) {
    if (b.type !== 'list_item') counters = []
    switch (b.type) {
      case 'heading': {
        const size = [20, 16, 13.5, 12, 11, 11][Math.min(6, Math.max(1, b.level)) - 1]
        y -= size * 0.6
        ensure(size * 3)
        drawInlines(b.inlines, size, { bold: true })
        y -= 4
        break
      }
      case 'paragraph':
        drawInlines(b.inlines, 10.5)
        y -= 6
        break
      case 'quote':
        drawInlines(b.inlines, 10.5, { indent: 18, color: grey })
        y -= 6
        break
      case 'list_item':
        counters = counters.slice(0, b.level + 1)
        counters[b.level] = (counters[b.level] ?? 0) + 1
        drawInlines(b.inlines, 10.5, { indent: 18 + b.level * 16, prefix: b.ordered ? `${counters[b.level]}.` : '-' })
        y -= 2
        break
      case 'table':
        if (b.rows.length) drawTable(b.rows, b.header)
        break
      case 'code':
        drawInlines([{ text: b.text, code: true }], 9, { indent: 6 })
        y -= 6
        break
      case 'hr':
        ensure(12)
        y -= 6
        page.drawLine({ start: { x: margin, y }, end: { x: pw - margin, y }, thickness: 0.6, color: rgb(0.75, 0.75, 0.78) })
        y -= 6
        break
      case 'page_break':
        newPage()
        break
    }
  }
  return { bytes: await doc.save(), pages: doc.getPageCount(), warnings: [...warnings] }
}
