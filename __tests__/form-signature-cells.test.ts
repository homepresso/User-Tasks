/**
 * Signatures that repeat: a `signature` column of a List (each row signs its
 * own cell) and a Signature control inside a repeating section's items
 * (lib/forms/signature-cells.ts). The schema keeps them; uploads go to the
 * column's upload key (`<list>.<column>`) through the same pipeline as a
 * Signature field (PNG only, 1 MB, sniffed, EXIF stripped); on submit every
 * row's / item's PNG is re-read from the upload records (another person's,
 * another field's, another workspace's or a forged file is refused at its
 * path) and the signer / time are stamped by the server; locked signature
 * cells keep their stored value; a task keeps signatures carried over from
 * an earlier task; the InfoPath importer maps signature lines / ink inside
 * repeating tables and sections; the read-only and editable renders.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createLocalStorageProvider } from '@/lib/providers/storage/local'
import type { StorageProvider } from '@/lib/providers/storage/types'
import { createMemorySupabase } from './fixtures/supabase-memory'
import type { ServiceContext } from '@/lib/services/context'
import { writeCab } from './helpers/cab-writer'
import { fixtureFiles } from './helpers/infopath-fixtures'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const TENANT = u(1)
const OTHER_TENANT = u(2)
const FORM = u(10)
const TASK = u(20)
const EARLIER_TASK = u(21)
const ADA = u(40)
const BOB = u(41)

let db: any
let provider: StorageProvider
const roots: string[] = []

vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => db }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: () => db }))
vi.mock('@/lib/providers/storage', async (orig) => ({ ...(await orig() as object), getStorageProvider: async () => provider }))
vi.mock('@/lib/reporting-lines', () => ({ loadReportingIndex: async () => ({}), isInManagerChain: () => false }))

const svc = await import('@/lib/services/form-files')
const { mergeTaskFieldValuesChecked } = await import('@/lib/forms/task-values')
const { mergeTaskFieldValues, normalizeTaskFields } = await import('@/lib/task-field-schema')
const { checkListValue, coerceListRows, formatListCell, listCellStates, listConfigProblem, listUploadKey, normalizeListConfig } = await import('@/lib/forms/list-field')
const { mapNestedSignatures, resolveFileControl } = await import('@/lib/forms/signature-cells')
const { anonymousReadiness } = await import('@/lib/forms/anonymous')
const { fieldSchema } = await import('@/lib/workflow-data-picker')
const { ListValueView, ColumnInput } = await import('@/components/forms/list-field')
const { SignatureCellValue } = await import('@/components/forms/signature-cell')

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 0, 0xff, 0xd9])
const cond = (column: string, operator: string, value?: unknown) => ({ match: 'all', conditions: [{ column, operator, ...(value === undefined ? {} : { value }) }] })

const APPROVALS = {
  key: 'approvals', label: 'Approvals', type: 'list',
  list: {
    entry_mode: 'inline', key_column: 'approver',
    columns: [
      { key: 'approver', label: 'Approver', type: 'text', required: true },
      { key: 'signature', label: 'Signature', type: 'signature', required: true, signature: { mode: 'draw', statement: 'I approve this line', resign_on_change: true }, default: 'x', placeholder: 'y' },
      { key: 'lines', label: 'Lines', type: 'list', list: { columns: [{ key: 'item', label: 'Item', type: 'text' }, { key: 'signed', label: 'Signed', type: 'signature' }] } },
    ],
    cell_rules: [{ if: cond('row.signature', 'is_set'), column: 'signature', read_only: true }],
  },
}
const VISITS = {
  key: 'visits', label: 'Visits', type: 'repeating_section',
  repeating_section: {
    fields: [
      { key: 'site', label: 'Site', type: 'text' },
      { key: 'visitor_sig', label: 'Visitor signature', type: 'signature', signature: { capture_audit: true } },
      { key: 'checks', label: 'Checks', type: 'list', list: { columns: [{ key: 'check', label: 'Check', type: 'text' }, { key: 'ok_sig', label: 'OK', type: 'signature' }] } },
    ],
  },
}
const FIELDS = [APPROVALS, VISITS, { key: 'sig', label: 'Form signature', type: 'signature' }]

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'ut-sig-cells-'))
  roots.push(root)
  provider = createLocalStorageProvider({ local_root: root })
  db = createMemorySupabase({
    forms: [{ id: FORM, tenant_id: TENANT, name: 'Approvals', fields: FIELDS, version: 1, buttons: null, layout: null, theme: null, header: null }],
    tasks: [], workflows: [], task_assignees: [], user_teams: [], form_files: [], form_submissions: [],
    users: [{ id: ADA, display_name: 'Ada Lovelace', email: 'ada@x' }, { id: BOB, display_name: 'Bob', email: 'bob@x' }],
    user_memberships: [],
  }, { uuids: true })
}
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }) })

const ctx = (over: Partial<ServiceContext> = {}): ServiceContext => ({
  supabase: db, db, tenantId: TENANT, actorId: ADA, authKind: 'session', source: 'ui', permissions: new Set(['forms.submit', 'forms.edit']), ...over,
})
const upload = (field_key: string, data: Uint8Array = PNG, c: ServiceContext = ctx(), name = 'signature.png') =>
  svc.uploadFormFile(c, { context: { kind: 'form', formId: FORM }, field_key, name, bytes: data, declared_size: data.byteLength })
const files = { kind: 'form' as const, formId: FORM, actorId: ADA }
const meta = { fields: FIELDS, template_values: {} }
const submit = (values: Record<string, unknown>, options: Record<string, unknown> = {}) => mergeTaskFieldValuesChecked(db, TENANT, meta, values, { files, actorId: ADA, ...options })

describe('schema', () => {
  it('keeps signature columns (any level) with their pad config; no default / placeholder / re-sign; never the key column', () => {
    const [list] = normalizeTaskFields([APPROVALS])
    const sig = list.list!.columns.find((c) => c.key === 'signature')!
    expect(sig).toEqual({ key: 'signature', label: 'Signature', type: 'signature', required: true, signature: { mode: 'draw', statement: 'I approve this line' } })
    expect(list.list!.columns.find((c) => c.key === 'lines')!.list!.columns[1].type).toBe('signature')
    expect(normalizeListConfig({ key_column: 's', columns: [{ key: 's', label: 'S', type: 'signature' }, { key: 'a', label: 'A' }] }).key_column).toBeUndefined()
    expect(listConfigProblem({ key_column: 's', columns: [{ key: 's', label: 'S', type: 'signature' }, { key: 'a', label: 'A', type: 'text' }] })).toMatch(/key column cannot be a signature/)
    expect(listConfigProblem(list.list)).toBeNull()
  })

  it('keeps Signature controls inside repeating sections (nested Lists with signature columns too)', () => {
    const [section] = normalizeTaskFields([VISITS])
    expect(section.repeating_section!.fields.map((f) => f.type)).toEqual(['text', 'signature', 'list'])
    expect(section.repeating_section!.fields[1].signature).toEqual({ capture_audit: true })
  })

  it('upload keys name the column (top List, nested List, List inside a section); other keys do not', () => {
    const fields = normalizeTaskFields(FIELDS)
    expect(listUploadKey('approvals', ['lines', 'signed'])).toBe('approvals.lines.signed')
    expect(resolveFileControl(fields, 'approvals.signature')).toMatchObject({ field: { key: 'approvals.signature', type: 'signature', required: true, signature: { mode: 'draw' } }, repeated: true })
    expect(resolveFileControl(fields, 'approvals.lines.signed')?.field.label).toBe('Signed')
    expect(resolveFileControl(fields, 'checks.ok_sig')?.field.key).toBe('checks.ok_sig')
    expect(resolveFileControl(fields, 'visitor_sig')).toMatchObject({ repeated: true, field: { type: 'signature' } })
    expect(resolveFileControl(fields, 'sig')).toMatchObject({ repeated: false })
    expect(resolveFileControl(fields, 'approvals.approver')).toBeNull()
    expect(resolveFileControl(fields, 'approvals.lines')).toBeNull()
    expect(resolveFileControl(fields, 'approvals.__proto__')).toBeNull()
    expect(svc.storedFieldKey('a'.repeat(30) + '.' + 'b'.repeat(30) + '.' + 'c'.repeat(30))).toMatch(/^a{30}\.b{16}~[0-9a-f]{16}$/)
    expect(svc.storedFieldKey('approvals.signature')).toBe('approvals.signature')
  })

  it('cells: coerced to the Signature value, validated like a field (required, method), formatted for reading', () => {
    const [list] = normalizeTaskFields([APPROVALS])
    const file = { id: u(500), name: 'signature.png', size: 10, mime_type: 'image/png', url: '/attachments/x', storage_ref: '', uploaded_by: ADA, uploaded_at: '', checksum_sha256: '' }
    const rows = coerceListRows(list.list, [{ approver: 'Ada', signature: { file, method: 'draw', signed_at: '2026-11-11T10:00:00Z', user_name: 'Ada Lovelace', evil: 1 } }, { approver: 'Bob', signature: 'data:image/png;base64,AAAA' }])
    expect(rows[0].signature).toMatchObject({ method: 'draw', user_name: 'Ada Lovelace' })
    expect(rows[0].signature).not.toHaveProperty('evil')
    expect(rows[1].signature).toBeNull()
    const check = checkListValue(list.list, [{ approver: 'Ada', signature: null }, { approver: 'Bob', signature: { file, method: 'type', typed_name: 'Bob' } }], false, 1, { form: {}, user: null })
    expect(check.rowErrors[0]).toEqual({ signature: 'Signature: please sign' })
    expect(check.rowErrors[1]).toEqual({ signature: 'Signature: typed signatures are not allowed here' })
    expect(formatListCell(list.list!.columns[1], rows[0].signature)).toMatch(/^Signed by Ada Lovelace on 11 Nov 2026/)
    expect(formatListCell(list.list!.columns[1], null)).toBe('—')
  })

  it('row.<signature> conditions: is_set / is_not_set (is not empty / is empty) (a cell rule locks a signed cell)', () => {
    const [list] = normalizeTaskFields([APPROVALS])
    expect(listCellStates(list.list, { approver: 'Ada', signature: { file: { id: u(1), name: 'signature.png' }, method: 'draw' } }, { form: {} }).locked).toEqual({ signature: true })
    expect(listCellStates(list.list, { approver: 'Ada', signature: { file: { id: 'not-a-file' }, method: 'draw' } }, { form: {} }).locked).toEqual({})
    expect(listCellStates(list.list, { approver: 'Ada', signature: null }, { form: {} }).locked).toEqual({})
  })

  it('workflow data: the cell is the Signature value (data picker), CSV / text show "Signed by …"', () => {
    const [list] = normalizeTaskFields([APPROVALS])
    const schema = fieldSchema(list) as any
    const row = schema.items?.fields ?? schema.fields
    const sigNode = JSON.stringify(schema)
    expect(sigNode).toContain('user_name')
    expect(sigNode).toContain('signed_at')
    expect(row).toBeTruthy()
    const value = [{ approver: 'Ada', signature: { file: { id: u(500), name: 's.png', size: 1 }, method: 'draw', signed_at: '2026-11-11T10:00:00Z', user_name: 'Ada' }, lines: [{ item: 'A', signed: null }] }]
    const shown = mapNestedSignatures(list, value, (_, v) => (v ? 'SIGNED' : null)) as any[]
    expect(shown[0]).toMatchObject({ approver: 'Ada', signature: 'SIGNED', lines: [{ item: 'A', signed: null }] })
    expect(value[0].signature).toHaveProperty('file') // not mutated
  })

  it('a public form reports repeating signatures as uploads', () => {
    expect(anonymousReadiness({ fields: normalizeTaskFields(FIELDS) }).attachments.map((a) => a.key)).toEqual(['approvals', 'visits', 'sig'])
  })
})

describe('uploads and submit (server)', () => {
  beforeEach(setup)

  it('uploads into a signature column: PNG only, at most 1 MB, sniffed; not into a text column', async () => {
    const file = await upload('approvals.signature')
    expect(file).toMatchObject({ name: 'signature.png', mime_type: 'image/png' })
    expect(db.tables.form_files[0].field_key).toBe('approvals.signature')
    await expect(upload('approvals.signature', JPEG, ctx(), 'signature.jpg')).rejects.toMatchObject({ status: 415 })
    await expect(upload('approvals.signature', new TextEncoder().encode('<svg onload=alert(1)>'), ctx(), 'signature.png')).rejects.toMatchObject({ status: 415 })
    const big = new Uint8Array(1024 * 1024 + 10); big.set(PNG)
    await expect(upload('approvals.signature', big)).rejects.toMatchObject({ status: 413 })
    await expect(upload('approvals.approver')).rejects.toThrow(/no attachments field/)
    // One file per row: a long list of rows is not capped per field (the per-person pending limit applies).
    for (let i = 0; i < 14; i++) await upload('approvals.lines.signed')
    expect(db.tables.form_files.filter((r: any) => r.field_key === 'approvals.lines.signed')).toHaveLength(14)
  })

  it('rebuilds every row\'s signature from the upload records and stamps the server\'s signer and time', async () => {
    const a = await upload('approvals.signature')
    const b = await upload('approvals.signature')
    const nested = await upload('approvals.lines.signed')
    const forged = { file: { ...a, url: 'https://evil.example/x.png', storage_ref: 'storage://other/x', size: 1 }, method: 'draw', user_id: BOB, user_name: 'Mallory', signed_at: '2001-01-01T00:00:00Z', ip: '6.6.6.6' }
    const result = await submit({ approvals: [
      { approver: 'Ada', signature: forged, lines: [{ item: 'Laptop', signed: { file: nested, method: 'draw' } }] },
      { approver: 'Bob', signature: { file: b, method: 'draw' }, lines: [] },
    ] })
    expect(result.errors).toEqual({})
    const rows = result.templateValues.approvals as any[]
    expect(rows[0].signature.file).toEqual(a)
    expect(rows[0].signature).toMatchObject({ method: 'draw', user_id: ADA, user_name: 'Ada Lovelace' })
    expect(rows[0].signature).not.toHaveProperty('ip')
    expect(Math.abs(new Date(rows[0].signature.signed_at).getTime() - Date.now())).toBeLessThan(60_000)
    expect(rows[0].lines[0].signed).toMatchObject({ file: nested, user_id: ADA })
    expect(rows[1].signature.file).toEqual(b)
    expect(svc.attachmentIdsIn(normalizeTaskFields(FIELDS), result.templateValues).sort()).toEqual([a.id, b.id, nested.id].sort())
  })

  it('refuses another person\'s, another field\'s, another workspace\'s and made-up files at the row\'s path', async () => {
    const top = await upload('sig')
    const bobs = await upload('approvals.signature', PNG, ctx({ actorId: BOB }))
    db.tables.form_files.push({ ...db.tables.form_files[0], id: u(900), tenant_id: OTHER_TENANT, field_key: 'approvals.signature' })
    const row = (file: unknown) => ({ approvals: [{ approver: 'Ada', signature: { file, method: 'draw' } }] })
    for (const file of [bobs, top, { ...top, id: u(900) }, { ...top, id: u(999) }]) {
      const out = await submit(row(file))
      expect(out.errors['approvals[0].signature']).toMatch(/no longer available/)
      expect(out.errors.approvals).toMatch(/^Approvals: row 1: /)
    }
    // Not a signature at all (a data URL instead of the Signature value): refused.
    expect((await submit(row('data:image/png;base64,AAAA'))).errors.approvals).toMatch(/invalid signature/)
    expect((await submit({ approvals: [{ approver: 'Ada', signature: { file: { id: u(999), url: 'https://evil.example/a.png' }, method: 'draw' } }] })).errors.approvals).toMatch(/please sign|no longer available|invalid/)
  })

  it('repeating sections: each item\'s signature (and a List\'s inside it) re-read and stamped; capture_audit per item', async () => {
    const v1 = await upload('visitor_sig')
    const ok = await upload('checks.ok_sig')
    const result = await submit({ visits: [{ site: 'North', visitor_sig: { file: v1, method: 'draw', user_name: 'Mallory' }, checks: [{ check: 'Fire exits', ok_sig: { file: ok, method: 'draw' } }] }, { site: 'South', visitor_sig: null, checks: [] }] })
    expect(result.errors).toEqual({})
    const items = result.templateValues.visits as any[]
    expect(items[0].visitor_sig).toMatchObject({ file: v1, user_id: ADA, user_name: 'Ada Lovelace' })
    expect(items[0].checks[0].ok_sig).toMatchObject({ file: ok, user_id: ADA })
    expect(items[1].visitor_sig).toBeNull()
    const wrong = await submit({ visits: [{ site: 'North', visitor_sig: { file: ok, method: 'draw' }, checks: [] }] })
    expect(wrong.errors['visits[0].visitor_sig']).toMatch(/no longer available/)
  })

  it('a task keeps signatures carried over from an earlier task (bound uploads of the same column); others are refused', async () => {
    const earlier = await upload('approvals.signature')
    const stray = await upload('approvals.signature')
    for (const row of db.tables.form_files) Object.assign(row, { status: 'bound', context_kind: 'task', task_id: EARLIER_TASK, form_id: null })
    const fields = normalizeTaskFields(FIELDS)
    const signedBefore = { file: earlier, method: 'draw', signed_at: '2026-11-01T09:00:00.000Z', user_id: BOB, user_name: 'Bob' }
    const stored = { approvals: [{ approver: 'Bob', signature: signedBefore, lines: [] }] }
    const task = { kind: 'task' as const, taskId: TASK }
    const kept = await svc.resolveAttachmentValues(db, TENANT, fields, coerceValues(fields, stored), task, ['approvals'], stored)
    expect(kept.errors).toEqual({})
    expect((kept.values.approvals as any[])[0].signature.file).toEqual(earlier)
    // Without the stored value (or for a file the task never held) it is refused.
    expect((await svc.resolveAttachmentValues(db, TENANT, fields, coerceValues(fields, stored), task, ['approvals'], null)).errors.approvals).toMatch(/no longer available/)
    const other = { approvals: [{ approver: 'Bob', signature: { ...signedBefore, file: stray }, lines: [] }] }
    expect((await svc.resolveAttachmentValues(db, TENANT, fields, coerceValues(fields, other), task, ['approvals'], stored)).errors.approvals).toMatch(/no longer available/)
    // The stamp of a carried-over signature is kept (Bob signed it, not the current person).
    const { stampSignatureValues } = await import('@/lib/services/form-signatures')
    const stamped = await stampSignatureValues(db, fields, kept.values, { actorId: ADA, previous: stored, request: null })
    expect((stamped.approvals as any[])[0].signature).toMatchObject({ user_id: BOB, user_name: 'Bob', signed_at: '2026-11-01T09:00:00.000Z' })
  })

  it('a locked signature cell keeps its stored value (by key column), on submit and on drafts', () => {
    const fields = normalizeTaskFields([APPROVALS])
    const signed = { file: { id: u(501), name: 'signature.png', size: 10, mime_type: 'image/png' }, method: 'draw', signed_at: '2026-11-01T09:00:00.000Z', user_id: BOB, user_name: 'Bob' }
    const metaWithStored = { fields, template_values: { approvals: [{ approver: 'Bob', signature: signed, lines: [] }] } }
    for (const partial of [true, false]) {
      const swapped = mergeTaskFieldValues(metaWithStored as any, { approvals: [{ approver: 'Bob', signature: { ...signed, file: { ...signed.file, id: u(502) }, user_name: 'Mallory' }, lines: [] }] }, { partial })
      expect((swapped.templateValues.approvals as any[])[0].signature).toMatchObject({ file: { id: u(501) }, user_name: 'Bob' })
      // Locked by a condition on another column (approved rows): clearing the signature is refused too.
      const byStatus = normalizeTaskFields([{ ...APPROVALS, list: { ...APPROVALS.list, cell_rules: [{ if: cond('row.approver', 'eq', 'Bob'), column: 'signature', read_only: true }] } }])
      const cleared = mergeTaskFieldValues({ ...metaWithStored, fields: byStatus } as any, { approvals: [{ approver: 'Bob', signature: null, lines: [] }] }, { partial })
      expect((cleared.templateValues.approvals as any[])[0].signature).toMatchObject({ file: { id: u(501) } })
    }
  })
})

/** The values as mergeTaskFieldValues leaves them (typed rows). */
function coerceValues(fields: ReturnType<typeof normalizeTaskFields>, values: Record<string, unknown>) {
  return mergeTaskFieldValues({ fields, template_values: {} } as any, values, { partial: true }).templateValues
}

