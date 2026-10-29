/**
 * PDF reading (pdf.js via unpdf — no native code): text per page in reading
 * order with line breaks, metadata, outline / bookmarks, links, AcroForm
 * values, best-effort tables from text-based pages, and pages without a text
 * layer flagged for OCR (lib/documents/ocr).
 *
 * pdf.js runs with eval disabled, no system fonts and no font faces, so a
 * crafted font cannot run code (CVE-2024-4367 class).
 */

import { DOCUMENT_LIMITS, DocumentLimitError } from './limits'
import type { Block } from './model'

/* pdf.js on Node 20 needs ArrayBuffer.prototype.transferToFixedLength (Node 21+) for images. */
function polyfillArrayBuffer(): void {
  const proto = ArrayBuffer.prototype as unknown as { transferToFixedLength?: (len?: number) => ArrayBuffer; transfer?: (len?: number) => ArrayBuffer }
  if (typeof proto.transferToFixedLength !== 'function') {
    Object.defineProperty(proto, 'transferToFixedLength', {
      configurable: true,
      writable: true,
      value(this: ArrayBuffer, len?: number) {
        const size = len ?? this.byteLength
        const out = new ArrayBuffer(size)
        new Uint8Array(out).set(new Uint8Array(this, 0, Math.min(size, this.byteLength)))
        return out
      },
    })
  }
}

export interface PdfTextItem { str: string; x: number; y: number; width: number; height: number; fontSize: number; hasEOL: boolean }

export interface PdfLine { y: number; text: string; items: PdfTextItem[]; fontSize: number }

export interface PdfPageOut {
  number: number
  text: string
  characters: number
  /** false when the page has (almost) no extractable text — a scan or an image. */
  has_text_layer: boolean
  image_count: number
  width: number
  height: number
  ocr?: { provider: string; confidence: number | null; characters: number } | null
}

export interface PdfOutlineItem { title: string; level: number; page: number | null }
export interface PdfFormField { name: string; type: string; value: unknown; read_only: boolean; options?: string[] }

export interface PdfReadResult {
  pages: PdfPageOut[]
  page_count: number
  pages_read: number
  metadata: {
    title: string | null; author: string | null; subject: string | null; keywords: string | null
    creator: string | null; producer: string | null; created: string | null; modified: string | null
    pdf_version: string | null; encrypted: boolean; has_form: boolean
  }
  outline: PdfOutlineItem[]
  links: Array<{ page: number; url: string }>
  form_fields: PdfFormField[]
  tables: Array<{ page: number; rows: string[][] }>
  blocks: Block[]
  warnings: string[]
}

export interface PdfReadOptions {
  from?: number
  to?: number
  /** Find tables on text pages (best effort). */
  tables?: boolean
  /** OCR: off (default), auto (pages without a text layer), force (every page). */
  ocr?: 'off' | 'auto' | 'force'
  ocrLanguages?: string
  ocrMaxPages?: number
  /** Called for each page that needs OCR; returns the recognised text (lib/documents/ocr). */
  recognize?: (png: Buffer, page: number) => Promise<{ text: string; confidence: number | null; provider: string }>
}

const PDFJS_OPTIONS = { isEvalSupported: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: false, verbosity: 0 }

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdf.js proxy types come from the bundled build
type PdfProxy = any

export async function openPdf(bytes: Uint8Array): Promise<PdfProxy> {
  polyfillArrayBuffer()
  const { getDocumentProxy } = await import('unpdf')
  try {
    return await getDocumentProxy(new Uint8Array(bytes), PDFJS_OPTIONS as never)
  } catch (e) {
    const name = (e as { name?: string }).name ?? ''
    if (name === 'PasswordException' || /password/i.test(String((e as Error).message))) throw new Error('The PDF is password-protected and cannot be read')
    throw new Error(`Not a readable PDF: ${(e as Error).message}`)
  }
}

