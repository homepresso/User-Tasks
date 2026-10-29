/**
 * Convert document: Word / PowerPoint / OpenDocument / PDF / HTML / Markdown
 * / text → PDF, Word, HTML, Markdown or text; spreadsheets (Excel, CSV, ODS,
 * JSON rows) ↔ CSV, Excel and JSON. Built-in conversions are pure JS; a
 * Gotenberg-compatible service (DOCUMENT_CONVERTER_URL) gives
 * high-fidelity Office → PDF and handles the pre-2007 binary formats.
 */

import { blocksToHtml, blocksToMarkdown, escapeHtml, type Block } from './model'
import { detectType } from './detect'
import { readDocumentFull, type ReadOptions } from './read'
import { toCsv, writeXlsx, readCsv, type Cell } from './sheets'
import { htmlDocument } from './diff'
import { MIME } from './store'
import { sanitizeHtml } from '@/lib/html-sanitize'

export type ConvertTarget = 'pdf' | 'docx' | 'html' | 'markdown' | 'text' | 'csv' | 'xlsx' | 'json'
export const CONVERT_TARGETS: ConvertTarget[] = ['pdf', 'docx', 'html', 'markdown', 'text', 'csv', 'xlsx', 'json']

const EXT: Record<ConvertTarget, string> = { pdf: 'pdf', docx: 'docx', html: 'html', markdown: 'md', text: 'txt', csv: 'csv', xlsx: 'xlsx', json: 'json' }
const TARGET_MIME: Record<ConvertTarget, string> = { pdf: MIME.pdf, docx: MIME.docx, html: MIME.html, markdown: MIME.md, text: MIME.txt, csv: MIME.csv, xlsx: MIME.xlsx, json: MIME.json }

export interface ConvertOptions extends Pick<ReadOptions, 'sheet' | 'range' | 'headerRow' | 'pages' | 'ocr' | 'ocrLanguages' | 'openOcr'> {
  /** auto (default): the external converter for Office → PDF when configured; builtin; external. */
  engine?: 'auto' | 'builtin' | 'external'
  delimiter?: string
  title?: string
  pageSize?: 'A4' | 'Letter'
}

export interface ConvertResult {
  bytes: Uint8Array
  extension: string
  mime_type: string
  engine: 'builtin' | 'external'
  from: string
  to: ConvertTarget
  warnings: string[]
}

const TABULAR = new Set(['xlsx', 'ods', 'csv', 'tsv'])
const LEGACY = new Set(['doc', 'xls', 'ppt'])

function rowsToArrays(rows: Record<string, unknown>[]): Cell[][] {
  const headers: string[] = []
  const seen = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r ?? {})) if (!seen.has(k)) { seen.add(k); headers.push(k) }
  const cell = (v: unknown): Cell => (v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : (v as Cell))
  return [headers, ...rows.map((r) => headers.map((h) => cell(r?.[h])))]
}

const utf8 = (s: string) => new TextEncoder().encode(s)

