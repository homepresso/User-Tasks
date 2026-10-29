/**
 * Workflow engine handlers for the document actions:
 *
 *   doc_read      Read document      file → text / markdown / html / metadata / structure / rows
 *   doc_compare   Compare documents  two files, texts, row lists or JSON → diff, stats, report, redline
 *   doc_convert   Convert document   file → pdf / docx / html / markdown / text / csv / xlsx / json
 *   doc_pdf       PDF tools          merge, split, extract pages, page count, watermark, rotate, fill / read form
 *   doc_extract   Extract            tables, regex key-values, emails / URLs / phones / dates / amounts; rows → data table
 *   doc_redact    Redact             PII presets, terms, patterns → redacted copy
 *   doc_inspect   Inspect document   type (magic bytes), checksums, counts, search with context
 *
 * Inputs are read with lib/files/resolve-input (the run's tenant only);
 * output files are stored with lib/documents/store and returned as file
 * objects. Handler return values are what the run history shows, so they
 * are compact (no full document text); the full results are in variables.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { resolveFileInput, resolveFileInputs, fileInputValues, type ResolvedFile } from '@/lib/files/resolve-input'
import { DOCUMENT_LIMITS, withTimeout } from './limits'
import { MIME, outputFileName, storeDocumentFile, type DocumentFileObject } from './store'
import type { ReadOptions } from './read'

export interface DocumentNodeContext {
  type: string
  config: Record<string, any>
  /** Resolves an expression / template against the run's variables. */
  resolve: (expr: unknown) => any
  supabase: SupabaseClient
  tenantId: string
  variables: Record<string, any>
  /** Sets `<prefix>_<name>` and `<name>`. */
  setVar: (name: string, value: unknown) => void
  warn: (message: string) => void
  /** Who started the run (signed into data-table event jobs). */
  initiator?: unknown
}

/* ── Config helpers ─────────────────────────────────────────────────── */

const bool = (v: unknown, dflt = false) => (v === undefined || v === null || v === '' ? dflt : v === true || v === 'true' || v === 1 || v === '1' || v === 'yes')
const num = (v: unknown, dflt?: number) => { const n = Number(v); return v === undefined || v === null || v === '' || !Number.isFinite(n) ? dflt : n }
const str = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).trim()

/** "a, b" / ["a","b"] → ["a","b"]. */
export function listOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean)
  const s = str(v)
  if (!s) return []
  if (s.startsWith('[')) { try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map((x) => str(x)).filter(Boolean) } catch { /* plain list */ } }
  return s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)
}

function resolved(ctx: DocumentNodeContext, key: string): any {
  return ctx.resolve(ctx.config[key])
}

function opt(ctx: DocumentNodeContext, key: string): string {
  return str(resolved(ctx, key))
}

function outputVar(ctx: DocumentNodeContext, fallback: string): string {
  const v = str(ctx.config.output_var).replace(/[^\w.]/g, '')
  return v || fallback
}

function readOptions(ctx: DocumentNodeContext): ReadOptions {
  const header = opt(ctx, 'header_row')
  const ocr = opt(ctx, 'ocr')
  return {
    pages: opt(ctx, 'pages') || null,
    sheet: opt(ctx, 'sheet') || null,
    range: opt(ctx, 'range') || null,
    headerRow: !header ? 'auto' : /^\d+$/.test(header) ? Number(header) : (header as 'auto' | 'first' | 'none'),
    maxRows: num(resolved(ctx, 'max_rows')),
    maxChars: num(resolved(ctx, 'max_chars')),
    includeTables: bool(ctx.config.include_tables, true),
    includeImages: bool(ctx.config.include_images, false),
    trackedChanges: opt(ctx, 'tracked_changes') === 'show' ? 'show' : 'accept',
    delimiter: opt(ctx, 'delimiter') || undefined,
    ocr: ocr === 'auto' || ocr === 'force' ? ocr : 'off',
    ocrLanguages: opt(ctx, 'ocr_languages') || 'eng',
    openOcr: async (languages: string) => {
      const { openOcrProvider, normaliseLanguages } = await import('./ocr')
      return openOcrProvider(normaliseLanguages(languages))
    },
  }
}

async function input(ctx: DocumentNodeContext, key: string, label: string, allowText = false): Promise<ResolvedFile> {
  const value = resolved(ctx, key)
  return resolveFileInput(value, { tenantId: ctx.tenantId, label, allowText })
}

async function save(ctx: DocumentNodeContext, bytes: Uint8Array, name: string, mime: string): Promise<DocumentFileObject> {
  return storeDocumentFile(ctx.supabase as never, ctx.tenantId, bytes, name, mime)
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'document'
}

function preview(text: string, n = 300): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

/* ── Read document ──────────────────────────────────────────────────── */

