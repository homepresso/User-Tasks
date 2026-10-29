/**
 * Native document generation handlers for the workflow engine.
 * Word (.docx) and PowerPoint (.pptx) via docxtemplater + pizzip.
 * Excel (.xlsx) via the xlsx package (already installed).
 * All MIT licensed — free for commercial use.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchFile, fileSource, storeWorkflowFile } from './storage/files'

const TIMEOUT = 60_000
const MAX_SIZE = 25 * 1024 * 1024

// ─── Shared ───

async function fetchTemplate(url: string, tenantId: string): Promise<Buffer> {
  // Form attachments are read for this run's tenant only.
  const resp = await fetchFile(String(url), { signal: AbortSignal.timeout(TIMEOUT) }, { tenantId })
  if (!resp.ok) throw new Error(`Template fetch failed: HTTP ${resp.status}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  if (buf.byteLength > MAX_SIZE) throw new Error(`Template too large (${Math.round(buf.byteLength / 1024 / 1024)}MB max ${MAX_SIZE / 1024 / 1024}MB)`)
  return buf
}

async function upload(supabase: SupabaseClient, tenantId: string, buf: Buffer, ext: string, mime: string) {
  try {
    return await storeWorkflowFile(supabase, tenantId, buf, ext, mime)
  } catch (e) {
    throw new Error(`Upload failed: ${(e as Error).message}`)
  }
}

/** A URL, a file object (an uploaded attachment, a generated file) or a list of them (the first). */
function resolveUrl(raw: any): string | null {
  if (!raw || (Array.isArray(raw) && !raw.length)) return null
  return fileSource(raw) || null
}

// Resolve template URL — handles direct URL, file ref, or data table query
async function resolveTemplateUrl(
  config: Record<string, any>, resolve: (expr: any) => any, supabase: SupabaseClient
): Promise<string | null> {
  if (config.source_mode === 'table' && config.table_id && config.table_row_id) {
    // Query data table row by ID and extract file column
    const rowId = String(resolve(config.table_row_id) ?? '')
    if (!rowId) return null
    const { data: row } = await supabase.from('custom_table_rows').select('data').eq('id', rowId).single()
    if (!row?.data) return null
    const col = config.table_file_column ?? ''
    const fileData = (row.data as any)[col]
    if (!fileData) return null
    return typeof fileData === 'object' && fileData.url ? fileData.url : String(fileData)
  }
  return resolveUrl(resolve(config.template_url))
}

type Resolve = (expr: any) => any
type SetVar = (name: string, value: any) => void
type Log = (message: string) => void

// ─── Find & replace ───

/** At most this many find/replace pairs per node (rules + json_body keys). */
export const MAX_REPLACEMENTS = 1000
/** A replaced document part may grow to at most this many characters. */
export const MAX_REPLACED_LENGTH = 4 * MAX_SIZE

export interface Replacement { find: string; replace: string }

/**
 * The node's find/replace pairs. `find` is a LITERAL placeholder — a template
 * holding {{Name}} is matched as written, never resolved as an expression
 * (which turned an unknown {{Name}} into '' and exploded the document); only
 * `replace` is resolved. Empty or whitespace-only finds are skipped (and
 * counted); json_body keys add pairs. Capped at MAX_REPLACEMENTS.
 */
