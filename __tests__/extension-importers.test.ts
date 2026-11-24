/**
 * Importer contribution point: manifest validation, structural checks,
 * report helpers, the importers service (list / detect / analyze / import
 * with licence + permission gates and file checks), ctx.workflows.create with
 * a graph, the InfoPath enrich hook, MCP tools and the REST schemas.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/lib/providers/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/db')>()),
  getServiceDb: () => db.current,
}))

import { defineExtension, defineServerExtension, ExtensionError, type ImporterHandler, type ServerExtension } from '@/lib/extensions/sdk'
import { parseExtensionManifest } from '@/lib/extensions/manifest'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import { extensionProblems } from '@/lib/extensions/server-registry'
import { setEntitlementPort } from '@/lib/extensions/entitlement-port'
import { workflowGraph } from '@/lib/extensions/host'
import { importComplexityLevel, importCoverage, importReadiness, importReportMarkdown } from '@/lib/importers/report'
import { analyzeImport, checkFiles, decodeImportFiles, detectImporter, listImporterViews, normalizeReport, runImport } from '@/lib/services/importers'
import { applyInfoPathHooks } from '@/lib/importers/infopath-hooks'
import { unpackArchive } from '@/lib/importers/archive'
import { zipSync } from 'fflate'
import { API_ENDPOINTS } from '@/lib/api-schemas'
import { requiredToolPermission } from '@/lib/mcp/authz'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

const TENANT = '0e000000-0000-4000-8000-0000000e1001'
const USER = '0e000000-0000-4000-8000-0000000e10aa'

const manifest = {
  manifest_version: 1,
  id: 'acme-import',
  name: 'Acme importer',
  version: '1.0.0',
  publisher: { id: 'acme', name: 'Acme' },
  engines: { usertasks: '>=0.1.0', extension_sdk: '^1.0.0' },
  licence: { tier: 'paid', sku: 'acme', features: ['core', 'flows'] },
  deployments: ['self_hosted', 'cloud'],
  contributes: {
    triggers: [{ key: 'record_changed', label: 'Record changed', description: 'A record changed', config: [{ name: 'list', type: 'string' }] }],
    importers: [
      { key: 'flow', label: 'Acme flow', produces: ['workflow'], accepts: ['.flow', '.rules'], multiple: true, feature: 'flows', options: [{ name: 'name', type: 'string', label: 'Name' }] },
      { key: 'legacy', label: 'Legacy flow', produces: ['workflow'], accepts: ['.lgc'], preview: true },
    ],
  },
}

const calls: string[] = []
const flowImporter: ImporterHandler = {
  detect: ({ files }) => (files.some((f) => f.name.endsWith('.flow')) ? 0.9 : 0),
  async analyze({ files, options }) {
    calls.push(`analyze:${files.map((f) => f.name).join(',')}:${String(options.name ?? '')}`)
    if (files.some((f) => new TextDecoder().decode(f.bytes) === 'broken')) throw new ExtensionError('invalid_file', 'Not an Acme flow', 400)
    return {
      title: 'Approval', source: 'Acme flow', coverage: { total: 0, mapped: 0, partial: 0, placeholder: 0, skipped: 0, percent: 0 },
      complexity: { score: 20, level: 'low', factors: ['3 steps'] }, readiness: 'auto',
      items: [
        { kind: 'activity', name: 'Send mail', status: 'mapped', mappedTo: 'send_email' },
        { kind: 'activity', name: 'Custom code', status: 'placeholder', detail: 'kept as a placeholder' },
        { kind: 'note', name: 'Variables', status: 'info' },
      ],
      warnings: [], outputs: [{ kind: 'workflow', name: 'Approval' }],
    }
  },
  async import(input) {
    const report = await flowImporter.analyze(input)
    const wf = await input.ctx.workflows.create({
      name: String(input.options.name ?? 'Approval'),
      trigger: { key: 'record_changed', config: { list: 'x' } },
      nodes: [
        { id: 'mail', type: 'send_email', label: 'Send mail', config: { to: 'a@example.com', subject: 'Hi', body: 'Hi' } },
        { id: 'todo', type: 'placeholder', label: 'Custom code (to rebuild)', config: { note: 'original: <Custom/>' } },
      ],
      edges: [{ source: 'trigger', target: 'mail' }, { source: 'mail', target: 'todo' }],
      variables: [{ name: 'approver', type: 'string', default_value: '' }],
      tags: ['Imported'],
    })
    return { report, created: [{ kind: 'workflow', id: wf.workflowId, name: 'Approval', href: wf.path }] }
  },
}

const server: ServerExtension = defineServerExtension({
  id: 'acme-import',
  triggers: { record_changed: {} },
  importers: { flow: flowImporter, legacy: { analyze: flowImporter.analyze, import: flowImporter.import } },
})

function seed() {
  const mem = createMemorySupabase({
    tenant_extensions: [{ tenant_id: TENANT, extension_id: 'acme-import', enabled: true, config: {}, secrets: {}, config_version: 1 }],
    workflows: [], object_audit_log: [], event_stream: [],
  }, { uuids: true }) as any
  db.current = mem
  return mem
}

function svc(mem: any, permissions: string[] | null = null): ServiceContext {
  return { db: mem, supabase: mem, tenantId: TENANT, actorId: USER, permissions: permissions ? new Set(permissions) : null, authKind: 'session', source: 'api' } as ServiceContext
}

const file = (name: string, text = 'ok') => ({ name, bytes: new TextEncoder().encode(text) })

beforeEach(() => {
  calls.length = 0
  registerExtensionsForTest({ definitions: [defineExtension({ manifest })], servers: [server] })
  setEntitlementPort({ check: async (input) => ({ allowed: input.feature !== 'blocked', state: 'licensed' }) })
})
afterEach(() => resetExtensionsForTest())

describe('manifest and structure', () => {
  it('parses importers with defaults and checks features and keys', () => {
    const parsed = parseExtensionManifest(manifest)
    expect(parsed.contributes.importers[1]).toMatchObject({ key: 'legacy', multiple: false, preview: true, options: [], accepts: ['.lgc'] })
    expect(() => parseExtensionManifest({ ...manifest, contributes: { importers: [{ key: 'x', label: 'X', produces: ['workflow'], feature: 'nope' }] } })).toThrow(/feature "nope" is not declared/)
    expect(() => parseExtensionManifest({ ...manifest, contributes: { importers: [{ key: 'x', label: 'X', produces: ['workflow'] }, { key: 'x', label: 'Y', produces: ['form'] }] } })).toThrow(/duplicate importer "x"/)
    expect(() => parseExtensionManifest({ ...manifest, contributes: { importers: [{ key: 'x', label: 'X', produces: ['workflow'], accepts: ['xoml'] }] } })).toThrow()
  })

  it('reports importers without handlers and handlers without declarations', () => {
    registerExtensionsForTest({ definitions: [defineExtension({ manifest })], servers: [{ ...server, importers: { flow: flowImporter, extra: flowImporter } }] })
    const problems = extensionProblems().join('\n')
    expect(problems).toMatch(/implements importer "extra" that the manifest does not declare/)
    expect(problems).toMatch(/importer "legacy" needs analyze and import handlers/)
  })
})

describe('report helpers', () => {
  it('computes coverage (info excluded, partial half), level and readiness', () => {
    const c = importCoverage([{ status: 'mapped' }, { status: 'mapped' }, { status: 'partial' }, { status: 'placeholder' }, { status: 'info' }])
    expect(c).toEqual({ total: 4, mapped: 2, partial: 1, placeholder: 1, skipped: 0, percent: 63 })
    expect(importCoverage([]).percent).toBe(100)
    expect([importComplexityLevel(10), importComplexityLevel(50), importComplexityLevel(90)]).toEqual(['low', 'medium', 'high'])
    expect(importReadiness({ ...c, partial: 0, placeholder: 0, total: 2, percent: 100 }, 10)).toBe('auto')
    expect(importReadiness(c, 40)).toBe('review')
    expect(importReadiness({ ...c, percent: 30 }, 10)).toBe('rebuild')
    // Coverage weighs more than size: a large, well-mapped workflow is review, not rebuild.
    expect(importReadiness({ ...c, percent: 90 }, 100)).toBe('review')
    expect(importReadiness({ ...c, percent: 60 }, 90)).toBe('rebuild')
    expect(importReadiness({ ...c, partial: 0, placeholder: 0, total: 2, percent: 100 }, 60)).toBe('auto')
  })

  it('normalises an extension report and renders Markdown', () => {
    const r = normalizeReport({ title: 'T', items: [{ kind: 'a', name: 'n|1', status: 'weird' }, { kind: 'a', name: 'b', status: 'mapped' }], complexity: { score: 250 } }, { title: 'f', source: 'S', preview: true })
    expect(r.items[0].status).toBe('info')
    expect(r.coverage).toMatchObject({ total: 1, mapped: 1, percent: 100 })
    expect(r.complexity).toMatchObject({ score: 100, level: 'high' })
    expect(r.readiness).toBe('review')
    expect(r.preview).toBe(true)
    const md = importReportMarkdown(r)
    expect(md).toContain('# Import report: T')
    expect(md).toContain('n\\|1')
    expect(md).toContain('preview importer')
  })
})

describe('ctx.workflows.create graph', () => {
  it('checks ids, types and edges', () => {
    const g = workflowGraph('acme-import', {
      nodes: [{ id: 'a', type: 'log', label: 'A', config: { message: 'x' } }, { id: 'b', type: 'ext.acme-import.thing', label: 'B', config: {}, parentId: 'a' }],
      edges: [{ source: 'trigger', target: 'a' }, { source: 'a', target: 'b', label: 'Done' }],
      variables: [{ name: 'when', type: 'date' }, { name: 'bad name' }],
    })
    expect(g.nodes[0].position).toEqual({ x: 0, y: 140 })
    expect(g.edges[1]).toMatchObject({ source: 'a', target: 'b', label: 'Done' })
    expect(g.variables).toEqual([{ id: 'v1', name: 'when', type: 'string', format: 'datetime', defaultValue: '', description: '' }])
    expect(() => workflowGraph('acme-import', { nodes: [{ id: 'trigger', type: 'log', label: '', config: {} }] })).toThrow(/reserved/)
    expect(() => workflowGraph('acme-import', { nodes: [{ id: 'x', type: 'ext.other.thing', label: '', config: {} }] })).toThrow(/neither a core step/)
    expect(() => workflowGraph('acme-import', { nodes: [], edges: [{ source: 'trigger', target: 'ghost' }] })).toThrow(/does not exist/)
  })
})

describe('importers service', () => {
  it('lists core InfoPath and the extension importers with availability', async () => {
    const mem = seed()
    const { importers } = await listImporterViews(svc(mem))
    expect(importers.map((i) => i.id)).toEqual(['infopath', 'nintex', 'pdf', 'ext.acme-import.flow', 'ext.acme-import.legacy'])
    expect(importers[0]).toMatchObject({ endpoint: '/forms/import/infopath', produces: ['form'] })
    expect(importers[1]).toMatchObject({ endpoint: null, extension_id: null, available: true, feature: null })
    expect(importers[2]).toMatchObject({ endpoint: null, extension_id: null, produces: ['form'], accepts: ['.pdf'] })
    expect(importers[3]).toMatchObject({ available: true, feature: 'flows', multiple: true })
    expect((await listImporterViews(svc(mem), { produces: 'form' })).importers.map((i) => i.id)).toEqual(['infopath', 'nintex', 'pdf'])
    const viewer = await listImporterViews(svc(mem, ['workflows.view']))
    expect(viewer.importers[3]).toMatchObject({ available: false, unavailable_reason: 'Needs workflows.create or workflows.edit' })
    expect(viewer.importers[1]).toMatchObject({ available: false, unavailable_reason: 'Needs workflows.create or workflows.edit' })
  })

  it('locks an importer whose feature is not licensed (402)', async () => {
    const mem = seed()
    setEntitlementPort({ check: async (input) => ({ allowed: input.feature !== 'flows', state: input.feature === 'flows' ? 'expired' : 'licensed', reason: 'Licence expired' }) })
    const { importers } = await listImporterViews(svc(mem))
    expect(importers.find((i) => i.id === 'ext.acme-import.flow')).toMatchObject({ available: false, unavailable_reason: 'Licence expired' })
    await expect(analyzeImport(svc(mem), 'ext.acme-import.flow', [file('a.flow')])).rejects.toMatchObject({ status: 402, code: 'extension_licence_expired' })
  })

  it('checks files: endings, count, one file for single-file importers', () => {
    const c = parseExtensionManifest(manifest).contributes.importers
    expect(() => checkFiles(c[0], [file('a.txt')])).toThrow(/reads \.flow, \.rules/)
    expect(() => checkFiles(c[1], [file('a.lgc'), file('b.lgc')])).toThrow(/one file at a time/)
    expect(checkFiles(c[0], [file('dir/../A.FLOW')])[0].name).toBe('dir_.._A.FLOW')
    expect(decodeImportFiles([{ name: 'a.flow', content_base64: Buffer.from('hi').toString('base64') }])[0].bytes).toEqual(new TextEncoder().encode('hi'))
    expect(() => decodeImportFiles([{ name: 'a', content_base64: '%%%' }])).toThrow(/not base64/)
  })

  it('detects the importer and analyses with options (nothing stored)', async () => {
    const mem = seed()
    expect(await detectImporter(svc(mem), [file('a.flow'), file('a.rules')])).toEqual({ id: 'ext.acme-import.flow', score: 0.9 })
    const result = await analyzeImport(svc(mem), 'auto', [file('a.flow'), file('a.rules')], { name: 'Mine', ignored: 1 })
    expect(calls).toEqual(['analyze:a.flow,a.rules:Mine'])
    expect(result.importer).toBe('ext.acme-import.flow')
    expect(result.report.coverage).toMatchObject({ total: 2, mapped: 1, placeholder: 1, percent: 50 })
    expect(result.report.readiness).toBe('review')
    expect(result.markdown).toContain('Placeholder')
    expect(mem.tables.workflows).toHaveLength(0)
    await expect(analyzeImport(svc(mem), 'ext.acme-import.flow', [file('a.flow', 'broken')])).rejects.toMatchObject({ status: 400, message: 'Not an Acme flow' })
    await expect(analyzeImport(svc(mem), 'infopath', [file('a.xsn')])).rejects.toMatchObject({ status: 400 })
    await expect(analyzeImport(svc(mem), 'ext.acme-import.nope', [])).rejects.toMatchObject({ status: 404 })
  })

  it('imports: a draft workflow bound to the trigger with the graph, audited', async () => {
    const mem = seed()
    await expect(runImport(svc(mem, ['workflows.view']), 'ext.acme-import.flow', [file('a.flow')])).rejects.toMatchObject({ status: 403 })
    const result = await runImport(svc(mem), 'ext.acme-import.flow', [file('a.flow')], { name: 'Imported approval' })
    expect(result.created).toHaveLength(1)
    expect(result.created[0].href).toBe(`/automations/${result.created[0].id}`)
    const wf = mem.tables.workflows[0]
    expect(wf).toMatchObject({ name: 'Imported approval', is_active: false, trigger_type: 'ext.acme-import.record_changed', tags: ['imported'] })
    expect(wf.nodes.map((n: any) => n.id)).toEqual(['trigger', 'mail', 'todo'])
    expect(wf.edges.map((e: any) => `${e.source}>${e.target}`)).toEqual(['trigger>mail', 'mail>todo'])
    expect(wf.user_variables[0]).toMatchObject({ name: 'approver', type: 'string' })
    expect(mem.tables.object_audit_log.some((r: any) => r.action === 'import' && r.metadata?.importer === 'ext.acme-import.flow')).toBe(true)
  })
})

describe('InfoPath enrich hook', () => {
  it('runs usable extensions\' hooks and applies the requested binding', async () => {
    const mem = seed()
    const enrich = vi.fn(async ({ forms, hints, requestedBy, target }: any) => {
      expect(hints).toEqual({ list: 'L1' })
      expect(requestedBy).toBe('acme-import')
      expect(target).toMatchObject({ key: 'records' })
      return { notes: ['bound to L1'], forms: forms.map(() => ({ layout: { data_target: { config: { fields: ['f1'] } }, note: 'x' } })) }
    })
    registerExtensionsForTest({ definitions: [defineExtension({ manifest })], servers: [{ ...server, formTargets: { records: { label: 'Records', submit: async () => ({ record: { id: '1' } }) } }, infopath: { enrich } }] })
    setEntitlementPort({ check: async () => ({ allowed: true, state: 'licensed' }) })
    const generated: any = { report: { form: { name: 'Expense' } }, forms: [{ name: 'Expense', view: 'View 1', input: { fields: [], layout: { rows: [] } } }] }
    const model: any = { file_name: 'a.xsn', hash: 'h', manifest: { connections: [{ name: 'Lists', type: 'sharepoint_list', direction: 'query' }] } }
    const notes = await applyInfoPathHooks(svc(mem), model, generated, { extensionId: 'acme-import', dataTarget: { extension: 'acme-import', key: 'records', config: { list: 'L1' } }, hints: { list: 'L1' } })
    expect(notes).toEqual(['bound to L1'])
    expect(generated.forms[0].input.layout).toMatchObject({ note: 'x', data_target: { extension: 'acme-import', key: 'records', config: { list: 'L1', fields: ['f1'] } } })
    // An upload (no requesting extension): hooks run, nobody binds.
    const plain: any = { report: { form: { name: 'Expense' } }, forms: [{ name: 'Expense', view: null, input: { fields: [], layout: { rows: [] } } }] }
    enrich.mockImplementationOnce(async () => ({ notes: ['seen'], forms: [{ layout: { data_target: { extension: 'acme-import', key: 'records', config: {} } } }] }))
    expect(await applyInfoPathHooks(svc(mem), model, plain)).toEqual(['seen'])
    expect(plain.forms[0].input.layout.data_target).toBeUndefined()
  })

  it('skips a failing hook', async () => {
    const mem = seed()
    registerExtensionsForTest({ definitions: [defineExtension({ manifest })], servers: [{ ...server, infopath: { enrich: async () => { throw new Error('boom') } } }] })
    setEntitlementPort({ check: async () => ({ allowed: true, state: 'licensed' }) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const generated: any = { report: { form: { name: 'X' } }, forms: [] }
    expect(await applyInfoPathHooks(svc(mem), { file_name: 'a', hash: 'h', manifest: { connections: [] } } as any, generated)).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('archives and optional files', () => {
  it('unpacks a zip (folders kept, macOS litter dropped) and refuses anything else', () => {
    const zip = zipSync({ 'wf/A.xoml': new TextEncoder().encode('<a/>'), '__MACOSX/._A.xoml': new Uint8Array([1]), 'wf/A.xoml.rules': new TextEncoder().encode('<r/>') })
    const out = unpackArchive(zip)
    expect(out.format).toBe('zip')
    expect(out.entries.map((e) => e.name).sort()).toEqual(['wf/A.xoml', 'wf/A.xoml.rules'])
    expect(() => unpackArchive(new TextEncoder().encode('plain text'))).toThrow(/Not a zip or CAB/)
  })

  it('an importer with filesOptional analyses from its options alone', async () => {
    const optional = { ...manifest, contributes: { ...manifest.contributes, importers: [{ ...manifest.contributes.importers[0], filesOptional: true }, manifest.contributes.importers[1]] } }
    registerExtensionsForTest({ definitions: [defineExtension({ manifest: optional })], servers: [server] })
    setEntitlementPort({ check: async () => ({ allowed: true, state: 'licensed' }) })
    const mem = seed()
    expect((await analyzeImport(svc(mem), 'ext.acme-import.flow', [], { name: 'From options' })).report.title).toBe('Approval')
    expect((await listImporterViews(svc(mem))).importers[3]).toMatchObject({ files_optional: true })
    await expect(analyzeImport(svc(mem), 'ext.acme-import.legacy', [])).rejects.toMatchObject({ message: 'No file was sent' })
  })
})

describe('ctx.importers.infopath', () => {
  it('reaches the core InfoPath importer once it is loaded (late-bound, no import cycle)', async () => {
    const { getInfoPathRunner } = await import('@/lib/importers/infopath-runner')
    await import('@/lib/services/infopath-import')
    expect(typeof getInfoPathRunner()?.analyze).toBe('function')
    const mem = seed()
    const { runInfoPathForExtension } = await import('@/lib/importers/host')
    await expect(runInfoPathForExtension({ extensionId: 'acme-import', tenantId: TENANT, actorId: USER, db: mem, permissions: null }, { bytes: new TextEncoder().encode('not a template'), fileName: 'x.xsn', dryRun: true })).rejects.toMatchObject({ status: 400 })
    await expect(runInfoPathForExtension({ extensionId: 'acme-import', tenantId: TENANT, actorId: USER, db: mem, permissions: null }, { bytes: new Uint8Array([1]), fileName: 'x.xsn', target: { key: 'nope', config: {} } })).rejects.toThrow(/not declared/)
  })
})

describe('surfaces', () => {
  it('declares the REST endpoints and MCP permissions', () => {
    const paths = API_ENDPOINTS.map((e) => `${e.method} ${e.path}`)
    expect(paths).toEqual(expect.arrayContaining(['GET /importers', 'POST /importers/{importer}/analyze', 'POST /importers/{importer}/import']))
    expect(requiredToolPermission('importers_list')).toBe('workflows.view')
    expect(requiredToolPermission('importers_import')).toBe('workflows.view')
  })
})