function pdfDate(raw: unknown): string | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString()
  if (typeof raw !== 'string' || !raw) return null
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?'?/.exec(raw)
  if (!m) return null
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', tz, th = '00', tm = '00'] = m
  const offset = !tz || tz === 'Z' || tz === 'z' ? 'Z' : `${tz}${th}:${tm}`
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Text items → lines in reading order (top to bottom, left to right). */
export function itemsToLines(items: PdfTextItem[]): PdfLine[] {
  const real = items.filter((i) => i.str !== '')
  const sorted = [...real].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: PdfLine[] = []
  for (const item of sorted) {
    const size = item.fontSize || item.height || 10
    const line = lines.find((l) => Math.abs(l.y - item.y) <= Math.max(2, size * 0.45))
    if (line) line.items.push(item)
    else lines.push({ y: item.y, text: '', items: [item], fontSize: size })
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x)
    let text = ''
    let end = -Infinity
    for (const item of line.items) {
      const size = item.fontSize || 10
      if (text && item.x - end > size * 0.2 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' '
      text += item.str
      end = Math.max(end, item.x + item.width)
    }
    line.text = text.replace(/\s+$/, '')
    line.fontSize = Math.max(...line.items.map((i) => i.fontSize || 0)) || line.fontSize
  }
  lines.sort((a, b) => b.y - a.y)
  return lines
}

/** Lines → text with paragraph gaps kept as blank lines. */
export function linesToText(lines: PdfLine[]): string {
  const out: string[] = []
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]
    if (k > 0) {
      const gap = lines[k - 1].y - line.y
      if (gap > Math.max(line.fontSize, lines[k - 1].fontSize) * 1.9) out.push('')
    }
    out.push(line.text)
  }
  return out.join('\n')
}

/** Segments of a line split at wide gaps (candidate table cells). */
function segments(line: PdfLine): Array<{ x: number; text: string }> {
  const segs: Array<{ x: number; text: string; end: number }> = []
  for (const item of line.items) {
    if (!item.str.trim()) continue
    const size = item.fontSize || 10
    const last = segs[segs.length - 1]
    if (last && item.x - last.end < Math.max(size * 1.2, 6)) {
      last.text += (item.x - last.end > size * 0.2 ? ' ' : '') + item.str
      last.end = item.x + item.width
    } else segs.push({ x: item.x, text: item.str, end: item.x + item.width })
  }
  return segs.map((s) => ({ x: s.x, text: s.text.trim() }))
}

/** Best-effort tables: runs of consecutive lines whose wide-gap segments line up in 2+ columns. */
export function detectTables(lines: PdfLine[]): string[][][] {
  const tables: string[][][] = []
  let run: Array<Array<{ x: number; text: string }>> = []
  const finish = () => {
    if (run.length >= 2) {
      const size = 10
      const starts = run.flat().map((s) => s.x).sort((a, b) => a - b)
      const anchors: number[] = []
      for (const x of starts) if (!anchors.length || x - anchors[anchors.length - 1] > size * 1.5) anchors.push(x)
      const counts = anchors.map((a) => run.filter((segs) => segs.some((s) => Math.abs(s.x - a) <= size * 1.5)).length)
      const cols = anchors.filter((_, k) => counts[k] >= Math.ceil(run.length * 0.5))
      if (cols.length >= 2) {
        const rows = run.map((segs) => {
          const row = cols.map(() => '')
          for (const s of segs) {
            let best = 0
            for (let k = 0; k < cols.length; k++) if (cols[k] - size * 1.5 <= s.x) best = k
            row[best] = row[best] ? `${row[best]} ${s.text}` : s.text
          }
          return row
        })
        tables.push(rows)
      }
    }
    run = []
  }
  for (const line of lines) {
    const segs = segments(line)
    if (segs.length >= 2) run.push(segs)
    else finish()
  }
  finish()
  return tables
}

