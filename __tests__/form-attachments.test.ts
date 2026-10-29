/**
 * Attachments fields (pure parts): config normalisation and limits, the
 * value shape and its validation, field-schema integration (types, coerce,
 * defaults, key clashes), file-name sanitising, magic-byte verification
 * (types by content, dangerous types blocked), the data picker (list with
 * an item schema, `<key>_count`, Loop items / drop / Current item) and the
 * file expression helpers.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- free-form JSON */

import { describe, expect, it } from 'vitest'
import PizZip from 'pizzip'
import {
  acceptAttribute, attachmentLimits, attachmentNames, attachmentsConfigProblem, attachmentsValueError, describeAllowedTypes,
  isTypeAllowed, kindForExtension, normalizeAttachmentValue, normalizeAttachmentsConfig, sanitizeFileName, storageSafeName,
} from '@/lib/forms/attachments'
import { sniffContent, verifyAttachmentContent, zipEntryNames } from '@/lib/forms/attachment-sniff'
import {
  coerceTaskFieldValues, defaultTaskFieldValues, fieldDefinitionProblems, fieldValueSchemaType, normalizeTaskFields, validateTaskFieldValues,
} from '@/lib/task-field-schema'
import { buildDataTree, collectArrayCandidates, flattenTree } from '@/lib/workflow-data-picker'
import { loopItemsFromDrop } from '@/lib/workflow-data-drop'
import { buildFormSubmittedPayload } from '@/lib/forms/submitted-trigger'
import { evaluateFunction } from '@/lib/expression-functions'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const enc = (text: string) => new TextEncoder().encode(text)

function file(n: number, name: string, size = 1000, mime = 'application/pdf'): any {
  return { id: u(n), name, size, mime_type: mime, url: `/attachments/${u(n)}`, storage_ref: `storage://form-files/t/${u(n)}/${name}`, uploaded_by: u(99), uploaded_at: '2026-11-20T00:00:00.000Z', checksum_sha256: 'a'.repeat(64) }
}

function zip(entries: Record<string, string>): Uint8Array {
  const z = new PizZip()
  for (const [name, content] of Object.entries(entries)) z.file(name, content)
  return z.generate({ type: 'uint8array' })
}

const PDF = enc('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF')
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46])
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0])
const ELF = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0])
const DOCX = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>' })
const DOCM = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>', 'word/vbaProject.bin': 'macro' })
const XLSX = zip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<workbook/>' })

describe('attachments config', () => {
  it('normalises counts, sizes, types and custom types; drops junk and blocked extensions', () => {
    expect(normalizeAttachmentsConfig({ min_files: '2', max_files: 500, max_file_mb: 0, max_total_mb: '12.34', types: ['images', 'nope', 'documents', 'images'], custom_types: ['.DWG', 'Image/*', 'exe', '.js', 'bad type', 'application/zip'], camera: true }))
      .toEqual({ min_files: 2, max_files: 50, max_file_mb: 0.1, max_total_mb: 12.3, types: ['images', 'documents'], custom_types: ['.dwg', 'image/*', 'application/zip'], camera: true })
    expect(normalizeAttachmentsConfig({ types: ['pdf', 'any'] })).toEqual({ types: ['any'] })
    expect(normalizeAttachmentsConfig(null)).toEqual({})
  })

  it('applies defaults, the required minimum and the instance cap', () => {
    expect(attachmentLimits(undefined)).toEqual({ minFiles: 0, maxFiles: 10, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 100 * 1024 * 1024 })
    expect(attachmentLimits({ max_files: 5, max_file_mb: 40 }, { required: true, instanceMaxMb: 25 })).toMatchObject({ minFiles: 1, maxFiles: 5, maxFileBytes: 25 * 1024 * 1024 })
    expect(attachmentLimits({ max_total_mb: 3 }).maxTotalBytes).toBe(3 * 1024 * 1024)
  })

  it('flags impossible configs', () => {
    expect(attachmentsConfigProblem({ min_files: 6, max_files: 5 })).toMatch(/Minimum files/)
    expect(attachmentsConfigProblem({ max_file_mb: 10, max_total_mb: 5 })).toMatch(/total size/)
    expect(attachmentsConfigProblem({ max_files: 5 })).toBeNull()
  })

  it('allowed types: presets, custom extensions and MIME patterns, the accept attribute', () => {
    const docsAndImages = { types: ['documents', 'images'] as any }
    expect(isTypeAllowed(docsAndImages, 'pdf', kindForExtension('pdf'))).toBe(true)
    expect(isTypeAllowed(docsAndImages, 'png', kindForExtension('png'))).toBe(true)
    expect(isTypeAllowed(docsAndImages, 'xlsx', kindForExtension('xlsx'))).toBe(false)
    expect(isTypeAllowed(docsAndImages, 'dwg', null)).toBe(false)
    expect(isTypeAllowed({ types: ['pdf'], custom_types: ['.dwg'] }, 'dwg', null)).toBe(true)
    expect(isTypeAllowed({ custom_types: ['image/*'] }, 'png', kindForExtension('png'))).toBe(true)
    expect(isTypeAllowed({ custom_types: ['image/*'] }, 'pdf', kindForExtension('pdf'))).toBe(false)
    expect(isTypeAllowed(undefined, 'exe', null)).toBe(false)
    expect(isTypeAllowed(undefined, 'dwg', null)).toBe(true)
    expect(acceptAttribute({ types: ['pdf'] })).toBe('.pdf')
    expect(acceptAttribute(undefined)).toBe('')
    expect(describeAllowedTypes(docsAndImages)).toBe('Documents, Images')
  })
})

