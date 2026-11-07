import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Redact Document with information types (lib/documents/handlers +
 * lib/documents/redact): detect-only findings with locations in Word,
 * Excel, PowerPoint, PDF and text; redaction styles (mask, label, partial,
 * hash); masked findings in the run output; AI names (mocked model).
 * All values are published test numbers or made up to pass a check digit.
 */

const TENANT = '0fa00000-0000-4000-8000-00000000000a'

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
const aiCalls = vi.hoisted(() => [] as string[])
vi.mock('@/lib/documents/pii/ai', async (orig) => ({
  ...(await orig<typeof import('@/lib/documents/pii/ai')>()),
  findWithAgent: async (_db: unknown, _tenant: string, agentId: string, text: string) => {
    aiCalls.push(agentId)
    return { values: [{ type: 'person_name', text: 'Jane Example' }, { type: 'person_name', text: 'Not In Text' }].filter((x) => text.includes(x.text)), truncated: false }
  },
}))

import ExcelJS from 'exceljs'
import { runDocumentNode, type DocumentNodeContext } from '@/lib/documents/handlers'
import { resolveExpression } from '@/lib/expression-resolver'
import { readDocument } from '@/lib/documents/read'
import { buildFindings, findHits, redactText } from '@/lib/documents/redact'
import { parseAiValues } from '@/lib/documents/pii/ai'
import { createMemorySupabase } from './fixtures/supabase-memory'
import { deckPptx, paragraphsDocx } from './helpers/document-fixtures'

/* eslint-disable @typescript-eslint/no-explicit-any -- loose test shapes */

function put(name: string, bytes: Uint8Array, type = 'application/octet-stream') {
  const path = `workflow-files/${TENANT}/${name}`
  store.set(path, { bytes, type })
  return { id: name, name, size: bytes.byteLength, mime_type: type, url: `https://files.example.com/${path}`, storage_ref: `storage://task-files/${path}`, uploaded_by: null, uploaded_at: '2026-10-28T00:00:00Z', checksum_sha256: '' }
}

function run(config: Record<string, any>, variables: Record<string, any> = {}) {
  const ctx = { variables: { ...variables } }
  const warnings: string[] = []
  const node: DocumentNodeContext = {
    type: 'doc_redact', config, supabase: createMemorySupabase() as any, tenantId: TENANT, variables: ctx.variables,
    resolve: (e) => resolveExpression(e, ctx as any),
    setVar: (name, value) => { ctx.variables[name] = value },
    warn: (m) => warnings.push(m),
  }
  return runDocumentNode(node).then((output) => ({ output, vars: ctx.variables, warnings }))
}

const bytesOf = (file: any) => store.get(file.path)!.bytes

const RAW = ['078-05-1120', '12/03/1985', '4111 1111 1111 1111', '49-091-850', '943 476 5919']

/** A Word file with fake identifiers; the card number is split over two runs. */
const intakeDocx = () => paragraphsDocx([
  'Patient intake form',
  'Name: Jane Example',
  'SSN: 078-05-1120',
  'Date of birth: 12/03/1985',
  ['Card on file: 4111 1111 ', '1111 1111'],
  'IRD number 49-091-850 and NHS number 943 476 5919',
  'Form received 01/10/2026.',
], 'Nancy Davolio')

const TYPES = ['us_ssn', 'date_of_birth', 'date', 'credit_card', 'nz_ird', 'uk_nhs']

beforeEach(() => { store.clear(); aiCalls.length = 0 })

