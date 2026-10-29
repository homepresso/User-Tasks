/**
 * Read document: any supported file → text, Markdown, sanitised HTML,
 * metadata (title, author, dates, page / slide / sheet counts, word and
 * character counts) and a structure specific to the format.
 */

import { blocksToHtml, blocksToMarkdown, blocksToText, headingsOf, linksOf, tablesOf, tableToOut, textStats, textToBlocks, type Block, type TableOut, type TextStats } from './model'
import { detectType, decodeText, type DetectedType, type DocumentFormat } from './detect'
import { openZip } from './zip'
import { readDocxZip } from './docx'
import { readPptxZip } from './pptx'
import { readCsv, readOdfTextZip, readOdsZip, readXlsx, sheetBlocks, type SheetOut } from './sheets'
import { readHtml } from './html'
import { readMarkdown } from './markdown'
import { parseXml, xmlToJson } from './xml'
import { DOCUMENT_LIMITS } from './limits'
import { sanitizeHtml } from '@/lib/html-sanitize'
import type { OcrProvider } from './ocr'

export interface ReadOptions {
  /** Pages (PDF) or slides (PowerPoint): "3", "2-5", "4-". */
  pages?: string | null
  sheet?: string | number | null
  range?: string | null
  headerRow?: 'auto' | 'first' | 'none' | number
  maxRows?: number
  /** Characters kept in text / markdown / html (default 2,000,000). */
  maxChars?: number
  includeTables?: boolean
  includeImages?: boolean
  trackedChanges?: 'accept' | 'show'
  delimiter?: string
  ocr?: 'off' | 'auto' | 'force'
  ocrLanguages?: string
  ocrMaxPages?: number
  /** Opens the OCR provider lazily (only when a page needs it). */
  openOcr?: (languages: string) => Promise<OcrProvider>
}

export interface DocumentMetadata extends TextStats {
  title: string | null
  author: string | null
  subject: string | null
  keywords: string | null
  created: string | null
  modified: string | null
  last_modified_by: string | null
  pages: number | null
  slides: number | null
  sheets: number | null
  format: DocumentFormat
  format_label: string
}

export interface DocumentStructure {
  headings: Array<{ level: number; text: string }>
  links: Array<{ text: string; href: string }>
  tables: TableOut[]
  images?: Array<{ name: string; size: number }>
  pages?: unknown[]
  slides?: unknown[]
  sheets?: SheetOut[]
  sheet_names?: string[]
  comments?: unknown[]
  tracked_changes?: { insertions: number; deletions: number; items: unknown[] }
  front_matter?: Record<string, unknown> | null
  data?: unknown
  outline?: unknown[]
  form_fields?: unknown[]
  defined_names?: string[]
}

export interface ReadResult {
  file: { name: string; size: number; mime_type: string }
  type: DetectedType
  text: string
  markdown: string
  html: string
  metadata: DocumentMetadata
  structure: DocumentStructure
  /** Rows of the first (or chosen) sheet / the first table — handy for a Loop. */
  rows: Record<string, unknown>[]
  truncated: boolean
  warnings: string[]
}

function pageRange(spec: string | null | undefined): { from?: number; to?: number } {
  const s = String(spec ?? '').trim()
  if (!s || s.toLowerCase() === 'all') return {}
  const m = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(s)
  if (!m || (!m[1] && !m[3])) throw new Error(`Invalid page range "${s}" — use e.g. 3, 2-5 or 4-`)
  const from = m[1] ? Number(m[1]) : 1
  const to = m[2] ? (m[3] ? Number(m[3]) : undefined) : from
  return { from, to }
}

function cap(text: string, max: number): { text: string; cut: boolean } {
  return text.length > max ? { text: text.slice(0, max), cut: true } : { text, cut: false }
}

const EMPTY_PROPS = { title: null, author: null, subject: null, keywords: null, created: null, modified: null, last_modified_by: null }

export async function readDocument(bytes: Uint8Array, name: string, mime: string | null, options: ReadOptions = {}): Promise<ReadResult> {
  return (await readDocumentFull(bytes, name, mime, options)).result
}