describe('InfoPath importer', () => {
  it('maps a signature line in a repeating table to a signature column and an ink picture in a repeating section to a Signature per item', async () => {
    const { analyzeInfoPath } = await import('@/lib/infopath/analyze')
    const { generateForms } = await import('@/lib/infopath/generate')
    const { publicInfoPathSummary } = await import('@/lib/infopath/public-summary')
    const filesIn = fixtureFiles('site-inspection').map((f) => {
      let text = f.data.toString('utf8')
      if (f.name === 'myschema.xsd') {
        text = text
          .replace('<xsd:element ref="my:findings" minOccurs="0"/></xsd:sequence>', '<xsd:element ref="my:findings" minOccurs="0"/><xsd:element ref="my:inspectorSign" minOccurs="0"/></xsd:sequence>')
          .replace('<xsd:element ref="my:controls" minOccurs="0"/></xsd:sequence>', '<xsd:element ref="my:controls" minOccurs="0"/><xsd:element ref="my:hazardSketch" minOccurs="0"/></xsd:sequence>')
          .replace('<xsd:element name="signature" nillable="true"', '<xsd:element name="inspectorSign" nillable="true" type="xsd:base64Binary"/><xsd:element name="hazardSketch" nillable="true" type="xsd:base64Binary"/><xsd:element name="signature" nillable="true"')
      }
      if (f.name === 'view1.xsl') {
        text = text
          .replace('<td>Score</td><td>Findings</td>', '<td>Score</td><td>Findings</td><td>Inspector</td>')
          .replace('</tr></xsl:for-each></tbody></table></td>\n\t\t\t\t</tr></xsl:for-each></tbody>', '</tr></xsl:for-each></tbody></table></td>\n\t\t\t\t\t<td><span class="xdSignatureLine" xd:xctname="SignatureLine" xd:CtrlId="CTRL27" xd:binding="my:inspectorSign"></span></td>\n\t\t\t\t</tr></xsl:for-each></tbody>')
          .replace('<div><xsl:apply-templates select="my:controls/my:control" mode="_2"/></div>', '<div><xsl:apply-templates select="my:controls/my:control" mode="_2"/></div><div>Sketch:</div><span class="xdInkPicture" xd:xctname="InkPicture" xd:CtrlId="CTRL42" xd:binding="my:hazardSketch"></span>')
      }
      return { name: f.name, data: Buffer.from(text, 'utf8') }
    })
    expect(filesIn.find((f) => f.name === 'view1.xsl')!.data.toString()).toContain('CTRL27')
    const xsn = writeCab(filesIn, 'mszip', { blockSize: 4096 })
    const { forms, report } = generateForms(analyzeInfoPath(xsn, { fileName: 'Site Inspection.xsn' }), { now: '2026-11-11T00:00:00.000Z' })
    const fields = forms[0].input.fields
    const items = fields.find((f) => f.type === 'list' && f.list?.columns.some((c) => c.key === 'area'))!
    const column = items.list!.columns.find((c) => c.type === 'signature')
    expect(column).toMatchObject({ type: 'signature', label: expect.any(String) })
    const hazards = fields.find((f) => f.type === 'repeating_section' && f.repeating_section?.fields.some((x) => x.key === 'hazard_title' || /hazard/i.test(x.label)))!
    expect(hazards.repeating_section!.fields.find((x) => x.type === 'signature')).toMatchObject({ type: 'signature', signature: { mode: 'draw' } })
    expect(report.items.some((i) => i.status === 'manual' && /signature inside a repeating section/i.test(i.detail))).toBe(false)
    expect(report.items.some((i) => i.status === 'converted' && /repeating table → a signature column/.test(i.detail))).toBe(true)
    // The normalised form keeps both (what the importer saves).
    const saved = normalizeTaskFields(fields)
    expect(saved.find((f) => f.key === items.key)!.list!.columns.some((c) => c.type === 'signature')).toBe(true)
    expect(saved.find((f) => f.key === hazards.key)!.repeating_section!.fields.some((x) => x.type === 'signature')).toBe(true)
    const summary = publicInfoPathSummary(xsn, 'Site Inspection.xsn') as any
    const sig = (summary.converted ?? summary.features ?? []).find((x: any) => x.key === 'signatures')
    expect(sig?.count).toBeGreaterThanOrEqual(3)
  })
})

