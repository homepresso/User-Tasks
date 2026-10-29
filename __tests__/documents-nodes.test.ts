import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The document-action node handlers end to end (lib/documents/handlers):
 * inputs resolved from file objects / storage references / base64 / text for
 * the run's tenant, outputs stored as file objects, variables set for later
 * steps, and Extract writing rows into a data table.
 */

const TENANT = '0fa00000-0000-4000-8000-00000000000a'
const OTHER = '0fa00000-0000-4000-8000-00000000000b'
const TABLE = '0fa00000-0000-4000-8000-0000000000e1'

const store = vi.hoisted(() => new Map<string, { bytes: Uint8Array; type: string }>())
vi.mock('@/lib/storage/files', () => ({
  TASK_FILES_BUCKET: 'task-files',
  storeWorkflowFile: async (_c: unknown, tenantId: string, body: Uint8Array, ext: string, contentType: string) => {
    const path = `workflow-files/${tenantId}/${crypto.randomUUID()}.${ext}`
    store.set(path, { bytes: new Uint8Array(body), type: contentType })
    return { url: `https://files.example.com/${path}`, path, ref: `storage://task-files/${path}` }
  },
  fetchFile: async (url: string) => {
    const key = url.replace(/^storage:\/\/task-files\//, '')
    const hit = store.get(decodeURIComponent(key))
    return hit ? new Response(hit.bytes as unknown as BodyInit, { headers: { 'content-type': hit.type } }) : new Response('nope', { status: 404 })
  },
}))
const enqueued = vi.hoisted(() => [] as unknown[])
vi.mock('@/lib/data-table-workflow-triggers', () => ({ enqueueDataTableEvents: async (p: unknown) => { enqueued.push(p); return 1 } }))

import { runDocumentNode, type DocumentNodeContext } from '@/lib/documents/handlers'
import { resolveExpression } from '@/lib/expression-resolver'
import { readDocument } from '@/lib/documents/read'
import { createMemorySupabase } from './fixtures/supabase-memory'
import { invoicePdf, ordersXlsx, richDocx } from './helpers/document-fixtures'

/* eslint-disable @typescript-eslint/no-explicit-any -- loose test shapes */

function put(tenant: string, name: string, bytes: Uint8Array, type = 'application/octet-stream') {
  const path = `workflow-files/${tenant}/${name}`
  store.set(path, { bytes, type })
  return { id: name, name, size: bytes.byteLength, mime_type: type, url: `https://files.example.com/${path}`, storage_ref: `storage://task-files/${path}`, uploaded_by: null, uploaded_at: '2026-10-28T00:00:00Z', checksum_sha256: '' }
}

function run(type: string, config: Record<string, any>, variables: Record<string, any> = {}, supabase: any = createMemorySupabase()) {
  const ctx = { variables: { ...variables } }
  const warnings: string[] = []
  const node: DocumentNodeContext = {
    type, config, supabase, tenantId: TENANT, variables: ctx.variables,
    resolve: (e) => resolveExpression(e, ctx as any),
    setVar: (name, value) => { ctx.variables[name] = value },
    warn: (m) => warnings.push(m),
  }
  return runDocumentNode(node).then((output) => ({ output, vars: ctx.variables, warnings }))
}

const bytesOf = (file: any) => store.get(file.path)!.bytes

beforeEach(() => { store.clear(); enqueued.length = 0 })

describe('Read document node', () => {
  it('reads an uploaded attachment (list → first file) and sets text / rows / metadata', async () => {
    const xlsx = put(TENANT, 'orders.xlsx', await ordersXlsx())
    const { output, vars } = await run('doc_read', { source: '{{form.files}}', sheet: 'Orders', output_var: 'orders' }, { form: { files: [xlsx] } })
    expect(output).toMatchObject({ variable: 'orders', file: 'orders.xlsx', format: 'xlsx', rows: 3, sheets: 2 })
    expect(vars.orders_rows[2]).toMatchObject({ OrderID: 10250, Customer: 'HANAR' })
    expect(vars.orders_count).toBe(3)
    expect(vars.orders.metadata.format_label).toBe('Excel workbook')
    expect(output).not.toHaveProperty('text')
  })

  it('accepts base64 content and plain text', async () => {
    const b64 = Buffer.from('# Hi\n\nThere').toString('base64')
    const { vars } = await run('doc_read', { source: '{{doc}}' }, { doc: { base64: b64, name: 'n.md' } })
    expect(vars.document.structure.headings).toEqual([{ level: 1, text: 'Hi' }])
    const t = await run('doc_read', { source: 'Plain words here' })
    expect(t.vars.document.metadata.words).toBe(3)
  })

  it('never reads another tenant\'s workflow file', async () => {
    const other = put(OTHER, 'secret.pdf', await invoicePdf())
    await expect(run('doc_read', { source: other.storage_ref })).rejects.toThrow(/file not found/)
    await expect(run('doc_read', { source: '{{f}}' }, { f: other })).rejects.toThrow(/file not found/)
  })
})

describe('Compare node', () => {
  it('two DOCX versions → stats, HTML report file and a redline DOCX', async () => {
    const v1 = put(TENANT, 'v1.docx', richDocx())
    const { writeDocx, readDocx } = await import('@/lib/documents/docx')
    const blocks = readDocx(richDocx()).blocks.map((b: any) => ('inlines' in b ? { ...b, inlines: b.inlines.map((i: any) => ({ ...i, text: i.text === '24' ? '36' : i.text })) } : b))
    const v2 = put(TENANT, 'v2.docx', await writeDocx(blocks))
    const { output, vars } = await run('doc_compare', { original: '{{a}}', revised: '{{b}}', redline: 'docx', report: 'html' }, { a: v1, b: v2 })
    expect(output).toMatchObject({ mode: 'words', identical: false, files: { redline_docx: 'v2-comparison-redline.docx', report: 'v2-comparison.html' } })
    expect(vars.comparison.changes).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'changed', old_text: '24', new_text: '36' })]))
    expect(vars.comparison_similarity).toBeGreaterThan(90)
    expect(vars.comparison_redline_docx).toMatchObject({ _file: true, name: 'v2-comparison-redline.docx', mime_type: expect.stringContaining('wordprocessingml'), storage_ref: expect.stringMatching(/^storage:\/\/task-files\/workflow-files\//) })
    expect(vars.comparison_redline_docx.checksum_sha256).toMatch(/^[0-9a-f]{64}$/)
    const redline = await readDocument(bytesOf(vars.comparison_redline_docx), 'r.docx', null, { trackedChanges: 'show' })
    expect(redline.text).toContain('2436 months')
    const report = new TextDecoder().decode(bytesOf(vars.comparison_report))
    expect(report).toMatch(/^<!doctype html>/)
    expect(report).not.toMatch(/<script/i)
  })

  it('sheet mode from two row lists (no files), and JSON mode from objects', async () => {
    const { output } = await run('doc_compare', { original: '{{a}}', revised: '{{b}}', key_columns: 'id' }, { a: [{ id: 1, v: 'x' }, { id: 2, v: 'y' }], b: [{ id: 2, v: 'z' }, { id: 3, v: 'w' }] })
    expect(output).toMatchObject({ mode: 'sheet', stats: { added: 1, removed: 1, changed: 1 } })
    const j = await run('doc_compare', { original: '{{a}}', revised: '{{b}}' }, { a: { x: 1 }, b: { x: 2 } })
    expect(j.vars.comparison.changes).toEqual([{ type: 'changed', path: 'x', old: 1, new: 2 }])
    const t = await run('doc_compare', { original: 'one two', revised: 'one three', mode: 'words' })
    expect(t.output).toMatchObject({ mode: 'words', changes: 1 })
  })
})