/** Raw pixels (1, 3 or 4 channels) → PNG bytes (no native code). */
export async function encodePng(data: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: number): Promise<Buffer> {
  const { deflateSync } = await import('node:zlib')
  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : 6
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length)
    const tb = Buffer.concat([Buffer.from(type, 'ascii'), body])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb) >>> 0)
    return Buffer.concat([len, tb, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

let CRC_TABLE: Int32Array | null = null
function crc32(buf: Buffer): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return crc ^ -1
}

async function outlineOf(pdf: PdfProxy): Promise<PdfOutlineItem[]> {
  const out: PdfOutlineItem[] = []
  let raw: unknown[] | null = null
  try { raw = await pdf.getOutline() } catch { return out }
  const visit = async (items: unknown[] | null, level: number) => {
    for (const it of items ?? []) {
      if (out.length > 2000) return
      const item = it as { title?: string; dest?: unknown; items?: unknown[] }
      let page: number | null = null
      try {
        const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest
        if (Array.isArray(dest) && dest[0]) page = (await pdf.getPageIndex(dest[0])) + 1
      } catch { /* unresolvable destination */ }
      out.push({ title: String(item.title ?? '').trim(), level, page })
      await visit(item.items ?? null, level + 1)
    }
  }
  await visit(raw, 1)
  return out
}

async function formFieldsOf(pdf: PdfProxy): Promise<PdfFormField[]> {
  let objs: Record<string, unknown[]> | null = null
  try { objs = await pdf.getFieldObjects() } catch { return [] }
  const out: PdfFormField[] = []
  for (const [name, list] of Object.entries(objs ?? {})) {
    const widgets = (list as Array<Record<string, unknown>>).filter((w) => w.type)
    if (!widgets.length) continue
    const first = widgets[0]
    const type = String(first.type)
    let value: unknown = first.value ?? null
    if (type === 'checkbox') value = widgets.some((w) => w.value && w.value !== 'Off' && w.value === w.exportValues)
    if (type === 'radiobutton') value = (widgets.find((w) => w.value && w.value !== 'Off' && w.value === w.buttonValue)?.buttonValue as string | undefined) ?? null
    const options = Array.isArray(first.items) ? (first.items as Array<{ displayValue?: string; exportValue?: string }>).map((o) => String(o.displayValue ?? o.exportValue ?? '')) : undefined
    out.push({ name, type, value, read_only: Boolean(first.readOnly), ...(options ? { options } : {}) })
  }
  return out
}

export async function readPdf(bytes: Uint8Array, options: PdfReadOptions = {}): Promise<PdfReadResult> {
  const pdf = await openPdf(bytes)
  const warnings: string[] = []
  try {
    const { getMeta } = await import('unpdf')
    const pageCount: number = pdf.numPages
    const from = Math.max(1, options.from ?? 1)
    const to = Math.min(pageCount, options.to ?? pageCount, from + DOCUMENT_LIMITS.maxPdfPages - 1)
    if ((options.to ?? pageCount) > to && to < pageCount) warnings.push(`Only pages ${from}–${to} were read (DOCUMENT_MAX_PDF_PAGES)`)
    const meta = await getMeta(pdf).catch(() => ({ info: {} as Record<string, unknown> }))
    const info = (meta.info ?? {}) as Record<string, unknown>
    const pages: PdfPageOut[] = []
    const links: Array<{ page: number; url: string }> = []
    const tables: Array<{ page: number; rows: string[][] }> = []
    const blocks: Block[] = []
    let ocrDone = 0
    const ocrMode = options.ocr ?? 'off'
    const ocrMax = Math.min(options.ocrMaxPages ?? DOCUMENT_LIMITS.ocrMaxPages, DOCUMENT_LIMITS.ocrMaxPages)
    for (let n = from; n <= to; n++) {
      const page = await pdf.getPage(n)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent({ includeMarkedContent: false })
      const items: PdfTextItem[] = (content.items as Array<Record<string, unknown>>).filter((i) => typeof i.str === 'string').map((i) => {
        const t = (i.transform as number[]) ?? [1, 0, 0, 1, 0, 0]
        return { str: String(i.str), x: t[4], y: t[5], width: Number(i.width) || 0, height: Number(i.height) || 0, fontSize: Math.hypot(t[2], t[3]) || Number(i.height) || 10, hasEOL: Boolean(i.hasEOL) }
      })
      const lines = itemsToLines(items)
      let text = linesToText(lines)
      const visible = text.replace(/\s/g, '').length
      let imageCount = 0
      try {
        const ops = await page.getOperatorList()
        const { OPS } = await import('unpdf/pdfjs').catch(() => ({ OPS: null as Record<string, number> | null }))
        const imageOps = OPS ? new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat]) : new Set([85, 86, 88])
        imageCount = (ops.fnArray as number[]).filter((f) => imageOps.has(f)).length
      } catch { /* operator list unavailable */ }
      const hasTextLayer = visible >= 10 || (visible > 0 && imageCount === 0)
      const out: PdfPageOut = { number: n, text, characters: visible, has_text_layer: hasTextLayer, image_count: imageCount, width: Math.round(viewport.width), height: Math.round(viewport.height) }
      const wantsOcr = options.recognize && (ocrMode === 'force' || (ocrMode === 'auto' && !hasTextLayer && imageCount > 0))
      if (wantsOcr) {
        if (ocrDone >= ocrMax) {
          if (ocrDone === ocrMax) warnings.push(`OCR stopped after ${ocrMax} pages (DOCUMENT_OCR_MAX_PAGES)`)
          ocrDone++
        } else {
          ocrDone++
          const png = await pageImagePng(pdf, n)
          if (png) {
            const result = await options.recognize!(png, n)
            const ocrText = result.text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
            out.ocr = { provider: result.provider, confidence: result.confidence, characters: ocrText.replace(/\s/g, '').length }
            if (ocrMode === 'force' && hasTextLayer) { /* keep the text layer; OCR text is extra */ out.text = text } else { text = ocrText; out.text = ocrText }
          } else warnings.push(`Page ${n}: no image found to OCR`)
        }
      }
      pages.push(out)
      try {
        const annots = await page.getAnnotations()
        for (const a of annots as Array<Record<string, unknown>>) if (a.subtype === 'Link' && typeof a.url === 'string') links.push({ page: n, url: a.url })
      } catch { /* no annotations */ }
      blocks.push({ type: 'heading', level: 2, inlines: [{ text: `Page ${n}` }] })
      const pageTables = options.tables !== false && hasTextLayer ? detectTables(lines) : []
      for (const rows of pageTables) tables.push({ page: n, rows })
      for (const para of text.split(/\n\s*\n/)) if (para.trim()) blocks.push({ type: 'paragraph', inlines: [{ text: para.trim() }] })
      for (const rows of pageTables) blocks.push({ type: 'table', rows, header: true })
      page.cleanup?.()
    }
    const formFields = await formFieldsOf(pdf)
    return {
      pages,
      page_count: pageCount,
      pages_read: pages.length,
      metadata: {
        title: (info.Title as string) || null,
        author: (info.Author as string) || null,
        subject: (info.Subject as string) || null,
        keywords: (info.Keywords as string) || null,
        creator: (info.Creator as string) || null,
        producer: (info.Producer as string) || null,
        created: pdfDate(info.CreationDate),
        modified: pdfDate(info.ModDate),
        pdf_version: (info.PDFFormatVersion as string) || null,
        encrypted: Boolean(info.EncryptFilterName),
        has_form: Boolean(info.IsAcroFormPresent) || formFields.length > 0,
      },
      outline: await outlineOf(pdf),
      links,
      form_fields: formFields,
      tables,
      blocks,
      warnings,
    }
  } finally {
    await pdf.destroy?.().catch?.(() => {})
  }
}

/** The largest image painted on a page, as PNG (scanned pages are one big image). */
export async function pageImagePng(pdf: PdfProxy, pageNumber: number): Promise<Buffer | null> {
  polyfillArrayBuffer()
  const { extractImages } = await import('unpdf')
  const images = await extractImages(pdf, pageNumber).catch(() => [])
  if (!images.length) return null
  const best = images.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b))
  if (best.width * best.height > 60_000_000) throw new DocumentLimitError(`Page ${pageNumber}: the scanned image is too large to OCR`)
  return encodePng(best.data, best.width, best.height, best.channels)
}