/** The read result plus the document model (for Compare / Convert / Redact). */
export async function readDocumentFull(bytes: Uint8Array, name: string, mime: string | null, options: ReadOptions = {}): Promise<{ result: ReadResult; blocks: Block[]; fullText: string }> {
  const type = detectType(bytes, name)
  const warnings: string[] = []
  if (type.extension_mismatch) warnings.push(`"${name}" is named like another type but its content is ${type.label}`)
  const maxChars = Math.max(1000, Math.min(options.maxChars ?? DOCUMENT_LIMITS.defaultMaxChars, DOCUMENT_LIMITS.defaultMaxChars))
  let blocks: Block[] = []
  let html: string | null = null
  let props: Partial<DocumentMetadata> = { ...EMPTY_PROPS }
  const structure: DocumentStructure = { headings: [], links: [], tables: [] }
  let rows: Record<string, unknown>[] = []
  let plainText: string | null = null
  const range = pageRange(options.pages)

  switch (type.format) {
    case 'docx': {
      const r = readDocxZip(openZip(bytes), { trackedChanges: options.trackedChanges })
      blocks = r.blocks
      props = { ...props, ...r.properties, pages: r.properties.pages }
      structure.comments = r.comments
      structure.tracked_changes = {
        insertions: r.trackedChanges.filter((c) => c.type === 'insertion').length,
        deletions: r.trackedChanges.filter((c) => c.type === 'deletion').length,
        items: r.trackedChanges.slice(0, 1000),
      }
      if (options.includeImages) structure.images = r.media
      break
    }
    case 'pptx': {
      const r = readPptxZip(openZip(bytes), range)
      blocks = r.blocks
      props = { ...props, ...r.properties, pages: null, slides: r.properties.pages }
      structure.slides = r.slides
      if (options.includeImages) structure.images = r.media
      break
    }
    case 'xlsx': {
      const r = await readXlsx(bytes, { sheet: options.sheet, range: options.range, headerRow: options.headerRow, maxRows: options.maxRows })
      blocks = sheetBlocks(r.sheets)
      props = { ...props, ...(r.properties ?? {}), pages: null, sheets: r.sheetNames.length }
      structure.sheets = r.sheets
      structure.sheet_names = r.sheetNames
      structure.defined_names = r.definedNames
      rows = r.sheets[0]?.rows ?? []
      if (r.sheets.some((s) => s.truncated)) warnings.push('The workbook is large; only part of it was read')
      break
    }
    case 'ods': {
      const r = readOdsZip(openZip(bytes), { sheet: options.sheet, range: options.range, headerRow: options.headerRow, maxRows: options.maxRows })
      blocks = sheetBlocks(r.sheets)
      props = { ...props, sheets: r.sheetNames.length }
      structure.sheets = r.sheets
      structure.sheet_names = r.sheetNames
      rows = r.sheets[0]?.rows ?? []
      break
    }
    case 'odt': case 'odp':
      blocks = readOdfTextZip(openZip(bytes))
      break
    case 'csv': case 'tsv': {
      const text = decodeText(bytes) ?? ''
      const sheet = readCsv(text, { delimiter: options.delimiter || (type.format === 'tsv' ? '\t' : undefined), range: options.range, headerRow: options.headerRow, maxRows: options.maxRows, name: name.replace(/\.[^.]+$/, '') || 'Sheet1' })
      blocks = sheetBlocks([sheet])
      structure.sheets = [sheet]
      structure.sheet_names = [sheet.name]
      props = { ...props, sheets: 1 }
      rows = sheet.rows
      break
    }
    case 'pdf': {
      let provider: OcrProvider | null = null
      try {
        const { readPdf } = await import('./pdf')
        const r = await readPdf(bytes, {
          ...range,
          tables: options.includeTables !== false,
          ocr: options.ocr ?? 'off',
          ocrMaxPages: options.ocrMaxPages,
          recognize: options.ocr && options.ocr !== 'off' && options.openOcr
            ? async (png) => {
              provider ??= await options.openOcr!(options.ocrLanguages ?? 'eng')
              return provider.recognize(png, { languages: options.ocrLanguages ?? 'eng' })
            }
            : undefined,
        })
        blocks = r.blocks
        warnings.push(...r.warnings)
        props = { ...props, ...r.metadata, last_modified_by: null, pages: r.page_count }
        structure.pages = r.pages
        structure.outline = r.outline
        structure.form_fields = r.form_fields
        plainText = r.pages.map((p) => p.text).join('\n\n')
        structure.links = r.links.map((l) => ({ text: `page ${l.page}`, href: l.url }))
        if (options.includeTables !== false) structure.tables = r.tables.map((t) => tableToOut(t.rows, true))
        const scanned = r.pages.filter((p) => !p.has_text_layer).length
        if (scanned && (options.ocr ?? 'off') === 'off') warnings.push(`${scanned} page(s) have no text layer (scanned?) — turn on OCR to read them`)
      } finally {
        await (provider as OcrProvider | null)?.close?.()
      }
      break
    }
    case 'markdown': {
      const text = decodeText(bytes) ?? ''
      const r = await readMarkdown(text)
      blocks = r.blocks
      html = r.html
      structure.front_matter = r.frontMatter
      const fm = r.frontMatter ?? {}
      props = { ...props, title: typeof fm.title === 'string' ? fm.title : headingsOf(blocks)[0]?.text ?? null, author: typeof fm.author === 'string' ? fm.author : null }
      plainText = blocksToText(blocks)
      break
    }
    case 'html': {
      const text = decodeText(bytes) ?? ''
      const r = readHtml(text)
      blocks = r.blocks
      props = { ...props, title: r.title, author: r.meta.author ?? null, subject: r.meta.description ?? null, keywords: r.meta.keywords ?? null }
      break
    }
    case 'json': case 'yaml': case 'xml': {
      const text = decodeText(bytes) ?? ''
      try {
        if (type.format === 'json') structure.data = JSON.parse(text)
        else if (type.format === 'yaml') structure.data = (await import('yaml')).parse(text, { maxAliasCount: 50 })
        else {
          const root = parseXml(text)
          structure.data = { [root.name]: xmlToJson(root) }
        }
      } catch (e) {
        if ((e as Error).name === 'XmlSecurityError') throw e
        warnings.push(`Could not parse as ${type.label}: ${(e as Error).message}`)
      }
      plainText = text
      blocks = [{ type: 'code', text, lang: type.format }]
      if (Array.isArray(structure.data) && structure.data.every((r) => r && typeof r === 'object' && !Array.isArray(r))) rows = structure.data as Record<string, unknown>[]
      break
    }
    case 'text': case 'rtf': {
      let text = decodeText(bytes) ?? ''
      if (type.format === 'rtf') text = rtfToText(text)
      plainText = text
      blocks = textToBlocks(text)
      break
    }
    case 'xls': case 'doc': case 'ppt':
      throw new Error(`${type.label} files (the binary format before 2007) are not supported — save it as .${type.format}x, or configure the external converter (DOCUMENT_CONVERTER_URL) and use Convert document first`)
    case 'png': case 'jpeg': case 'gif': case 'webp': case 'bmp': case 'tiff': {
      if (!options.ocr || options.ocr === 'off' || !options.openOcr) throw new Error(`${type.label}: turn on OCR to read text from images`)
      const provider = await options.openOcr(options.ocrLanguages ?? 'eng')
      try {
        const r = await provider.recognize(Buffer.from(bytes), { languages: options.ocrLanguages ?? 'eng' })
        plainText = r.text.trim()
        blocks = textToBlocks(plainText)
        structure.pages = [{ number: 1, text: plainText, characters: plainText.replace(/\s/g, '').length, has_text_layer: false, ocr: { provider: r.provider, confidence: r.confidence } }]
        props = { ...props, pages: 1 }
      } finally {
        await provider.close?.()
      }
      break
    }
    default:
      throw new Error(`Unsupported file type (${type.label}) for "${name}"`)
  }

  if (!structure.headings.length) structure.headings = headingsOf(blocks)
  if (!structure.links.length) structure.links = linksOf(blocks)
  if (options.includeTables !== false && !structure.tables.length) structure.tables = tablesOf(blocks)
  if (options.includeTables === false) structure.tables = []
  if (!rows.length && structure.tables[0]) rows = structure.tables[0].records

  const fullText = plainText ?? blocksToText(blocks)
  const stats = textStats(fullText)
  const t = cap(fullText, maxChars)
  const md = cap(blocksToMarkdown(blocks), maxChars)
  const renderedHtml = cap(html ?? blocksToHtml(blocks), maxChars)
  const truncated = t.cut || md.cut || renderedHtml.cut
  if (truncated) warnings.push(`The output was cut to ${maxChars.toLocaleString('en')} characters`)

  const result: ReadResult = {
    file: { name, size: bytes.byteLength, mime_type: mime || type.mime_type },
    type,
    text: t.text,
    markdown: md.text,
    // Rendered from escaped text (or the Markdown renderer) and always through the allowlist sanitiser.
    html: sanitizeHtml(renderedHtml.text),
    metadata: {
      title: props.title ?? null,
      author: props.author ?? null,
      subject: props.subject ?? null,
      keywords: props.keywords ?? null,
      created: props.created ?? null,
      modified: props.modified ?? null,
      last_modified_by: props.last_modified_by ?? null,
      pages: props.pages ?? null,
      slides: props.slides ?? null,
      sheets: props.sheets ?? null,
      format: type.format,
      format_label: type.label,
      ...stats,
    },
    structure,
    rows,
    truncated,
    warnings,
  }
  return { result, blocks, fullText }
}