describe('Convert, PDF, Extract, Redact, Inspect nodes', () => {
  it('converts DOCX → PDF and stamps it', async () => {
    const doc = put(TENANT, 'agreement.docx', richDocx())
    const c = await run('doc_convert', { source: '{{d}}', target: 'pdf', output_name: 'Agreement {{n}}' }, { d: doc, n: 7 })
    expect(c.vars.converted_file).toMatchObject({ name: 'Agreement 7.pdf', mime_type: 'application/pdf' })
    expect(c.vars.file_url).toBe(c.vars.converted_file.url)
    const s = await run('doc_pdf', { operation: 'watermark', source: '{{converted_file}}', text: 'DRAFT' }, c.vars)
    expect(s.output).toMatchObject({ operation: 'watermark', file: 'Agreement 7-stamped.pdf', pages_stamped: 1 })
    expect((await readDocument(bytesOf(s.vars.pdf_file), 'x.pdf', null)).text).toContain('DRAFT')
  })

  it('merges a list of PDFs, splits, reads and fills a form', async () => {
    const a = put(TENANT, 'a.pdf', await invoicePdf())
    const b = put(TENANT, 'b.pdf', await invoicePdf())
    const m = await run('doc_pdf', { operation: 'merge', sources: '{{files}}' }, { files: [a, b] })
    expect(m.output).toMatchObject({ pages: 4, files: 2, file: 'merged.pdf' })
    const sp = await run('doc_pdf', { operation: 'split', source: '{{pdf_file}}', every_n: 2, output_var: 'parts' }, m.vars)
    expect(sp.vars.parts).toHaveLength(2)
    expect(sp.vars.parts_count).toBe(2)
    const f = await run('doc_pdf', { operation: 'fill_form', source: '{{a}}', fields: [{ name: 'approver', value: '{{who}}' }, { name: 'approved', value: 'true' }] }, { a, who: 'Laura Callahan' })
    const r = await run('doc_pdf', { operation: 'read_form', source: '{{pdf_file}}' }, f.vars)
    expect(r.vars.form_values).toEqual({ approver: 'Laura Callahan', approved: true })
    await expect(run('doc_pdf', { operation: 'page_count', source: '{{d}}' }, { d: put(TENANT, 'x.docx', richDocx()) })).rejects.toThrow(/not a PDF/)
  })

  it('extracts tables, key values and amounts from a PDF, and writes rows into a data table', async () => {
    const pdf = put(TENANT, 'invoice.pdf', await invoicePdf())
    const db = createMemorySupabase({
      custom_tables: [{ id: TABLE, tenant_id: TENANT, name: 'Invoice lines', slug: 'invoice_lines', columns: [{ key: 'product', label: 'Product', type: 'text' }, { key: 'quantity', label: 'Qty', type: 'number' }, { key: 'amount', label: 'Amount', type: 'text' }] }],
      custom_table_rows: [],
    })
    const { output, vars } = await run('doc_extract', {
      source: '{{pdf}}',
      patterns: [{ name: 'invoice_number', pattern: 'Invoice\\s+(INV-[\\d-]+)' }],
      finders: ['emails', 'dates', 'amounts'],
      to_table: true, table_id: TABLE,
    }, { pdf }, db)
    expect(output).toMatchObject({ tables: 1, rows: 2, inserted: 2, table_columns: ['product', 'quantity', 'amount'] })
    expect(vars.extracted.values).toEqual({ invoice_number: 'INV-2026-0042' })
    expect(vars.extracted_invoice_number).toBe('INV-2026-0042')
    expect(vars.extracted.found.emails).toEqual(['accounts@exotic.example'])
    expect(vars.extracted.found.dates).toEqual([{ text: '15 October 2026', date: '2026-10-15' }, { text: '2026-11-14', date: '2026-11-14' }])
    expect(vars.extracted.found.amounts).toEqual(expect.arrayContaining([{ text: 'NZ$275.00', value: 275, currency: 'NZD' }, { text: '$180.00', value: 180, currency: 'USD' }]))
    expect(db.tables.custom_table_rows.map((r: any) => r.data)).toEqual([{ product: 'Chai', quantity: '10', amount: '$180.00' }, { product: 'Chang', quantity: '5', amount: '$95.00' }])
    expect(db.tables.custom_table_rows.every((r: any) => r.tenant_id === TENANT && r.table_id === TABLE)).toBe(true)
    expect(enqueued).toHaveLength(1)
  })

  it('refuses another tenant\'s data table', async () => {
    const db = createMemorySupabase({ custom_tables: [{ id: TABLE, tenant_id: OTHER, name: 'T', columns: [{ key: 'a' }] }], custom_table_rows: [] })
    await expect(run('doc_extract', { source: 'a\n1', to_table: true, table_id: TABLE }, {}, db)).rejects.toThrow(/Data table not found/)
  })

  it('redacts a DOCX in place and text inputs', async () => {
    const doc = put(TENANT, 'agreement.docx', richDocx())
    const { output, vars } = await run('doc_redact', { source: '{{d}}', presets: ['email', 'phone'], terms: 'Exotic Liquids' }, { d: doc })
    expect(output).toMatchObject({ file: 'agreement-redacted.docx', redactions: 3, counts: { email: 1, phone: 1, term: 1 } })
    const r = await readDocument(bytesOf(vars.redacted_file), 'r.docx', null)
    expect(r.text).not.toMatch(/orders@northwind|555 0100|Exotic Liquids/)
    expect(r.text).toContain('Northwind Traders') // formatting and other text kept
    expect(r.markdown).toContain('**Northwind Traders**')
    expect(r.metadata.author).toBeNull()
    const t = await run('doc_redact', { source: 'Card 4111 1111 1111 1111, IBAN GB82 WEST 1234 5698 7654 32', presets: ['credit_card', 'iban'], replacement: 'label' })
    expect(t.vars.redacted_text).toBe('Card [CREDIT_CARD], IBAN [IBAN]')
  })

  it('inspects: type from content, checksum, counts, search with context', async () => {
    const doc = put(TENANT, 'renamed.pdf', richDocx())
    const { output, vars } = await run('doc_inspect', { source: '{{d}}', operation: 'all', query: 'term', whole_word: true, case_sensitive: true }, { d: doc })
    expect(output).toMatchObject({ format: 'docx', extension_mismatch: true, matches: 1 })
    expect(vars.inspection.checksums.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(vars.inspection_matches[0]).toMatchObject({ text: 'term', line: 4 })
    expect(vars.inspection_matches[0].context).toContain('The term is 24 months')
  })
})
