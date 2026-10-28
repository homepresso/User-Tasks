import { describe, expect, it } from 'vitest'
import {
  assetFilePath,
  buildAssetEnvelope,
  filesToManifest,
  manifestToFiles,
  planManifestFiles,
  repoPathPrefix,
  stringifyForRepo,
  type RepoFile,
} from '@/lib/github-sync/layout'

/* eslint-disable @typescript-eslint/no-explicit-any -- manifest fixtures */

const WF = '3fa8c21b-1234-5678-9abc-def012345678'
const DT = '9b1e0c55-0000-4000-8000-000000000001'
const INT = '7c2d9a10-0000-4000-8000-000000000002'
const REF = '1d4f6b22-0000-4000-8000-000000000003'

function sampleManifest() {
  return {
    format_version: 3,
    workflows: [{ id: WF, name: 'Invoice Approval', nodes: [{ id: 'n1', type: 'start' }], edges: [], trigger_type: 'manual' }],
    decision_tables: [{ id: DT, name: 'Risk tier', inputs: [], outputs: [], rules: [], updated_at: '2026-10-01T00:00:00Z' }],
    integrations: [{ id: INT, name: 'ERP', type: 'rest_api', config: { base_url: 'https://erp.example', auth_config: { token: '__SECRET__' } } }],
    references: [{ id: REF, integration_id: INT, name: 'List orders', request_config: { method: 'GET', path: '/orders' } }],
    // Not a known section: never written to files.
    tenant_id: 'tenant-a',
  }
}

const sections = (manifest: Record<string, any>) => Object.fromEntries(
  Object.entries(manifest).filter(([key, value]) => key !== 'format_version' && Array.isArray(value)),
)

describe('manifestToFiles / filesToManifest', () => {
  it('round-trips a manifest with no prefix (config-as-code folders)', () => {
    const files = manifestToFiles(sampleManifest())
    expect(files.map((f) => f.path).sort()).toEqual([
      'decision-tables/risk-tier-9b1e0c55.json',
      'integrations/erp-7c2d9a10.json',
      'manifest.json',
      'references/list-orders-1d4f6b22.json',
      'workflows/invoice-approval-3fa8c21b.json',
    ])
    const { manifest, errors } = filesToManifest(files)
    expect(errors).toEqual([])
    expect(manifest.format_version).toBe(3)
    expect(sections(manifest)).toEqual(sections(sampleManifest()))
  })

  it('round-trips under a repo prefix and ignores files outside it', () => {
    const files = [...manifestToFiles(sampleManifest(), 'config/usertasks'), { path: 'README.json', content: '{}' }]
    expect(files.every((f) => f.path === 'README.json' || f.path.startsWith('config/usertasks/'))).toBe(true)
    const { manifest, errors } = filesToManifest(files, 'config/usertasks')
    expect(errors).toEqual([])
    expect(sections(manifest)).toEqual(sections(sampleManifest()))
  })

  it('matches the paths push has always written (assetFilePath) for a sync prefix', () => {
    const { files, index } = planManifestFiles(sampleManifest(), repoPathPrefix('usertasks/'))
    expect(files[0].path).toBe(assetFilePath('usertasks/', 'workflows', 'Invoice Approval', WF))
    expect(files[0].content).toBe(stringifyForRepo({ ...buildAssetEnvelope('workflows', WF, sampleManifest().workflows[0]), exported_at: JSON.parse(files[0].content).exported_at }))
    expect(index.find((e) => e.id === DT)).toMatchObject({ asset_type: 'decision_tables', slug: 'risk-tier-9b1e0c55', updated_at: '2026-10-01T00:00:00Z' })
    expect(repoPathPrefix('')).toBe('usertasks')
  })

  it('reads a GitHub-sync repo fixture in index order (deploy semantics)', () => {
    // Shaped exactly like a pushed repo: manifest index + envelopes, plus a
    // stray unindexed file that deploy must ignore.
    const envelope = (section: string, id: string, asset: object) => stringifyForRepo({ format_version: 3, asset_type: section, id, exported_at: '2026-10-01T00:00:00Z', asset })
    const files: RepoFile[] = [
      {
        path: 'usertasks/manifest.json',
        content: stringifyForRepo({
          format_version: 3, generator: 'usertasks', exported_at: '2026-10-01T00:00:00Z', source: {},
          index: [
            { asset_type: 'workflows', id: WF, name: 'Invoice Approval', slug: 'invoice-approval-3fa8c21b', file: 'usertasks/workflows/invoice-approval-3fa8c21b.json', updated_at: null },
            { asset_type: 'decision_tables', id: DT, name: 'Risk tier', slug: 'risk-tier-9b1e0c55', file: 'usertasks/decision-tables/risk-tier-9b1e0c55.json', updated_at: null },
            { asset_type: 'agents', id: REF, name: 'Gone', slug: 'gone', file: 'usertasks/agents/gone.json', updated_at: null },
          ],
        }),
      },
      { path: 'usertasks/decision-tables/risk-tier-9b1e0c55.json', content: envelope('decision_tables', DT, { id: DT, name: 'Risk tier' }) },
      { path: 'usertasks/workflows/invoice-approval-3fa8c21b.json', content: envelope('workflows', WF, { id: WF, name: 'Invoice Approval' }) },
      { path: 'usertasks/workflows/stray-00000000.json', content: envelope('workflows', INT, { id: INT, name: 'Stray' }) },
    ]
    const deploy = filesToManifest(files, 'usertasks', { indexOnly: true })
    expect(deploy.manifest).toEqual({
      format_version: 3,
      workflows: [{ id: WF, name: 'Invoice Approval' }],
      decision_tables: [{ id: DT, name: 'Risk tier' }],
    })
    // Scan mode (config apply) also picks up the unindexed file, after the indexed ones.
    const scan = filesToManifest(files, 'usertasks')
    expect(scan.manifest.workflows.map((w: any) => w.name)).toEqual(['Invoice Approval', 'Stray'])
    expect(scan.paths.workflows).toEqual(['usertasks/workflows/invoice-approval-3fa8c21b.json', 'usertasks/workflows/stray-00000000.json'])
  })

  it('reports malformed files instead of throwing (scan mode)', () => {
    const { manifest, errors } = filesToManifest([
      { path: 'workflows/bad.json', content: '{ nope' },
      { path: 'workflows/array.json', content: '[]' },
      { path: 'workflows/unknown.json', content: JSON.stringify({ asset_type: 'gizmos', asset: { id: 'x' } }) },
      { path: 'workflows/mismatch.json', content: JSON.stringify({ asset_type: 'workflows', id: WF, asset: { id: DT, name: 'x' } }) },
      { path: 'decision-tables/ok.json', content: JSON.stringify({ asset_type: 'decision-tables', id: DT, asset: { name: 'Dir alias, id from envelope' } }) },
      { path: 'notes.txt', content: 'ignored' },
    ])
    expect(errors.map((e) => e.path).sort()).toEqual(['workflows/array.json', 'workflows/bad.json', 'workflows/mismatch.json', 'workflows/unknown.json'])
    expect(manifest.decision_tables).toEqual([{ name: 'Dir alias, id from envelope', id: DT }])
  })
})
