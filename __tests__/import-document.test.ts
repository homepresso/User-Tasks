/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

import { describe, expect, it } from 'vitest'
import { normalizeImportDocument } from '@/lib/portability/import-document'
import { isUuid } from '@/lib/portability/plan'

const WF = '3fa8c21b-1234-4678-9abc-def012345678'
const DT = '9b1d2c3e-4f50-4a61-8b72-c3d4e5f60718'

function manifestOf(raw: unknown): Record<string, any> {
  const result = normalizeImportDocument(raw)
  if (result.kind !== 'manifest') throw new Error(`expected a manifest, got ${result.kind}`)
  return result.manifest
}

describe('normalizeImportDocument', () => {
  describe('config manifest', () => {
    it('keeps existing ids, adds ids to assets without a uuid and leaves objects untouched', () => {
      const raw = {
        format_version: 3,
        workflows: [{ id: WF, name: 'Intake' }, { name: 'No id' }, { id: 'not-a-uuid', name: 'Bad id' }],
        objects: [{ name: 'Obj', generated_reference_id: 'ref-1' }],
      }
      const manifest = manifestOf(raw)
      expect(manifest.workflows[0]).toEqual({ id: WF, name: 'Intake' })
      expect(isUuid(manifest.workflows[1].id)).toBe(true)
      expect(manifest.workflows[1].name).toBe('No id')
      expect(isUuid(manifest.workflows[2].id)).toBe(true)
      expect(manifest.workflows[2].id).not.toBe(manifest.workflows[1].id)
      expect(manifest.objects).toEqual([{ name: 'Obj', generated_reference_id: 'ref-1' }])
      // The input is not mutated.
      expect(raw.workflows[1]).toEqual({ name: 'No id' })
    })

    it('recognises a manifest holding only the workspace_theme singleton', () => {
      const manifest = manifestOf({ workspace_theme: { meta: { name: 'Acme' } } })
      expect(manifest).toEqual({ workspace_theme: { meta: { name: 'Acme' } } })
    })
  })

  describe('files form', () => {
    it('keeps only entries with string path and content', () => {
      const good = { path: 'workflows/a.json', content: '{}' }
      const result = normalizeImportDocument({ files: [good, { path: 'x.json' }, { content: '{}' }, null, 'junk', { path: 1, content: '{}' }] })
      expect(result).toEqual({ kind: 'files', files: [good] })
    })

    it('throws when no valid file remains', () => {
      expect(() => normalizeImportDocument({ files: [] })).toThrow('The files list is empty')
      expect(() => normalizeImportDocument({ files: [{ path: 'a.json' }] })).toThrow('The files list is empty')
    })
  })

  it('rejects a package manifest with a Packages hint', () => {
    expect(() => normalizeImportDocument({ kind: 'usertasks.package', name: 'pkg', workflows: [] })).toThrow(/package manifest.*Packages/)
  })

  describe('GitHub-sync asset envelope', () => {
    it('accepts the section name as asset_type', () => {
      const manifest = manifestOf({ format_version: 3, asset_type: 'workflows', id: WF, asset: { id: WF, name: 'Intake' } })
      expect(manifest.workflows).toEqual([{ id: WF, name: 'Intake' }])
    })

    it('accepts the repo dir name as asset_type and fills the asset id from the envelope', () => {
      const manifest = manifestOf({ asset_type: 'decision-tables', id: DT, asset: { name: 'Rates' } })
      expect(manifest.decision_tables).toEqual([{ id: DT, name: 'Rates' }])
    })

    it('gives an id-less envelope asset a fresh uuid', () => {
      const manifest = manifestOf({ asset_type: 'retention-policies', asset: { name: 'Purge' } })
      expect(manifest.retention_policies).toHaveLength(1)
      expect(isUuid(manifest.retention_policies[0].id)).toBe(true)
    })

    it('maps the workspace_theme singleton envelope', () => {
      const manifest = manifestOf({ format_version: 3, asset_type: 'workspace_theme', id: 'workspace', asset: { meta: { name: 'Acme' } } })
      expect(manifest).toEqual({ workspace_theme: { meta: { name: 'Acme' } } })
    })
  })

  describe('per-type export documents', () => {
    it.each(['decision_table', 'decisionTable'])('decision table under %s', (key) => {
      const manifest = manifestOf({ [key]: { id: DT, name: 'Rates', rules: [] } })
      expect(manifest).toEqual({ format_version: 3, decision_tables: [{ id: DT, name: 'Rates', rules: [] }] })
    })

    it('report', () => {
      const manifest = manifestOf({ asset_type: 'report', report: { name: 'Weekly' } })
      expect(manifest.reports).toHaveLength(1)
      expect(manifest.reports[0].name).toBe('Weekly')
      expect(isUuid(manifest.reports[0].id)).toBe(true)
    })

    it('workflow_activity', () => {
      const manifest = manifestOf({ workflow_activity: { key: 'enrich', name: 'Enrich' } })
      expect(manifest.workflow_activities).toEqual([expect.objectContaining({ key: 'enrich', name: 'Enrich' })])
      expect(isUuid(manifest.workflow_activities[0].id)).toBe(true)
    })

    it('workflow', () => {
      const manifest = manifestOf({ workflow: { id: WF, name: 'Intake', nodes: [] } })
      expect(manifest.workflows).toEqual([{ id: WF, name: 'Intake', nodes: [] }])
    })

    it('agent designer export file → agents section with a fresh id', () => {
      const file = {
        version: 1,
        type: 'agent',
        exportedAt: '2026-10-26T00:00:00.000Z',
        agent: { name: 'Triage bot', description: 'Routes tickets', model: 'claude', system_prompt: 'Be helpful', tools: [], temperature: 0.2, is_active: true },
      }
      const manifest = manifestOf(file)
      expect(Object.keys(manifest).sort()).toEqual(['agents', 'format_version'])
      expect(manifest.agents).toHaveLength(1)
      expect(manifest.agents[0]).toMatchObject(file.agent)
      expect(isUuid(manifest.agents[0].id)).toBe(true)
    })

    it('skips a typed key whose asset_type names a different type', () => {
      expect(() => normalizeImportDocument({ asset_type: 'report', workflow: { name: 'X' } })).toThrow(/Unrecognised file/)
    })
  })

  it('points a workflow canvas file at the designer', () => {
    expect(() => normalizeImportDocument({ nodes: [{ id: 'n1' }], edges: [] })).toThrow(/workflow canvas file.*designer/)
  })

  it('rejects unrecognised objects', () => {
    expect(() => normalizeImportDocument({ hello: 'world' })).toThrow(/Unrecognised file/)
    expect(() => normalizeImportDocument({ asset_type: 'nope', asset: {} })).toThrow(/Unrecognised file/)
  })

  it.each([null, undefined, 'text', 42, [], [{ files: [] }]])('rejects non-object input %j', (raw) => {
    expect(() => normalizeImportDocument(raw)).toThrow('The file must contain a JSON object')
  })
})

describe('normalizeImportDocument — hardening', () => {
  it('accepts a bare decision table (older rule-editor files)', () => {
    const doc = normalizeImportDocument({ name: 'Bare', inputs: [], outputs: [], rules: [] })
    expect(doc.kind).toBe('manifest')
    if (doc.kind !== 'manifest') return
    expect(doc.manifest.decision_tables).toHaveLength(1)
    expect(doc.manifest.decision_tables[0].name).toBe('Bare')
    expect(doc.manifest.decision_tables[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('recognises the workspace-theme envelope by its file-name form', () => {
    const doc = normalizeImportDocument({ asset_type: 'workspace-theme', asset: { preset: 'x' } })
    expect(doc).toEqual({ kind: 'manifest', manifest: { workspace_theme: { preset: 'x' } } })
  })
})