/** Very small RTF → text (control words dropped, \par → newline, \'xx decoded). */
export function rtfToText(rtf: string): string {
  let depth = 0
  let skipDepth = -1
  let out = ''
  for (let i = 0; i < rtf.length; i++) {
    const ch = rtf[i]
    if (ch === '{') { depth++; if (rtf.startsWith('{\\*', i) && skipDepth < 0) skipDepth = depth; continue }
    if (ch === '}') { if (depth === skipDepth) skipDepth = -1; depth--; continue }
    if (skipDepth > 0) continue
    if (ch === '\\') {
      const m = /^\\([a-z]+)(-?\d+)? ?|^\\'([0-9a-f]{2})|^\\(.)/i.exec(rtf.slice(i, i + 40))
      if (!m) continue
      i += m[0].length - 1
      if (m[3]) out += String.fromCharCode(parseInt(m[3], 16))
      else if (m[4]) out += m[4] === '~' ? ' ' : /[\\{}]/.test(m[4]) ? m[4] : ''
      else if (m[1] === 'par' || m[1] === 'line') out += '\n'
      else if (m[1] === 'tab') out += '\t'
      else if (/^(fonttbl|colortbl|stylesheet|info|pict)$/.test(m[1])) skipDepth = depth
      continue
    }
    if (ch === '\r' || ch === '\n') continue
    out += ch
  }
  return out.replace(/\n{3,}/g, '\n\n').trim()
}