async function readNode(ctx: DocumentNodeContext) {
  const file = await input(ctx, 'source', 'Document', true)
  const { readDocument } = await import('./read')
  const result = await withTimeout(readDocument(file.bytes, file.name, file.mime_type, readOptions(ctx)), Math.max(DOCUMENT_LIMITS.timeoutMs, readOptions(ctx).ocr !== 'off' ? DOCUMENT_LIMITS.ocrTimeoutMs : 0), 'Reading the document')
  const ov = outputVar(ctx, 'document')
  ctx.variables[ov] = result
  ctx.variables[`${ov}_text`] = result.text
  ctx.variables[`${ov}_rows`] = result.rows
  ctx.variables[`${ov}_count`] = result.rows.length
  ctx.setVar('document_metadata', result.metadata)
  for (const w of result.warnings) ctx.warn(`${file.name}: ${w}`)
  return {
    variable: ov,
    file: file.name,
    format: result.metadata.format,
    pages: result.metadata.pages ?? undefined,
    slides: result.metadata.slides ?? undefined,
    sheets: result.metadata.sheets ?? undefined,
    words: result.metadata.words,
    characters: result.metadata.characters,
    rows: result.rows.length,
    tables: result.structure.tables.length,
    truncated: result.truncated,
    text_preview: preview(result.text),
    ...(result.warnings.length ? { warnings: result.warnings } : {}),
  }
}

/* ── Compare ────────────────────────────────────────────────────────── */

type Side = { kind: 'file'; file: ResolvedFile } | { kind: 'rows'; rows: Record<string, unknown>[]; name: string } | { kind: 'json'; value: unknown; name: string } | { kind: 'text'; text: string; name: string }

function sideOf(value: unknown, label: string): Side | null {
  if (Array.isArray(value) && value.length && value.every((r) => r && typeof r === 'object' && !Array.isArray(r) && !('url' in r) && !('storage_ref' in r) && !('base64' in r))) return { kind: 'rows', rows: value as Record<string, unknown>[], name: label }
  if (value && typeof value === 'object' && !Array.isArray(value) && !('url' in value) && !('storage_ref' in value) && !('base64' in value) && !('content_base64' in value) && !('ref' in value) && !('file_url' in value) && !('text' in value)) return { kind: 'json', value, name: label }
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object')) return { kind: 'json', value, name: label }
  return null
}

async function loadSide(ctx: DocumentNodeContext, key: string, label: string): Promise<Side> {
  const value = resolved(ctx, key)
  const direct = sideOf(value, label)
  if (direct) return direct
  const file = await resolveFileInput(value, { tenantId: ctx.tenantId, label, allowText: true })
  if (file.source === 'text') return { kind: 'text', text: new TextDecoder().decode(file.bytes), name: label }
  return { kind: 'file', file }
}