describe('detect only', () => {
  it('reports findings with locations, masked, and changes nothing', async () => {
    const doc = put('intake.docx', intakeDocx())
    const { output, vars, warnings } = await run({ source: '{{d}}', mode: 'detect_only', info_types: TYPES }, { d: doc })
    expect(output).toMatchObject({ variable: 'detected', mode: 'detect_only', found: 6, counts: { us_ssn: 1, date_of_birth: 1, credit_card: 1, nz_ird: 1, uk_nhs: 1, date: 1 } })
    expect(output.file).toBeUndefined()
    const found = vars.detected.findings
    expect(found.map((f: any) => [f.type, f.paragraph, f.confidence])).toEqual([
      ['us_ssn', 3, 'high'], ['date_of_birth', 4, 'high'], ['credit_card', 5, 'high'], ['nz_ird', 6, 'high'], ['uk_nhs', 6, 'high'], ['date', 7, 'medium'],
    ])
    expect(found[0]).toMatchObject({ label: 'US Social Security number', category: 'identity', part: 'body', text: '•••-••-••••', start: 5, end: 16, context_snippet: 'SSN: [SSN]', source: 'pattern' })
    expect(found[3].context_snippet).toBe('IRD number [IRD_NUMBER] and NHS number [NHS_NUMBER]')
    expect(vars.detected.counts_by_type).toMatchObject({ us_ssn: 1 })
    expect(vars.detected_file).toBeNull()
    expect(vars.detected_findings).toHaveLength(6)
    // No raw value in the run output, the variables or the warnings.
    const visible = JSON.stringify({ output, vars, warnings })
    for (const raw of RAW) expect(visible).not.toContain(raw)
  })

  it('includes the values in the variable only when asked, never in the run output', async () => {
    const { output, vars } = await run({ source: 'SSN 078-05-1120', mode: 'detect_only', info_types: ['us_ssn'], include_values: true })
    expect(vars.detected_findings[0].text).toBe('078-05-1120')
    expect(vars.detected_findings[0].line).toBe(1)
    expect(JSON.stringify(output)).not.toContain('078-05-1120')
    expect((output as any).findings[0].text).toBe('•••-••-••••')
  })

  it('finds cells in Excel and slides in PowerPoint', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Staff')
    ws.addRow(['Name', 'Tax'])
    ws.addRow(['Jane Example', 'IRD 49-091-850'])
    wb.addWorksheet('Notes').addRow(['Contact jane@example.com'])
    const xlsx = put('staff.xlsx', new Uint8Array(await wb.xlsx.writeBuffer()))
    const x = await run({ source: '{{f}}', mode: 'detect_only', info_types: ['nz_ird', 'email'] }, { f: xlsx })
    expect(x.vars.detected_findings.map((f: any) => [f.type, f.sheet, f.cell])).toEqual([['nz_ird', 'Staff', 'B2'], ['email', 'Notes', 'A1']])

    const deck = put('deck.pptx', deckPptx([['Intro', ['Hello']], ['Contacts', ['NHI ZZZ0016', 'Call +64 21 555 0100']]]))
    const p = await run({ source: '{{f}}', mode: 'detect_only', info_types: ['nz_nhi', 'phone'] }, { f: deck })
    expect(p.vars.detected_findings.map((f: any) => [f.type, f.slide, f.part])).toEqual([['nz_nhi', 2, 'slide'], ['phone', 2, 'slide']])
  })

  it('finds pages in a PDF', async () => {
    const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib')
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    pdf.addPage([595, 842]).drawText('Cover page', { x: 50, y: 780, size: 12, font })
    pdf.addPage([595, 842]).drawText('Medicare 2123 45670 1', { x: 50, y: 780, size: 12, font })
    const f = put('claim.pdf', await pdf.save())
    const { vars } = await run({ source: '{{f}}', mode: 'detect_only', info_types: ['au_medicare'] }, { f })
    expect(vars.detected_findings).toHaveLength(1)
    expect(vars.detected_findings[0]).toMatchObject({ type: 'au_medicare', page: 2 })
  })
})