export function collectReplacements(config: Record<string, any>, resolve: Resolve, log?: Log): { replacements: Replacement[]; skipped: number } {
  const replacements: Replacement[] = []
  let skipped = 0
  const add = (find: unknown, replace: unknown) => {
    const literal = find == null ? '' : String(find)
    if (!literal.trim()) { skipped++; return }
    replacements.push({ find: literal, replace: replace == null ? '' : String(replace) })
  }
  for (const r of (config.replacements ?? []) as { find?: string; replace?: string }[]) {
    // A fully blank row (as the editor adds them) is not counted.
    if (!r || ((r.find == null || r.find === '') && (r.replace == null || r.replace === ''))) continue
    add(r.find, resolve(r.replace))
  }
  // json_body: keys are find placeholders, values the replacements.
  if (config.json_body) {
    let jsonObj = resolve(config.json_body)
    if (typeof jsonObj === 'string') { try { jsonObj = JSON.parse(jsonObj) } catch { jsonObj = null } }
    if (jsonObj && typeof jsonObj === 'object' && !Array.isArray(jsonObj)) {
      for (const [key, val] of Object.entries(jsonObj)) add(key, val)
    }
  }
  if (skipped > 0) log?.(`Skipped ${skipped} replacement${skipped === 1 ? '' : 's'} with an empty "find"`)
  if (replacements.length > MAX_REPLACEMENTS) {
    log?.(`Only the first ${MAX_REPLACEMENTS} of ${replacements.length} replacements were applied`)
    replacements.length = MAX_REPLACEMENTS
  }
  return { replacements, skipped }
}

/** Apply every pair (global, literal) to `text`; throws when the result grows past MAX_REPLACED_LENGTH. */
export function applyReplacements(text: string, replacements: Replacement[]): string {
  let out = text
  for (const r of replacements) {
    if (!r.find || !out.includes(r.find)) continue
    const parts = out.split(r.find)
    const nextLength = out.length + (parts.length - 1) * (r.replace.length - r.find.length)
    if (nextLength > MAX_REPLACED_LENGTH) {
      throw new Error(`Find & replace result is too large (replacing "${r.find.slice(0, 40)}" would produce ${Math.round(nextLength / 1024 / 1024)}MB, max ${Math.round(MAX_REPLACED_LENGTH / 1024 / 1024)}MB)`)
    }
    out = parts.join(r.replace)
  }
  return out
}

function makeFileRef(name: string, url: string, path: string, size: number, mime: string, storageRef?: string) {
  return { _file: true, name, url, path, size, content_type: mime, ...(storageRef ? { ref: storageRef } : {}) }
}

// ─── Word (.docx) ───

const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export async function handleDocWord(
  config: Record<string, any>, resolve: Resolve,
  supabase: SupabaseClient, tenantId: string, setVar: SetVar, log?: Log,
): Promise<any> {
  const url = await resolveTemplateUrl(config, resolve, supabase)
  if (!url) return { skipped: true, reason: 'No template' }

  const mode = config.mode ?? 'find_replace'
  const outVar = config.output_var || 'doc_file'
  const outName = String(resolve(config.output_filename) || 'document.docx')

  const tpl = await fetchTemplate(url, tenantId)
  const PizZip = (await import('pizzip')).default
  const Docxtemplater = (await import('docxtemplater')).default

  const zip = new PizZip(tpl)

  let out: Buffer
  let skippedReplacements = 0

  if (mode === 'find_replace') {
    // Raw XML string replacement — works with ANY placeholder format ([TITLE], {{Name}}, %placeholder%, etc.)
    const { replacements, skipped } = collectReplacements(config, resolve, log)
    skippedReplacements = skipped
    // Replace in all XML parts of the docx
    for (const relativePath of Object.keys(zip.files)) {
      if (relativePath.endsWith('.xml') || relativePath.endsWith('.xml.rels')) {
        const file = zip.files[relativePath]
        if (file.dir) continue
        zip.file(relativePath, applyReplacements(file.asText(), replacements))
      }
    }
    out = zip.generate({ type: 'nodebuffer', mimeType: WORD_MIME })
  } else {
    // Use docxtemplater for structured operations (tables, lists, images)
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true, linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
    })
    const data: Record<string, any> = {}

    if (mode === 'create_table') {
      for (const t of (config.tables ?? []) as { placeholder: string; data_var: string }[]) {
        if (!t.placeholder) continue
        const key = String(resolve(t.placeholder) ?? '').replace(/^\{\{|\}\}$/g, '')
        data[key] = resolve(t.data_var) ?? []
      }
    } else if (mode === 'update_list') {
      for (const l of (config.lists ?? []) as { placeholder: string; items_var: string; delimiter?: string }[]) {
        if (!l.placeholder) continue
        const key = String(resolve(l.placeholder) ?? '').replace(/^\{\{|\}\}$/g, '')
        let items = resolve(l.items_var)
        if (typeof items === 'string') {
          const d = l.delimiter === 'comma' ? ',' : l.delimiter === 'semicolon' ? ';' : '\n'
          items = items.split(d).map((s: string) => s.trim()).filter(Boolean)
        }
        data[key] = Array.isArray(items) ? items.join('\n') : ''
      }
    } else if (mode === 'insert_image') {
      for (const img of (config.images ?? []) as { placeholder: string; image_url: string }[]) {
        if (!img.placeholder) continue
        const key = String(resolve(img.placeholder) ?? '').replace(/^\{\{|\}\}$/g, '')
        data[key] = `[Image: ${resolve(img.image_url) ?? ''}]`
      }
    }

    doc.setData(data)
    doc.render()
    out = doc.getZip().generate({ type: 'nodebuffer', mimeType: WORD_MIME })
  }
  const { url: fileUrl, path, ref: storageRef } = await upload(supabase, tenantId, out, 'docx', WORD_MIME)
  const ref = makeFileRef(outName, fileUrl, path, out.byteLength, WORD_MIME, storageRef)

  setVar('file', ref)
  setVar('file_url', fileUrl)

  return { mode, variable: outVar, fileName: outName, size: out.byteLength, fileRef: ref, ...(skippedReplacements ? { skipped_replacements: skippedReplacements } : {}) }
}