async function compareNode(ctx: DocumentNodeContext) {
  const diff = await import('./diff')
  const { readDocumentFull } = await import('./read')
  const { detectType } = await import('./detect')
  const a = await loadSide(ctx, 'original', 'Original')
  const b = await loadSide(ctx, 'revised', 'Revised')
  const nameOf = (s: Side) => (s.kind === 'file' ? s.file.name : s.name)
  const fmtOf = (s: Side) => (s.kind === 'file' ? detectType(s.file.bytes, s.file.name).format : s.kind)
  const tabular = (f: string) => ['xlsx', 'ods', 'csv', 'tsv', 'rows'].includes(f)
  let mode = opt(ctx, 'mode') || 'auto'
  if (mode === 'auto') {
    const fa = fmtOf(a)
    const fb = fmtOf(b)
    if (tabular(fa) && tabular(fb)) mode = 'sheet'
    else if ((fa === 'json' || fa === 'yaml') && (fb === 'json' || fb === 'yaml')) mode = 'json'
    else if (['docx', 'pdf', 'pptx', 'odt', 'html', 'markdown', 'rtf'].includes(fa) || ['docx', 'pdf', 'pptx', 'odt', 'html', 'markdown', 'rtf'].includes(fb)) mode = 'words'
    else mode = 'lines'
  }
  const norm = { ignoreWhitespace: bool(ctx.config.ignore_whitespace), ignoreCase: bool(ctx.config.ignore_case), ignorePunctuation: bool(ctx.config.ignore_punctuation) }
  const sheetOpts: ReadOptions = { sheet: opt(ctx, 'sheet') || null, headerRow: 'auto' }
  const ov = outputVar(ctx, 'comparison')
  const outName = opt(ctx, 'output_name') || `${baseName(nameOf(b))}-comparison`
  const title = `${nameOf(a)} → ${nameOf(b)}`
  const files: Record<string, DocumentFileObject> = {}
  let result: Record<string, any>

  if (mode === 'sheet') {
    const rowsOf = async (s: Side): Promise<Record<string, unknown>[]> => {
      if (s.kind === 'rows') return s.rows
      if (s.kind === 'file') return (await readDocumentFull(s.file.bytes, s.file.name, s.file.mime_type, sheetOpts)).result.rows
      if (s.kind === 'text') return (await readDocumentFull(new TextEncoder().encode(s.text), 'data.csv', 'text/csv', sheetOpts)).result.rows
      throw new Error(`${s.name}: a spreadsheet comparison needs rows (a sheet, CSV or a list of objects)`)
    }
    const r = diff.diffRows(await rowsOf(a), await rowsOf(b), {
      ...norm,
      keyColumns: listOf(resolved(ctx, 'key_columns')),
      compareColumns: listOf(resolved(ctx, 'compare_columns')),
      ignoreColumns: listOf(resolved(ctx, 'ignore_columns')),
      numericTolerance: num(resolved(ctx, 'numeric_tolerance'), 0),
    })
    for (const w of r.warnings) ctx.warn(w)
    result = { ...r }
  } else if (mode === 'json') {
    const jsonOf = async (s: Side): Promise<unknown> => {
      if (s.kind === 'json') return s.value
      if (s.kind === 'rows') return s.rows
      const text = s.kind === 'text' ? s.text : new TextDecoder().decode(s.file.bytes)
      if (s.kind === 'file' && fmtOf(s) === 'yaml') return (await import('yaml')).parse(text, { maxAliasCount: 50 })
      try { return JSON.parse(text) } catch { throw new Error(`${nameOf(s)} is not valid JSON`) }
    }
    result = { ...diff.diffJson(await jsonOf(a), await jsonOf(b), { ...norm, arrayKey: opt(ctx, 'array_key') || undefined }) }
  } else {
    const textMode = (['lines', 'words', 'characters', 'sentences'].includes(mode) ? mode : 'lines') as import('./diff').TextDiffMode
    const docOf = async (s: Side) => {
      if (s.kind === 'file') return readDocumentFull(s.file.bytes, s.file.name, s.file.mime_type, { maxChars: DOCUMENT_LIMITS.maxDiffChars })
      const text = s.kind === 'text' ? s.text : JSON.stringify(s.kind === 'rows' ? s.rows : s.value, null, 2)
      const { textToBlocks } = await import('./model')
      return { result: null, blocks: textToBlocks(text), fullText: text }
    }
    const da = await docOf(a)
    const db = await docOf(b)
    const r = await diff.diffText(da.fullText, db.fullText, { ...norm, mode: textMode, context: num(resolved(ctx, 'context_lines'), 3), oldName: nameOf(a), newName: nameOf(b) })
    result = { ...r }
    const redline = opt(ctx, 'redline') || 'none'
    if (redline !== 'none' && !r.identical) {
      const blocks = await diff.redlineBlocks(da.blocks, db.blocks, norm)
      const heading = [{ type: 'heading' as const, level: 1, inlines: [{ text: `Redline: ${title}` }] }, { type: 'paragraph' as const, inlines: [{ text: diff.statsLine(r.stats, r.similarity), italic: true }] }]
      if (redline === 'docx' || redline === 'both') {
        const { writeDocx } = await import('./docx')
        const bytes = await writeDocx([...heading, ...blocks], { title: `Redline ${nameOf(b)}`, redlineStyle: opt(ctx, 'redline_style') === 'tracked' ? 'tracked' : 'formatting', changeAuthor: 'UserTasks compare' })
        files.redline_docx = await save(ctx, bytes, outputFileName(`${outName}-redline`, 'redline', 'docx'), MIME.docx)
      }
      if (redline === 'pdf' || redline === 'both') {
        const { renderPdf } = await import('./pdf-tools')
        const out = await renderPdf([...heading, ...blocks], { title: `Redline ${nameOf(b)}`, redline: true })
        files.redline_pdf = await save(ctx, out.bytes, outputFileName(`${outName}-redline`, 'redline', 'pdf'), MIME.pdf)
      }
    }
  }

  const report = opt(ctx, 'report') || 'none'
  if (report === 'html') {
    files.report = await save(ctx, new TextEncoder().encode(diff.htmlDocument(`Comparison: ${title}`, result.html)), outputFileName(outName, 'comparison', 'html'), MIME.html)
  } else if (report === 'pdf') {
    const { renderPdf } = await import('./pdf-tools')
    const blocks = reportBlocks(result, title)
    const out = await renderPdf(blocks, { title: `Comparison: ${title}`, redline: true })
    files.report = await save(ctx, out.bytes, outputFileName(outName, 'comparison', 'pdf'), MIME.pdf)
  }
  const full = { ...result, original: { name: nameOf(a) }, revised: { name: nameOf(b) }, ...files }
  ctx.variables[ov] = full
  ctx.variables[`${ov}_identical`] = result.identical
  ctx.variables[`${ov}_similarity`] = result.similarity
  ctx.variables[`${ov}_html`] = result.html
  for (const [k, f] of Object.entries(files)) ctx.variables[`${ov}_${k}`] = f
  return {
    variable: ov,
    mode: result.mode,
    identical: result.identical,
    similarity: result.similarity,
    stats: result.stats,
    changes: Array.isArray(result.changes) ? result.changes.length : 0,
    ...(Object.keys(files).length ? { files: Object.fromEntries(Object.entries(files).map(([k, f]) => [k, f.name])) } : {}),
  }
}