describe('render', () => {
  const [list] = normalizeTaskFields([APPROVALS])
  const signed = { file: { id: u(500), name: 'signature.png', size: 10, mime_type: 'image/png' }, method: 'draw', signed_at: '2026-11-11T10:00:00.000Z', user_id: ADA, user_name: 'Ada Lovelace' }

  it('read only: the signature image and "Signed by …" in the table and cards', () => {
    const html = renderToStaticMarkup(createElement(ListValueView, { field: list, value: [{ approver: 'Ada', signature: signed, lines: [] }, { approver: 'Bob', signature: null, lines: [] }] }))
    expect(html).toContain(`src="/attachments/${u(500)}?inline=1"`)
    expect(html).toContain('alt="Signature of Ada Lovelace"')
    expect(html).toMatch(/Signed by Ada Lovelace on 11 Nov 2026/)
    expect(html).toContain('data-signature-cell="empty"')
    expect(renderToStaticMarkup(createElement(SignatureCellValue, { value: 'data:image/png;base64,AAAA' }))).not.toContain('<img')
  })

  it('editable cell: a Sign button (compact) or the thumbnail with Clear; the row pop-out / cards get the pad', () => {
    const column = list.list!.columns[1]
    const sign = renderToStaticMarkup(createElement(ColumnInput, { column, value: null, onChange: () => {}, id: 'c1', compact: true, uploadKey: 'approvals.signature' }))
    expect(sign).toContain('data-signature-cell-sign')
    expect(sign).toContain('Sign')
    const thumb = renderToStaticMarkup(createElement(ColumnInput, { column, value: signed, onChange: () => {}, id: 'c1', compact: true, uploadKey: 'approvals.signature' }))
    expect(thumb).toContain('data-signature-cell-open')
    expect(thumb).toContain('data-signature-cell-clear')
    expect(thumb).toContain(`/attachments/${u(500)}?inline=1`)
    const pad = renderToStaticMarkup(createElement(ColumnInput, { column, value: null, onChange: () => {}, id: 'c1', uploadKey: 'approvals.signature' }))
    expect(pad).toContain('data-signature-field="approvals.signature"')
    expect(pad).toContain('I approve this line')
    // Without an upload key (nowhere to sign) the value is shown.
    expect(renderToStaticMarkup(createElement(ColumnInput, { column, value: signed, onChange: () => {}, id: 'c1', compact: true }))).toContain('data-signature-cell="signed"')
  })
})