describe('redact with info types', () => {
  it('redacts a DOCX in place with labels, keeping plain dates when only DOB is chosen', async () => {
    const doc = put('intake.docx', intakeDocx())
    const { output, vars } = await run({ source: '{{d}}', info_types: ['us_ssn', 'date_of_birth', 'credit_card', 'nz_ird', 'uk_nhs'], replacement: 'label' }, { d: doc })
    expect(output).toMatchObject({ variable: 'redacted', mode: 'redact', file: 'intake-redacted.docx', redactions: 5 })
    const r = await readDocument(bytesOf(vars.redacted_file), 'r.docx', null)
    expect(r.text).toContain('SSN: [SSN]')
    expect(r.text).toContain('Date of birth: [DATE_OF_BIRTH]')
    expect(r.text).toContain('Card on file: [CREDIT_CARD]')
    expect(r.text).toContain('IRD number [IRD_NUMBER] and NHS number [NHS_NUMBER]')
    expect(r.text).toContain('Form received 01/10/2026.')
    for (const raw of RAW) expect(r.text).not.toContain(raw)
    expect(r.metadata.author).toBeNull()
    expect(vars.redacted.findings).toHaveLength(5)
    expect(vars.redacted_file).toMatchObject({ name: 'intake-redacted.docx', mime_type: expect.stringContaining('wordprocessingml') })
  })

  it('applies a style per type: mask, label, partial, hash', async () => {
    const text = 'SSN 078-05-1120; card 4111 1111 1111 1111; email jane@example.com; IRD 49-091-850'
    const { vars } = await run({ source: text, info_types: ['us_ssn', 'credit_card', 'email', 'nz_ird'], replacement: 'block', styles: { credit_card: 'partial', email: 'label', nz_ird: 'hash' } })
    expect(vars.redacted_text).toMatch(/^SSN ███████████; card ████ ████ ████ 1111; email \[EMAIL\]; IRD \[IRD_NUMBER:[0-9a-f]{10}\]$/)
    // Hash: the same value gets the same token, another value another one.
    const again = await run({ source: 'IRD 49-091-850 and 49091850 and 136-410-132', info_types: ['nz_ird'], replacement: 'hash', min_confidence: 'low' })
    const tokens = again.vars.redacted_text.match(/\[IRD_NUMBER:[0-9a-f]{10}\]/g)
    expect(tokens).toHaveLength(3)
    expect(tokens[0]).toBe(tokens[1])
    expect(tokens[2]).not.toBe(tokens[0])
  })

  it('uses the region filter and the quick selections', async () => {
    const text = 'SSN 078-05-1120, IRD 49-091-850, card 4111 1111 1111 1111'
    const nz = await run({ source: text, info_types: ['category:identity', 'category:financial'], regions: ['NZ'], replacement: 'label' })
    expect(nz.vars.redacted_text).toBe('SSN 078-05-1120, IRD [IRD_NUMBER], card [CREDIT_CARD]')
    const high = await run({ source: 'DOB 12/03/1985, seen 01/02/2026', info_types: ['@high'], min_confidence: 'high', replacement: 'label' })
    expect(high.vars.redacted_text).toBe('DOB [DATE_OF_BIRTH], seen 01/02/2026')
  })

  it('combines info types with the older presets, terms and patterns', async () => {
    const { output, vars } = await run({ source: 'Project Falcon: SSN 078-05-1120, ACC-123456, a@b.example', info_types: ['us_ssn'], presets: ['email'], terms: 'Project Falcon', patterns: [{ pattern: 'ACC-\\d{6}' }], replacement: 'label' })
    expect(vars.redacted_text).toBe('[TERM]: SSN [SSN], [PATTERN], [EMAIL]')
    expect(output.counts).toEqual({ term: 1, us_ssn: 1, pattern: 1, email: 1 })
  })

  it('redacts text from an upstream OCR read (a text input)', async () => {
    const ocrText = 'SCANNED FORM\nName Jane Example\nDOB 12.03.85\nNHS 943 476 5919'
    const { vars } = await run({ source: '{{doc.text}}', info_types: ['date_of_birth', 'uk_nhs'], replacement: 'label' }, { doc: { text: ocrText } })
    expect(vars.redacted_text).toBe('SCANNED FORM\nName Jane Example\nDOB [DATE_OF_BIRTH]\nNHS [NHS_NUMBER]')
    expect(vars.redacted_findings.map((f: any) => f.line)).toEqual([3, 4])
  })

  it('requires something to find, and an agent for AI detection', async () => {
    await expect(run({ source: 'x' })).rejects.toThrow(/Choose what to find/)
    await expect(run({ source: 'x', ai_detection: true })).rejects.toThrow(/choose the agent/i)
  })

  it('AI detection adds names the model found (only ones in the text)', async () => {
    const { vars, output } = await run({ source: 'Signed: Jane Example, SSN 078-05-1120', info_types: ['us_ssn'], ai_detection: true, ai_agent_id: 'agent-1', replacement: 'label' })
    expect(aiCalls).toEqual(['agent-1'])
    expect(vars.redacted_text).toBe('Signed: [NAME], SSN [SSN]')
    expect((output as any).findings[0]).toMatchObject({ type: 'person_name', source: 'ai', confidence: 'medium', text: '•••• •••••••' })
  })
})

describe('redact helpers', () => {
  it('parses the model reply and keeps only values that occur in the text', () => {
    const text = 'Jane Example lives at 12 Example Street.'
    expect(parseAiValues('```json\n{"names":["Jane Example","Ghost"],"addresses":["12 Example Street"]}\n```', text)).toEqual([
      { type: 'person_name', text: 'Jane Example' }, { type: 'postal_address', text: '12 Example Street' },
    ])
    expect(parseAiValues('no json here', text)).toEqual([])
  })

  it('builds snippets that mask other long numbers', () => {
    const text = 'Order 12345678 for SSN 078-05-1120 ok'
    const hits = findHits(text, { infoTypes: ['us_ssn'] })
    expect(buildFindings(hits, text, {})[0].context_snippet).toBe('Order ######## for SSN [SSN] ok')
  })

  it('partial keeps the last four characters, short values are fully masked', () => {
    expect(redactText('PIN password: ab12', { infoTypes: ['password'], replacement: 'partial' }).text).toBe('PIN password: ████')
    expect(redactText('SSN 078-05-1120', { infoTypes: ['us_ssn'], replacement: 'partial' }).text).toBe('SSN ███-██-1120')
  })
})