/** A PDF-able summary of any comparison result. */
function reportBlocks(result: Record<string, any>, title: string): import('./model').Block[] {
  const blocks: import('./model').Block[] = [{ type: 'heading', level: 1, inlines: [{ text: `Comparison: ${title}` }] }]
  const s = result.stats ?? {}
  blocks.push({ type: 'paragraph', inlines: [{ text: result.identical ? 'No differences.' : `${s.changed ?? 0} changed · ${s.added ?? 0} added · ${s.removed ?? 0} removed · ${result.similarity}% similar`, italic: true }] })
  const changes = (result.changes ?? []) as any[]
  if (result.mode === 'sheet') {
    blocks.push({ type: 'table', header: true, rows: [['Change', 'Row', 'Values'], ...changes.slice(0, 500).map((c) => [c.type, Object.entries(c.key ?? {}).map(([k, v]) => `${k}=${v}`).join(', '), c.type === 'changed' ? (c.columns ?? []).map((x: any) => `${x.column}: ${x.old ?? ''} → ${x.new ?? ''}`).join('\n') : Object.entries((c.new ?? c.old) ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ')])] })
  } else if (result.mode === 'json') {
    blocks.push({ type: 'table', header: true, rows: [['Change', 'Path', 'Old', 'New'], ...changes.slice(0, 500).map((c) => [c.type, c.path, c.old === undefined ? '' : JSON.stringify(c.old), c.new === undefined ? '' : JSON.stringify(c.new)])] })
  } else {
    for (const c of changes.slice(0, 500)) {
      const where = c.old_line || c.new_line ? `Line ${c.old_line ?? c.new_line}: ` : ''
      const inl: import('./model').Inline[] = [{ text: where, bold: true }]
      if (c.old_text) inl.push({ text: c.old_text.trim(), del: true })
      if (c.old_text && c.new_text) inl.push({ text: ' ' })
      if (c.new_text) inl.push({ text: c.new_text.trim(), ins: true })
      blocks.push({ type: 'paragraph', inlines: inl })
    }
  }
  if (changes.length > 500) blocks.push({ type: 'paragraph', inlines: [{ text: `… and ${changes.length - 500} more changes`, italic: true }] })
  return blocks
}

/* ── Convert ────────────────────────────────────────────────────────── */

async function convertNode(ctx: DocumentNodeContext) {
  const file = await input(ctx, 'source', 'Document', true)
  const target = (opt(ctx, 'target') || 'pdf') as import('./convert').ConvertTarget
  const { convertDocument } = await import('./convert')
  const ro = readOptions(ctx)
  const engine = opt(ctx, 'engine')
  const r = await withTimeout(convertDocument(file.bytes, file.source === 'text' ? 'text.txt' : file.name, target, {
    engine: engine === 'builtin' || engine === 'external' ? engine : 'auto',
    sheet: ro.sheet, range: ro.range, pages: ro.pages, delimiter: ro.delimiter, ocr: ro.ocr, ocrLanguages: ro.ocrLanguages, openOcr: ro.openOcr,
    title: opt(ctx, 'title') || undefined,
    pageSize: opt(ctx, 'page_size') === 'Letter' ? 'Letter' : 'A4',
  }), DOCUMENT_LIMITS.timeoutMs * 2, 'Converting the document')
  for (const w of r.warnings) ctx.warn(`${file.name}: ${w}`)
  const name = outputFileName(opt(ctx, 'output_name') || baseName(file.name), 'document', r.extension)
  const out = await save(ctx, r.bytes, name, r.mime_type)
  const ov = outputVar(ctx, 'converted_file')
  ctx.variables[ov] = out
  ctx.setVar('file', out)
  ctx.setVar('file_url', out.url)
  return { variable: ov, from: r.from, to: r.to, engine: r.engine, file: out.name, size: out.size, ...(r.warnings.length ? { warnings: r.warnings } : {}) }
}

/* ── PDF tools ──────────────────────────────────────────────────────── */

function fieldValues(ctx: DocumentNodeContext): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const obj = resolved(ctx, 'field_values')
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) Object.assign(out, obj)
  else if (typeof obj === 'string' && obj.trim().startsWith('{')) { try { Object.assign(out, JSON.parse(obj)) } catch { throw new Error('Field values must be a JSON object') } }
  for (const f of (Array.isArray(ctx.config.fields) ? ctx.config.fields : []) as Array<{ name?: string; value?: unknown }>) {
    const name = str(f?.name)
    if (name) out[name] = ctx.resolve(f.value)
  }
  return out
}

async function pdfNode(ctx: DocumentNodeContext) {
  const tools = await import('./pdf-tools')
  const op = opt(ctx, 'operation') || 'merge'
  const ov = outputVar(ctx, op === 'page_count' ? 'page_count' : op === 'read_form' ? 'form' : op === 'split' ? 'pdf_files' : 'pdf_file')
  const outBase = opt(ctx, 'output_name')
  const finish = async (bytes: Uint8Array, fallback: string, extra: Record<string, unknown> = {}) => {
    const out = await save(ctx, bytes, outputFileName(outBase || fallback, 'document', 'pdf'), MIME.pdf)
    ctx.variables[ov] = out
    ctx.setVar('file', out)
    ctx.setVar('file_url', out.url)
    return { variable: ov, operation: op, file: out.name, size: out.size, ...extra }
  }
  const requirePdf = async (key = 'source', label = 'PDF') => {
    const f = await input(ctx, key, label)
    const { detectType } = await import('./detect')
    if (detectType(f.bytes, f.name).format !== 'pdf') throw new Error(`${label} "${f.name}" is not a PDF — use Convert document first`)
    return f
  }
  switch (op) {
    case 'merge': {
      const raw = resolved(ctx, 'sources')
      const entries = fileInputValues(raw)
      if (entries.length < 1) throw new Error('Add the PDFs to merge')
      const files = await resolveFileInputs(entries, { tenantId: ctx.tenantId, label: 'PDF', maxTotalBytes: DOCUMENT_LIMITS.maxInputBytes * 4 })
      const r = await tools.mergePdfs(files.map((f) => ({ name: f.name, bytes: f.bytes })))
      return finish(r.bytes, 'merged', { pages: r.pages, files: files.length })
    }
    case 'extract_pages': {
      const f = await requirePdf()
      const r = await tools.extractPages(f.bytes, opt(ctx, 'pages') || '1', f.name)
      return finish(r.bytes, `${baseName(f.name)}-pages`, { pages: r.pages })
    }
    case 'split': {
      const f = await requirePdf()
      const parts = await tools.splitPdf(f.bytes, { ranges: opt(ctx, 'ranges') || undefined, everyN: num(resolved(ctx, 'every_n'), 1) }, f.name)
      const out: DocumentFileObject[] = []
      for (const [k, p] of parts.entries()) out.push(await save(ctx, p.bytes, outputFileName(`${outBase || baseName(f.name)}-part${k + 1}`, 'part', 'pdf'), MIME.pdf))
      ctx.variables[ov] = out
      ctx.variables[`${ov}_count`] = out.length
      return { variable: ov, operation: op, files: out.length, ranges: parts.map((p) => p.range) }
    }
    case 'page_count': {
      const f = await requirePdf()
      const count = await tools.pageCount(f.bytes)
      ctx.variables[ov] = count
      return { variable: ov, operation: op, pages: count }
    }
    case 'watermark': {
      const f = await requirePdf()
      const text = opt(ctx, 'text')
      if (!text) throw new Error('Watermark text is required')
      const r = await tools.watermarkPdf(f.bytes, {
        text,
        position: opt(ctx, 'position') || 'center',
        size: num(resolved(ctx, 'font_size')),
        opacity: num(resolved(ctx, 'opacity')),
        rotation: num(resolved(ctx, 'angle')),
        color: opt(ctx, 'color') || undefined,
        pages: opt(ctx, 'pages') || undefined,
      })
      for (const w of r.warnings) ctx.warn(w)
      return finish(r.bytes, `${baseName(f.name)}-stamped`, { pages_stamped: r.pages })
    }
    case 'rotate': {
      const f = await requirePdf()
      const bytes = await tools.rotatePages(f.bytes, num(resolved(ctx, 'degrees'), 90)!, opt(ctx, 'pages') || undefined)
      return finish(bytes, `${baseName(f.name)}-rotated`)
    }
    case 'fill_form': {
      const f = await requirePdf()
      const values = fieldValues(ctx)
      const r = await tools.fillForm(f.bytes, values, { flatten: bool(ctx.config.flatten), strict: bool(ctx.config.strict) })
      for (const w of r.warnings) ctx.warn(w)
      if (r.missing.length) ctx.warn(`No such form field: ${r.missing.join(', ')}`)
      return finish(r.bytes, `${baseName(f.name)}-filled`, { filled: r.filled.length, missing: r.missing })
    }
    case 'read_form': {
      const f = await requirePdf()
      const fields = await tools.readFormFields(f.bytes)
      const values = Object.fromEntries(fields.map((x) => [x.name, x.value]))
      ctx.variables[ov] = { fields, values }
      ctx.variables[`${ov}_values`] = values
      return { variable: ov, operation: op, fields: fields.length }
    }
  }
  throw new Error(`Unknown PDF operation "${op}"`)
}

/* ── Extract ────────────────────────────────────────────────────────── */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

async function writeRowsToTable(ctx: DocumentNodeContext, tableId: string, rows: Record<string, unknown>[], mapping: Array<{ column: string; field: string }>): Promise<{ inserted: number; columns: string[] }> {
  const { data: table, error } = await (ctx.supabase as any).from('custom_tables').select('id, name, slug, columns').eq('id', tableId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error || !table) throw new Error('Data table not found')
  const { normalizeTableColumns } = await import('@/lib/data-table-columns')
  const columns = normalizeTableColumns(table.columns)
  const keys = columns.map((c) => c.key)
  const sourceKeys = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  let map = mapping.filter((m) => m.column && m.field)
  if (!map.length) {
    // Auto-map: same key or label, ignoring case, spaces and punctuation.
    map = columns.flatMap((c) => {
      const hit = sourceKeys.find((k) => slug(k) === slug(c.key) || slug(k) === slug(c.label ?? ''))
      return hit ? [{ column: c.key, field: hit }] : []
    })
  }
  if (!map.length) throw new Error(`None of the columns (${sourceKeys.slice(0, 8).join(', ')}) match the table's columns — add a column mapping`)
  const unknown = map.filter((m) => !keys.includes(m.column)).map((m) => m.column)
  if (unknown.length) throw new Error(`The data table has no column ${unknown.map((c) => `"${c}"`).join(', ')}`)
  const capped = rows.slice(0, DOCUMENT_LIMITS.maxTableRows)
  if (rows.length > capped.length) ctx.warn(`Only the first ${DOCUMENT_LIMITS.maxTableRows} rows were written to the data table`)
  const payload = capped.map((r) => ({ table_id: tableId, tenant_id: ctx.tenantId, data: Object.fromEntries(map.map((m) => [m.column, r[m.field] ?? null])) }))
  const events: Array<{ rowId: string; rowData: Record<string, unknown>; eventType: 'created' }> = []
  for (let k = 0; k < payload.length; k += 500) {
    const chunk = payload.slice(k, k + 500)
    const { data: inserted, error: insertError } = await (ctx.supabase as any).from('custom_table_rows').insert(chunk).select('id, data')
    if (insertError) throw new Error(`Insert failed: ${insertError.message}`)
    for (const row of inserted ?? []) events.push({ rowId: row.id, rowData: row.data, eventType: 'created' })
  }
  if (events.length) {
    const { enqueueDataTableEvents } = await import('@/lib/data-table-workflow-triggers')
    await enqueueDataTableEvents({ supabase: ctx.supabase, tenantId: ctx.tenantId, tableId, events, table, initiator: ctx.initiator as never })
  }
  return { inserted: events.length, columns: map.map((m) => m.column) }
}

async function extractNode(ctx: DocumentNodeContext) {
  const file = await input(ctx, 'source', 'Document', true)
  const { readDocument } = await import('./read')
  const ex = await import('./extract')
  const doc = await withTimeout(readDocument(file.bytes, file.name, file.mime_type, { ...readOptions(ctx), includeTables: true }), DOCUMENT_LIMITS.timeoutMs, 'Reading the document')
  const ov = outputVar(ctx, 'extracted')
  const out: Record<string, any> = { file: file.name }
  // Tables (spreadsheets: their sheets as tables).
  const sheetTables = (doc.structure.sheets ?? []).map((s) => ({ header: s.headers, rows: s.values.slice((s.header_row ?? 0)).map((r) => r.map((v) => (v === null ? '' : String(v)))), records: s.rows }))
  const tables = sheetTables.length ? sheetTables : doc.structure.tables
  if (bool(ctx.config.extract_tables, true)) out.tables = tables
  const pick = opt(ctx, 'table_index')
  const chosen = !pick || pick === 'all' ? tables : tables.filter((_, k) => String(k + 1) === pick)
  out.rows = (pick === 'all' ? chosen.flatMap((t) => t.records) : (chosen[0]?.records ?? [])) as Record<string, unknown>[]
  // Patterns.
  const patterns = (Array.isArray(ctx.config.patterns) ? ctx.config.patterns : []).filter((p: any) => p?.name && p?.pattern)
  if (patterns.length) {
    const r = ex.extractPatterns(doc.text, patterns.map((p: any) => ({ name: str(p.name), pattern: String(p.pattern), flags: p.flags, group: p.group === '' ? undefined : p.group, all: bool(p.all) })))
    out.values = r.values
    for (const e of r.errors) ctx.warn(e)
    for (const [k, v] of Object.entries(r.values)) ctx.variables[`${ov}_${k}`] = v
  }
  // Finders.
  const finders = listOf(ctx.config.finders).filter((f): f is import('./extract').FinderName => (ex.FINDERS as string[]).includes(f))
  if (finders.length) out.found = ex.runFinders(doc.text, finders, { dateOrder: opt(ctx, 'date_order') === 'MDY' ? 'MDY' : 'DMY' })
  // Rows → data table.
  let written: { inserted: number; columns: string[] } | null = null
  if (bool(ctx.config.to_table)) {
    const tableId = str(ctx.config.table_id)
    if (!tableId) throw new Error('Choose the data table to write rows to')
    const mapping = (Array.isArray(ctx.config.column_mapping) ? ctx.config.column_mapping : []).map((m: any) => ({ column: str(m?.column), field: str(m?.field) }))
    written = await writeRowsToTable(ctx, tableId, out.rows, mapping)
    out.table_rows_inserted = written.inserted
  }
  ctx.variables[ov] = out
  ctx.variables[`${ov}_rows`] = out.rows
  ctx.variables[`${ov}_count`] = out.rows.length
  return {
    variable: ov,
    file: file.name,
    tables: tables.length,
    rows: out.rows.length,
    ...(out.values ? { values: Object.keys(out.values).length } : {}),
    ...(out.found ? { found: Object.fromEntries(Object.entries(out.found).map(([k, v]) => [k, (v as unknown[]).length])) } : {}),
    ...(written ? { inserted: written.inserted, table_columns: written.columns } : {}),
  }
}

/* ── Redact ─────────────────────────────────────────────────────────── */

async function redactNode(ctx: DocumentNodeContext) {
  const file = await input(ctx, 'source', 'Document', true)
  const rd = await import('./redact')
  const { detectType } = await import('./detect')
  const presets = listOf(ctx.config.presets).filter((p): p is import('./redact').RedactPreset => (rd.REDACT_PRESETS as string[]).includes(p))
  const options: import('./redact').RedactOptions = {
    presets,
    terms: listOf(resolved(ctx, 'terms')),
    patterns: (Array.isArray(ctx.config.patterns) ? ctx.config.patterns : listOf(ctx.config.patterns)).map((p: any) => str(typeof p === 'object' ? p?.pattern : p)).filter(Boolean),
    replacement: (['block', 'label', 'text'].includes(opt(ctx, 'replacement')) ? opt(ctx, 'replacement') : 'block') as 'block' | 'label' | 'text',
    replacementText: opt(ctx, 'replacement_text') || undefined,
  }
  if (!presets.length && !options.terms!.length && !options.patterns!.length) throw new Error('Choose what to redact (a preset, terms or a pattern)')
  const type = detectType(file.bytes, file.name)
  const output = opt(ctx, 'output') || 'same'
  const base = opt(ctx, 'output_name') || `${baseName(file.source === 'text' ? 'text' : file.name)}-redacted`
  let counts: Record<string, number> = {}
  let total = 0
  let outFile: DocumentFileObject | null = null
  let text = ''
  const { readDocumentFull } = await import('./read')
  if (output === 'same' && (type.format === 'docx' || type.format === 'pptx' || type.format === 'xlsx')) {
    const r = await rd.redactOoxml(file.bytes, type.format, { ...options, clearAuthor: bool(ctx.config.clear_author, true) })
    counts = r.counts
    total = r.total
    outFile = await save(ctx, r.bytes, outputFileName(base, 'redacted', type.format), MIME[type.format])
    text = (await readDocumentFull(r.bytes, `x.${type.format}`, null, {})).fullText
  } else if (output === 'same' && type.is_text && !['html'].includes(type.format)) {
    const r = rd.redactText(new TextDecoder().decode(file.bytes), options)
    counts = r.counts
    total = r.total
    text = r.text
    const ext = type.format === 'markdown' ? 'md' : type.format === 'text' ? 'txt' : type.extension
    outFile = await save(ctx, new TextEncoder().encode(r.text), outputFileName(base, 'redacted', ext), type.mime_type)
  } else {
    // PDF, HTML and other formats: rebuilt from the redacted text.
    const { result, blocks } = await readDocumentFull(file.bytes, file.name, file.mime_type, readOptions(ctx))
    const redactBlocks = blocks.map((b) => {
      if ('inlines' in b) {
        const r = rd.redactText(b.inlines.map((i) => i.text).join(''), options)
        for (const [k, v] of Object.entries(r.counts)) counts[k] = (counts[k] ?? 0) + v
        total += r.total
        return { ...b, inlines: [{ text: r.text }] }
      }
      if (b.type === 'table') return { ...b, rows: b.rows.map((row) => row.map((c) => { const r = rd.redactText(c, options); for (const [k, v] of Object.entries(r.counts)) counts[k] = (counts[k] ?? 0) + v; total += r.total; return r.text })) }
      if (b.type === 'code') { const r = rd.redactText(b.text, options); for (const [k, v] of Object.entries(r.counts)) counts[k] = (counts[k] ?? 0) + v; total += r.total; return { ...b, text: r.text } }
      return b
    })
    const { blocksToText, blocksToHtml } = await import('./model')
    text = blocksToText(redactBlocks)
    const target = output === 'text' ? 'text' : output === 'html' || type.format === 'html' ? 'html' : 'pdf'
    if (target === 'pdf') {
      const { renderPdf } = await import('./pdf-tools')
      const r = await renderPdf(redactBlocks, { title: result.metadata.title ?? undefined })
      outFile = await save(ctx, r.bytes, outputFileName(base, 'redacted', 'pdf'), MIME.pdf)
      if (type.format === 'pdf') ctx.warn('The redacted PDF is rebuilt from the text: the original layout and images are not kept, and no redacted text remains in it')
    } else if (target === 'html') {
      const { htmlDocument } = await import('./diff')
      const { sanitizeHtml } = await import('@/lib/html-sanitize')
      outFile = await save(ctx, new TextEncoder().encode(htmlDocument(base, sanitizeHtml(blocksToHtml(redactBlocks)))), outputFileName(base, 'redacted', 'html'), MIME.html)
    } else {
      outFile = await save(ctx, new TextEncoder().encode(text), outputFileName(base, 'redacted', 'txt'), MIME.txt)
    }
  }
  const ov = outputVar(ctx, 'redacted')
  ctx.variables[ov] = { file: outFile, text, counts, total }
  ctx.variables[`${ov}_file`] = outFile
  ctx.variables[`${ov}_text`] = text
  ctx.variables[`${ov}_count`] = total
  return { variable: ov, file: outFile?.name, redactions: total, counts }
}

/* ── Inspect ────────────────────────────────────────────────────────── */

async function inspectNode(ctx: DocumentNodeContext) {
  const file = await input(ctx, 'source', 'Document', true)
  const { detectType } = await import('./detect')
  const op = opt(ctx, 'operation') || 'all'
  const ov = outputVar(ctx, 'inspection')
  const type = detectType(file.bytes, file.name)
  const out: Record<string, any> = { file: { name: file.name, size: file.size, mime_type: file.mime_type }, type }
  if (op === 'all' || op === 'checksum') {
    const algos = listOf(ctx.config.algorithms).filter((a) => ['sha256', 'sha1', 'md5', 'sha512'].includes(a))
    out.checksums = Object.fromEntries((algos.length ? algos : ['sha256']).map((a) => [a, createHash(a).update(file.bytes).digest('hex')]))
  }
  if (op === 'all' || op === 'stats' || op === 'search') {
    const { readDocument } = await import('./read')
    let doc: import('./read').ReadResult | null = null
    try {
      doc = await withTimeout(readDocument(file.bytes, file.name, file.mime_type, { ...readOptions(ctx), includeTables: false }), DOCUMENT_LIMITS.timeoutMs, 'Reading the document')
    } catch (e) {
      if (op !== 'all') throw e
      ctx.warn(`${file.name}: ${(e as Error).message}`)
    }
    if (doc) {
      const m = doc.metadata
      out.stats = { words: m.words, characters: m.characters, characters_no_spaces: m.characters_no_spaces, lines: m.lines, paragraphs: m.paragraphs, sentences: m.sentences, reading_time_minutes: m.reading_time_minutes, pages: m.pages, slides: m.slides, sheets: m.sheets }
      out.metadata = m
      if (op === 'search' || (op === 'all' && opt(ctx, 'query'))) {
        const { searchText } = await import('./extract')
        const pages = (doc.structure.pages as Array<{ text: string }> | undefined)
        let pageStarts: number[] | undefined
        if (pages?.length) { pageStarts = []; let at = 0; for (const p of pages) { pageStarts.push(at); at += p.text.length + 2 } }
        const r = searchText(doc.text, opt(ctx, 'query'), { regex: bool(ctx.config.regex), caseSensitive: bool(ctx.config.case_sensitive), wholeWord: bool(ctx.config.whole_word), context: num(resolved(ctx, 'context_chars'), 60), pageStarts })
        out.search = { query: opt(ctx, 'query'), count: r.count, matches: r.matches, truncated: r.truncated }
        ctx.variables[`${ov}_matches`] = r.matches
        ctx.variables[`${ov}_match_count`] = r.count
      }
    }
  }
  ctx.variables[ov] = out
  return {
    variable: ov,
    format: type.format,
    mime_type: type.mime_type,
    ...(type.extension_mismatch ? { extension_mismatch: true } : {}),
    ...(out.checksums ? { sha256: out.checksums.sha256 } : {}),
    ...(out.stats ? { words: out.stats.words, reading_time_minutes: out.stats.reading_time_minutes } : {}),
    ...(out.search ? { matches: out.search.count } : {}),
  }
}

/* ── Dispatch ───────────────────────────────────────────────────────── */

export const DOCUMENT_NODE_TYPES = ['doc_read', 'doc_compare', 'doc_convert', 'doc_pdf', 'doc_extract', 'doc_redact', 'doc_inspect'] as const
export type DocumentNodeType = (typeof DOCUMENT_NODE_TYPES)[number]

export function isDocumentNodeType(type: string): type is DocumentNodeType {
  return (DOCUMENT_NODE_TYPES as readonly string[]).includes(type)
}

export async function runDocumentNode(ctx: DocumentNodeContext): Promise<Record<string, unknown>> {
  switch (ctx.type) {
    case 'doc_read': return readNode(ctx)
    case 'doc_compare': return compareNode(ctx)
    case 'doc_convert': return convertNode(ctx)
    case 'doc_pdf': return pdfNode(ctx)
    case 'doc_extract': return extractNode(ctx)
    case 'doc_redact': return redactNode(ctx)
    case 'doc_inspect': return inspectNode(ctx)
  }
  throw new Error(`Unknown document action ${ctx.type}`)
}