describe('file names', () => {
  it('strips paths, control and bidi characters, leading dots; caps the length keeping the extension', () => {
    expect(sanitizeFileName('C:\\Users\\x\\..\\report.pdf')).toBe('report.pdf')
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFileName('invoice\u202Efdp.exe')).toBe('invoicefdp.exe')
    expect(sanitizeFileName('..hidden\n.txt')).toBe('hidden.txt')
    expect(sanitizeFileName('a<b>:c?.png')).toBe('a_b__c_.png')
    const long = sanitizeFileName(`${'x'.repeat(300)}.docx`)
    expect(long.length).toBe(150)
    expect(long.endsWith('.docx')).toBe(true)
    expect(sanitizeFileName('   ')).toBe('file')
    expect(storageSafeName('Résumé (final) ✓.pdf')).toBe('Resume-final-.pdf')
  })
})

describe('content verification (magic bytes)', () => {
  it('recognises the signatures', () => {
    expect(sniffContent(PDF)).toBe('pdf')
    expect(sniffContent(PNG)).toBe('png')
    expect(sniffContent(JPEG)).toBe('jpeg')
    expect(sniffContent(EXE)).toBe('executable')
    expect(sniffContent(ELF)).toBe('executable')
    expect(sniffContent(enc('#!/bin/sh\nrm -rf /'))).toBe('script')
    expect(sniffContent(enc('<!DOCTYPE html><html><body>x</body></html>'))).toBe('html')
    expect(sniffContent(enc('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('svg')
    expect(sniffContent(enc('a,b\n1,2'))).toBe('text')
    expect(sniffContent(DOCX)).toBe('zip')
    expect(zipEntryNames(DOCX)).toEqual(['[Content_Types].xml', 'word/document.xml'])
  })

  it('accepts files whose content matches their extension and the field', () => {
    const cfg = { types: ['documents', 'images', 'spreadsheets'] as any }
    expect(verifyAttachmentContent({ name: 'a.pdf', bytes: PDF, config: cfg })).toMatchObject({ ok: true, mime: 'application/pdf' })
    expect(verifyAttachmentContent({ name: 'a.PNG', bytes: PNG, config: cfg })).toMatchObject({ ok: true, mime: 'image/png' })
    expect(verifyAttachmentContent({ name: 'a.docx', bytes: DOCX, config: cfg })).toMatchObject({ ok: true })
    expect(verifyAttachmentContent({ name: 'b.xlsx', bytes: XLSX, config: cfg })).toMatchObject({ ok: true })
    expect(verifyAttachmentContent({ name: 'c.csv', bytes: enc('a,b\n1,2'), config: cfg })).toMatchObject({ ok: true, mime: 'text/csv' })
  })

  it('refuses mismatches, executables, scripts, HTML, macros and blocked extensions', () => {
    const any = undefined
    expect(verifyAttachmentContent({ name: 'invoice.pdf', bytes: EXE, config: any })).toMatchObject({ ok: false, reason: expect.stringMatching(/Programs/) })
    expect(verifyAttachmentContent({ name: 'data.bin2', bytes: ELF, config: any })).toMatchObject({ ok: false })
    expect(verifyAttachmentContent({ name: 'photo.png', bytes: PDF, config: any })).toMatchObject({ ok: false, reason: expect.stringMatching(/not a valid PNG/) })
    expect(verifyAttachmentContent({ name: 'notes.txt', bytes: enc('<html><script>alert(1)</script></html>'), config: any })).toMatchObject({ ok: false, reason: expect.stringMatching(/HTML/) })
    expect(verifyAttachmentContent({ name: 'list.csv', bytes: enc('#!/usr/bin/env python\nprint(1)'), config: any })).toMatchObject({ ok: false })
    expect(verifyAttachmentContent({ name: 'report.docx', bytes: DOCM, config: any })).toMatchObject({ ok: false, reason: expect.stringMatching(/not a valid Word/) })
    expect(verifyAttachmentContent({ name: 'report.docx', bytes: XLSX, config: any })).toMatchObject({ ok: false })
    expect(verifyAttachmentContent({ name: 'setup.exe', bytes: PDF, config: any })).toMatchObject({ ok: false, reason: '.exe files are not allowed' })
    expect(verifyAttachmentContent({ name: 'page.html', bytes: enc('hi'), config: any })).toMatchObject({ ok: false })
    expect(verifyAttachmentContent({ name: 'a.pdf', bytes: new Uint8Array(), config: any })).toMatchObject({ ok: false, reason: 'The file is empty' })
    // Allowed content, but not a type this field takes.
    expect(verifyAttachmentContent({ name: 'a.png', bytes: PNG, config: { types: ['pdf'] } })).toMatchObject({ ok: false, reason: expect.stringMatching(/not allowed here/) })
    // An unknown extension under "any" is fine unless it is something a browser would run.
    expect(verifyAttachmentContent({ name: 'drawing.dwg', bytes: new Uint8Array([0x41, 0x43, 0x31, 0x30, 0x32, 0x37, 0, 0xff]), config: any })).toMatchObject({ ok: true, mime: 'application/octet-stream' })
    expect(verifyAttachmentContent({ name: 'image.dat', bytes: enc('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), config: any })).toMatchObject({ ok: false })
  })
})

describe('field schema integration', () => {
  const fields = normalizeTaskFields([
    { key: 'receipts', label: 'Receipts', type: 'attachments', required: true, default: 'ignored', attachments: { max_files: 2, max_file_mb: 1, types: ['documents', 'images'] } },
    { key: 'note', label: 'Note', type: 'text' },
  ])

  it('keeps the config, never a default; value type is a list', () => {
    expect(fields[0]).toEqual({ key: 'receipts', label: 'Receipts', type: 'attachments', required: true, attachments: { max_files: 2, max_file_mb: 1, types: ['documents', 'images'] } })
    expect(fieldValueSchemaType('attachments')).toBe('array')
    expect(defaultTaskFieldValues(fields)).toEqual({ receipts: [], note: null })
  })

  it('validates required, counts, sizes and types', () => {
    expect(validateTaskFieldValues(fields, { receipts: [] })).toEqual({ receipts: 'Receipts is required' })
    expect(validateTaskFieldValues(fields, { receipts: [file(1, 'a.pdf')] })).toEqual({})
    expect(validateTaskFieldValues(fields, { receipts: [file(1, 'a.pdf'), file(2, 'b.pdf'), file(3, 'c.pdf')] }).receipts).toMatch(/at most 2 files/)
    expect(validateTaskFieldValues(fields, { receipts: [file(1, 'big.pdf', 2 * 1024 * 1024)] }).receipts).toMatch(/larger than 1.0 MB/)
    expect(validateTaskFieldValues(fields, { receipts: [file(1, 'sheet.xlsx')] }).receipts).toMatch(/not an allowed file type/)
    expect(validateTaskFieldValues(fields, { receipts: 'storage://form-files/x' }).receipts).toMatch(/invalid value/)
    expect(validateTaskFieldValues(fields, { receipts: [{ id: 'not-a-uuid', name: 'x.pdf' }] }).receipts).toMatch(/invalid file/)
    // Partial (draft) saves skip the required check.
    expect(validateTaskFieldValues(fields, { receipts: [] }, { partial: true })).toEqual({})
  })

  it('coerces to clean file objects (unknown keys dropped)', () => {
    const coerced = coerceTaskFieldValues(fields, { receipts: [{ ...file(1, 'a.pdf'), name: '../a.pdf', evil: true, size: '12' }] }) as any
    expect(coerced.receipts).toEqual([{ ...file(1, 'a.pdf'), size: 12 }])
    expect(normalizeAttachmentValue(file(1, 'a.pdf'))).toHaveLength(1)
    expect(attachmentNames([file(1, 'a.pdf'), file(2, 'b.png')])).toBe('a.pdf, b.png')
  })

  it('flags a field whose key clashes with an attachments count key', () => {
    const clash = normalizeTaskFields([{ key: 'docs', label: 'Docs', type: 'attachments' }, { key: 'docs_count', label: 'Count', type: 'number' }])
    expect(fieldDefinitionProblems(clash).docs).toMatch(/docs_count/)
    expect(attachmentsValueError({ label: 'Docs', attachments: { min_files: 2 } }, [file(1, 'a.pdf')])).toMatch(/at least 2/)
  })

  it('a Form submitted payload carries the files and their count', () => {
    const payload = buildFormSubmittedPayload({
      form: { id: u(10), name: 'Claim', version: 1 }, fields,
      values: { receipts: [file(1, 'a.pdf')], note: 'x' },
      submission: { id: u(11), created_at: 'now', source: 'standalone' }, submitter: { id: u(99) },
    })
    expect((payload.form as any).receipts).toHaveLength(1)
    expect((payload.form as any).receipts_count).toBe(1)
  })
})

describe('workflow data picker', () => {
  const nodes = [
    { id: 'task', type: 'user_task', label: 'Expense claim', config: { fields: [{ key: 'receipts', label: 'Receipts', type: 'attachments' }] } },
    { id: 'loop', type: 'loop', label: 'Each receipt', config: { items: '{{task_data.receipts}}' } },
    { id: 'log', type: 'log', label: 'Log', config: {} },
    { id: 'mail', type: 'send_email', label: 'Mail', config: {} },
  ]
  const edges = [
    { source: 'task', target: 'loop', label: 'Approved' },
    { source: 'loop', target: 'log', label: 'Each Item' },
    { source: 'loop', target: 'mail', label: 'Done' },
  ]

  it('shows the field as a list of files with an item schema, plus the count', () => {
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'mail' })
    const form = groups.find((g) => g.kind === 'form')!
    const receipts = form.roots.find((r) => r.path === 'task_data.receipts')!
    expect(receipts.schema?.type).toBe('array')
    expect(receipts.schema?.items?.fields?.map((f) => f.name)).toEqual(expect.arrayContaining(['name', 'size', 'mime_type', 'url', 'uploaded_at', 'checksum_sha256']))
    expect(form.roots.find((r) => r.path === 'task_data.receipts_count')?.schema?.type).toBe('integer')
  })

  it('offers it as Loop items, takes it by drop, and types {{item}} inside the loop', () => {
    const candidates = collectArrayCandidates(buildDataTree({ nodes, edges, currentNodeId: 'loop' }))
    expect(candidates.map((c) => c.expression)).toContain('{{task_data.receipts}}')
    expect(loopItemsFromDrop({ path: 'task_data.receipts', type: 'array' })).toBe('{{task_data.receipts}}')
    const inside = buildDataTree({ nodes, edges, currentNodeId: 'log' })
    const current = inside.find((g) => g.kind === 'loop')!
    expect(current.roots[0].path).toBe('item')
    const items = flattenTree([current]).map((i) => i.path)
    expect(items).toEqual(expect.arrayContaining(['item.name', 'item.size', 'item.url']))
  })
})

describe('file expression helpers', () => {
  const scope = { task_data: { receipts: [file(1, 'a.pdf', 1000), file(2, 'b.png', 2000)] } }
  it('FILE_NAMES / FILES_TOTAL_SIZE / COUNT over a file list', () => {
    expect(evaluateFunction('FILE_NAMES(task_data.receipts)', scope)).toBe('a.pdf, b.png')
    expect(evaluateFunction('FILE_NAMES(task_data.receipts, " | ")', scope)).toBe('a.pdf | b.png')
    expect(evaluateFunction('FILES_TOTAL_SIZE(task_data.receipts)', scope)).toBe(3000)
    expect(evaluateFunction('COUNT(task_data.receipts)', scope)).toBe(2)
  })
})