export async function convertDocument(bytes: Uint8Array, name: string, target: ConvertTarget, options: ConvertOptions = {}): Promise<ConvertResult> {
  if (!CONVERT_TARGETS.includes(target)) throw new Error(`Unknown target format "${target}"`)
  const type = detectType(bytes, name)
  const from = type.format === 'markdown' ? 'md' : type.format
  const warnings: string[] = []
  const done = (out: Uint8Array, engine: 'builtin' | 'external' = 'builtin'): ConvertResult => ({ bytes: out, extension: EXT[target], mime_type: TARGET_MIME[target], engine, from: type.format, to: target, warnings })
  const engine = options.engine ?? 'auto'

  if (target === 'pdf') {
    const { externalConverterConfigured, externalCanConvert, convertExternally } = await import('./external-converter')
    const officeLike = ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'doc', 'xls', 'ppt'].includes(type.format)
    const useExternal = engine === 'external' || (engine === 'auto' && externalConverterConfigured() && officeLike)
    if (useExternal) {
      if (!externalConverterConfigured()) throw new Error('engine "external" needs DOCUMENT_CONVERTER_URL (a Gotenberg-compatible service)')
      if (!externalCanConvert(from, 'pdf')) throw new Error(`The external converter cannot convert ${type.label} to PDF`)
      return done(await convertExternally(bytes, name, from), 'external')
    }
    if (type.format === 'pdf') return done(bytes)
  }
  if (LEGACY.has(type.format)) throw new Error(`${type.label} files can only be converted to PDF with the external converter (DOCUMENT_CONVERTER_URL)`)

  // JSON rows behave like a sheet.
  let jsonRows: Record<string, unknown>[] | null = null
  if (type.format === 'json') {
    try {
      const data = JSON.parse(new TextDecoder().decode(bytes))
      if (Array.isArray(data) && data.every((r) => r && typeof r === 'object' && !Array.isArray(r))) jsonRows = data
    } catch { /* not JSON rows */ }
  }

  if (target === 'json' && jsonRows) return done(utf8(JSON.stringify(jsonRows, null, 2)))
  if ((target === 'csv' || target === 'xlsx') && jsonRows) {
    const arrays = rowsToArrays(jsonRows)
    if (target === 'csv') return done(utf8(toCsv(arrays, options.delimiter || ',')))
    return done(await writeXlsx([{ name: 'Sheet1', arrays }]))
  }

  const { result, blocks, fullText } = await readDocumentFull(bytes, name, null, {
    sheet: options.sheet, range: options.range, headerRow: options.headerRow, pages: options.pages,
    ocr: options.ocr, ocrLanguages: options.ocrLanguages, openOcr: options.openOcr, delimiter: options.delimiter,
  })
  warnings.push(...result.warnings)
  const sheets = result.structure.sheets ?? []
  const title = options.title ?? result.metadata.title ?? name.replace(/\.[^.]+$/, '')

  switch (target) {
    case 'csv': {
      if (TABULAR.has(type.format) && sheets.length) {
        if (sheets.length > 1 && !options.sheet) warnings.push(`Only the first sheet ("${sheets[0].name}") was converted — choose a sheet for another`)
        return done(utf8(toCsv(sheets[0].values, options.delimiter || ',')))
      }
      const table = result.structure.tables[0]
      if (!table) throw new Error(`${type.label} has no table to convert to CSV`)
      if (result.structure.tables.length > 1) warnings.push('Only the first table was converted')
      return done(utf8(toCsv([table.header, ...table.rows], options.delimiter || ',')))
    }
    case 'xlsx': {
      if (TABULAR.has(type.format) && sheets.length) return done(await writeXlsx(sheets.map((s) => ({ name: s.name, arrays: s.values }))))
      const tables = result.structure.tables
      if (!tables.length) throw new Error(`${type.label} has no table to convert to Excel`)
      return done(await writeXlsx(tables.map((t, k) => ({ name: `Table ${k + 1}`, arrays: [t.header, ...t.rows] }))))
    }
    case 'json': {
      if (TABULAR.has(type.format) && sheets.length) {
        const data = sheets.length === 1 ? sheets[0].rows : Object.fromEntries(sheets.map((s) => [s.name, s.rows]))
        return done(utf8(JSON.stringify(data, null, 2)))
      }
      return done(utf8(JSON.stringify({ metadata: result.metadata, text: result.text, structure: result.structure }, null, 2)))
    }
    case 'text':
      return done(utf8(fullText))
    case 'markdown':
      if (type.format === 'markdown') return done(bytes)
      return done(utf8(blocksToMarkdown(blocks)))
    case 'html': {
      const fragment = type.format === 'markdown' ? result.html : sanitizeHtml(blocksToHtml(blocks))
      const styled = `<style>body{max-width:860px;margin:32px auto;padding:0 16px;line-height:1.55}table{border-collapse:collapse}td,th{border:1px solid rgba(127,127,127,.4);padding:4px 8px;text-align:left}pre{white-space:pre-wrap}</style><h1>${escapeHtml(title)}</h1>`
      return done(utf8(htmlDocument(title, `${styled}${fragment}`)))
    }
    case 'docx': {
      const { writeDocx } = await import('./docx')
      return done(await writeDocx(blocks, { title, author: result.metadata.author ?? undefined }))
    }
    case 'pdf': {
      const { renderPdf } = await import('./pdf-tools')
      const out = await renderPdf(blocks as Block[], { title, author: result.metadata.author ?? undefined, pageSize: options.pageSize })
      warnings.push(...out.warnings)
      if (['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods'].includes(type.format)) warnings.push('Built-in PDF output keeps the text, headings, lists and tables but not the original layout; configure DOCUMENT_CONVERTER_URL for a faithful copy')
      return done(out.bytes)
    }
  }
  throw new Error(`Cannot convert ${type.label} to ${target}`)
}

/** CSV text → .xlsx (used by tests and the CSV → Excel path). */
export async function csvToXlsx(text: string, delimiter?: string): Promise<Uint8Array> {
  const sheet = readCsv(text, { delimiter, headerRow: 'none' })
  return writeXlsx([{ name: 'Sheet1', arrays: sheet.values }])
}