// ─── Excel (.xlsx) ───

const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function handleDocExcel(
  config: Record<string, any>, resolve: Resolve,
  supabase: SupabaseClient, tenantId: string, setVar: SetVar, log?: Log,
): Promise<any> {
  const url = await resolveTemplateUrl(config, resolve, supabase)
  if (!url) return { skipped: true, reason: 'No template' }

  const mode = config.mode ?? 'find_replace'
  const outVar = config.output_var || 'doc_file'
  const outName = String(resolve(config.output_filename) || 'spreadsheet.xlsx')

  const tpl = await fetchTemplate(url, tenantId)
  const xl = await import('./excel')
  const wb = await xl.loadWorkbook(tpl)
  let skippedReplacements = 0

  if (mode === 'update_cell_text' || mode === 'update_cell_value') {
    for (const c of (config.cells ?? []) as { cell: string; text?: string; value?: string; sheet?: string }[]) {
      if (!c.cell || !xl.isCellRef(c.cell)) continue
      const ws = xl.getSheet(wb, c.sheet ? String(resolve(c.sheet)) : null)
      if (!ws) continue
      const val = resolve(mode === 'update_cell_value' ? c.value : c.text)
      ws.getCell(c.cell.replace(/\$/g, '').toUpperCase()).value = mode === 'update_cell_value'
        ? Number(val) || 0
        : String(val ?? '')
    }
  } else if (mode === 'find_replace') {
    const { replacements, skipped } = collectReplacements(config, resolve, log)
    skippedReplacements = skipped
    const target = config.sheet ? String(resolve(config.sheet)) : null
    const sheets = target ? [xl.getSheet(wb, target)] : wb.worksheets
    for (const ws of sheets) {
      if (!ws) continue
      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          // Text cells only (plain or rich text); numbers, dates and formulas are left alone.
          const raw = cell.value
          const isText = typeof raw === 'string'
            || (raw !== null && typeof raw === 'object' && 'richText' in raw)
          if (!isText) return
          const before = String(xl.plainValue(raw) ?? '')
          const v = applyReplacements(before, replacements)
          if (v !== before) cell.value = v
        })
      })
    }
  } else if (mode === 'insert_data') {
    const rows = resolve(config.data_var)
    if (Array.isArray(rows) && rows.length > 0) {
      const ws = xl.getSheet(wb, config.sheet ? String(resolve(config.sheet)) : null)
      if (ws) {
        const origin = config.placeholder ? String(resolve(config.placeholder)) : 'A1'
        xl.addObjects(ws, rows, { origin, skipHeader: config.include_headers === false })
      }
    }
  }

  const out = await xl.workbookToBuffer(wb)
  const { url: fileUrl, path, ref: storageRef } = await upload(supabase, tenantId, out, 'xlsx', EXCEL_MIME)
  const ref = makeFileRef(outName, fileUrl, path, out.byteLength, EXCEL_MIME, storageRef)

  setVar('file', ref)
  setVar('file_url', fileUrl)

  return { mode, variable: outVar, fileName: outName, size: out.byteLength, fileRef: ref, ...(skippedReplacements ? { skipped_replacements: skippedReplacements } : {}) }
}

// ─── PowerPoint (.pptx) ───

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

export async function handleDocPowerpoint(
  config: Record<string, any>, resolve: Resolve,
  supabase: SupabaseClient, tenantId: string, setVar: SetVar, log?: Log,
): Promise<any> {
  const url = await resolveTemplateUrl(config, resolve, supabase)
  if (!url) return { skipped: true, reason: 'No template' }

  const mode = config.mode ?? 'find_replace'
  const outVar = config.output_var || 'doc_file'
  const outName = String(resolve(config.output_filename) || 'presentation.pptx')

  const tpl = await fetchTemplate(url, tenantId)
  const PizZip = (await import('pizzip')).default
  const Docxtemplater = (await import('docxtemplater')).default

  const zip = new PizZip(tpl)

  let outPptx: Buffer
  let skippedReplacements = 0

  if (mode === 'find_replace') {
    // Raw XML string replacement — works with ANY placeholder format
    const { replacements, skipped } = collectReplacements(config, resolve, log)
    skippedReplacements = skipped
    for (const relativePath of Object.keys(zip.files)) {
      if (relativePath.endsWith('.xml') || relativePath.endsWith('.xml.rels')) {
        const file = zip.files[relativePath]
        if (file.dir) continue
        zip.file(relativePath, applyReplacements(file.asText(), replacements))
      }
    }
    outPptx = zip.generate({ type: 'nodebuffer', mimeType: PPTX_MIME })
  } else {
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true, linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
    })
    const data: Record<string, any> = {}

    if (mode === 'update_table') {
      for (const t of (config.tables ?? []) as { placeholder: string; data_var: string }[]) {
        if (!t.placeholder) continue
        const key = String(resolve(t.placeholder) ?? '').replace(/^\{\{|\}\}$/g, '')
        data[key] = resolve(t.data_var) ?? []
      }
    } else if (mode === 'update_list') {
      for (const l of (config.lists ?? []) as { placeholder: string; items_var: string; delimiter?: string }[]) {
        if (!l.placeholder) continue
        const key = String(resolve(l.placeholder) ?? '').replace(/^\{\{|\}\}$/g, '')
      let items = resolve(l.items_var)
      if (typeof items === 'string') {
        const d = l.delimiter === 'comma' ? ',' : l.delimiter === 'semicolon' ? ';' : '\n'
        items = items.split(d).map((s: string) => s.trim()).filter(Boolean)
      }
      data[key] = Array.isArray(items) ? items.join('\n') : ''
    }
  } else if (mode === 'insert_image') {
    for (const img of (config.images ?? []) as { placeholder: string; image_url: string }[]) {
      if (!img.placeholder) continue
      const key = String(resolve(img.placeholder) ?? '').replace(/^\{\{|\}\}$/g, '')
      data[key] = `[Image: ${resolve(img.image_url) ?? ''}]`
    }
  }

    doc.setData(data)
    doc.render()
    outPptx = doc.getZip().generate({ type: 'nodebuffer', mimeType: PPTX_MIME })
  }

  const { url: fileUrl, path, ref: storageRef } = await upload(supabase, tenantId, outPptx, 'pptx', PPTX_MIME)
  const ref = makeFileRef(outName, fileUrl, path, outPptx.byteLength, PPTX_MIME, storageRef)

  setVar('file', ref)
  setVar('file_url', fileUrl)

  return { mode, variable: outVar, fileName: outName, size: outPptx.byteLength, fileRef: ref, ...(skippedReplacements ? { skipped_replacements: skippedReplacements } : {}) }
}
