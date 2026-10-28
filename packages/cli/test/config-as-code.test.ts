import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import { prepareUpload, safeJoin, scaffold, substitute, writeExport } from '../src/config-files'
import { EXIT } from '../src/exit-codes'
import { harness, ok } from './helpers'

const env = { USERTASKS_URL: 'https://tasks.test', USERTASKS_API_KEY: 'ut_key' }
const ID = '3fa8c21b-1234-4678-9abc-def012345678'

const tempDir = () => mkdtempSync(join(tmpdir(), 'usertasks-config-'))
const envelope = (asset: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ format_version: 3, asset_type: 'integrations', ...extra, asset })

function plan(assets: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  const summary = { create: 0, update: 0, unchanged: 0, error: 0 } as Record<string, number>
  for (const asset of assets) summary[asset.action as string]++
  return { dry_run: true, plan: { assets, summary }, warnings: [], ...extra }
}

describe('substitute', () => {
  it('replaces ${env:} and ${file:} at any depth and collects unresolved references', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'token.txt'), 's3cret\n')
    const unresolved: string[] = []
    const out = substitute(
      { a: '${env:BASE}/v1', nested: [{ token: '${file:token.txt}' }], keep: '${other} ${env:MISSING} ${file:nope.txt}', n: 1 },
      { env: { BASE: 'https://x' }, baseDir: dir },
      unresolved,
    )
    expect(out).toEqual({ a: 'https://x/v1', nested: [{ token: 's3cret' }], keep: '${other} ${env:MISSING} ${file:nope.txt}', n: 1 })
    expect(unresolved).toEqual(['${env:MISSING}', '${file:nope.txt}'])
  })
})

describe('prepareUpload', () => {
  it('converts YAML to JSON, assigns ids (written back without secrets) and substitutes', () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'integrations'))
    const yamlFile = join(dir, 'integrations', 'erp.yaml')
    writeFileSync(yamlFile, '# ERP connection\nasset_type: integrations\nasset:\n  name: ERP\n  config:\n    auth_config:\n      token: ${env:ERP_TOKEN}\n')
    writeFileSync(join(dir, 'integrations', 'crm.json'), JSON.stringify(envelope({ id: ID, name: 'CRM' }, { id: ID })))
    mkdirSync(join(dir, '.git'))
    writeFileSync(join(dir, '.git', 'ignored.json'), '{}')

    const upload = prepareUpload(dir, { ERP_TOKEN: 'tok-123' }, { idFactory: () => 'generated-id' })
    expect(upload.files.map((f) => f.path)).toEqual(['integrations/crm.json', 'integrations/erp.json'])
    expect(JSON.parse(upload.files[1].content)).toEqual({ asset_type: 'integrations', id: 'generated-id', asset: { id: 'generated-id', name: 'ERP', config: { auth_config: { token: 'tok-123' } } } })
    expect(upload.assignedIds).toEqual([{ file: yamlFile, id: 'generated-id' }])

    // Written back: id added, comment and placeholder kept, secret value never written.
    const written = readFileSync(yamlFile, 'utf8')
    expect(written).toContain('# ERP connection')
    expect(written).toContain('${env:ERP_TOKEN}')
    expect(written).not.toContain('tok-123')
    expect(YAML.parse(written)).toMatchObject({ id: 'generated-id', asset: { id: 'generated-id' } })
  })

  it('writes generated ids back into JSON files and fails on unresolved placeholders', () => {
    const dir = tempDir()
    const file = join(dir, 'x.json')
    writeFileSync(file, JSON.stringify(envelope({ name: 'X', config: { token: '${env:NOPE}' } })))
    expect(() => prepareUpload(dir, {}, { idFactory: () => 'gen-1' })).toThrow(/Unresolved placeholders[\s\S]*\$\{env:NOPE\}/)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ asset_type: 'integrations', id: 'gen-1', asset: { id: 'gen-1', name: 'X' } })
  })
})

describe('workspace-theme.json (singleton)', () => {
  it('is uploaded without an id and replaced/removed like other managed files', () => {
    const dir = tempDir()
    const themeFile = join(dir, 'workspace-theme.json')
    const content = `${JSON.stringify({ format_version: 3, asset_type: 'workspace_theme', asset: { meta: { name: 'Acme' } } }, null, 2)}\n`
    writeFileSync(themeFile, content)
    const upload = prepareUpload(dir, {}, { idFactory: () => 'should-not-be-used' })
    expect(upload.assignedIds).toEqual([])
    expect(upload.files).toEqual([{ path: 'workspace-theme.json', content }])
    expect(readFileSync(themeFile, 'utf8')).toBe(content)

    // A later export without the theme removes the stale file (--force).
    const { removed } = writeExport(dir, [{ path: 'manifest.json', content: '{}\n' }], 'json', true)
    expect(removed).toEqual(['workspace-theme.json'])
  })
})

describe('writeExport', () => {
  it('writes YAML when asked, prunes stale managed files on replace and refuses path traversal', () => {
    const dir = tempDir()
    mkdirSync(join(dir, 'workflows'))
    writeFileSync(join(dir, 'workflows', 'old-11111111.json'), '{}')
    writeFileSync(join(dir, 'notes.md'), 'mine')
    const files = [
      { path: 'workflows/new-22222222.json', content: '{"asset_type":"workflows","asset":{"name":"New"}}\n' },
      { path: 'manifest.json', content: '{"index":[]}\n' },
    ]
    const result = writeExport(dir, files, 'yaml', true)
    expect(result.written).toEqual(['workflows/new-22222222.yaml', 'manifest.yaml'])
    expect(result.removed).toEqual(['workflows/old-11111111.json'])
    expect(YAML.parse(readFileSync(join(dir, 'workflows', 'new-22222222.yaml'), 'utf8'))).toEqual({ asset_type: 'workflows', asset: { name: 'New' } })
    expect(existsSync(join(dir, 'notes.md'))).toBe(true)
    expect(() => safeJoin(dir, '../evil.json')).toThrow(/outside/)
    expect(() => writeExport(dir, [{ path: '/etc/evil.json', content: '{}' }], 'json', false)).toThrow(/outside/)
  })
})

describe('scaffold', () => {
  it('creates an envelope with a generated id', () => {
    const dir = tempDir()
    const created = scaffold(dir, 'decision-table', 'Risk Tier', 'json', () => ID)
    expect(created.file).toBe(join(dir, 'decision-tables', 'risk-tier-3fa8c21b.json'))
    expect(JSON.parse(readFileSync(created.file, 'utf8'))).toMatchObject({ asset_type: 'decision_tables', id: ID, asset: { id: ID, name: 'Risk Tier', rules: [] } })
    expect(() => scaffold(dir, 'decision-table', 'Risk Tier', 'json', () => ID)).toThrow(/already exists/)
    expect(() => scaffold(dir, 'gizmo', 'x', 'json')).toThrow(/Unknown type/)
  })
})

describe('usertasks config', () => {
  it('export writes the files and refuses a non-empty folder without --force', async () => {
    const dir = join(tempDir(), 'out')
    const h = harness({
      env,
      tty: true,
      responder: () => ok({ format_version: 3, files: [{ path: 'workflows/a-3fa8c21b.json', content: '{"asset_type":"workflows","asset":{"id":"x"}}\n' }, { path: 'manifest.json', content: '{}\n' }], skipped: [{ section: 'roles', permission: 'team.view_members' }] }),
    })
    expect(await h.run('config', 'export', dir, '--types', 'workflows,roles')).toBe(0)
    expect(h.requests[0].url.pathname).toBe('/api/v1/config/export')
    expect(h.requests[0].url.searchParams.get('types')).toBe('workflows,roles')
    expect(readdirSync(join(dir, 'workflows'))).toEqual(['a-3fa8c21b.json'])
    expect(h.stdout()).toContain('Exported 2 files')
    expect(h.stderr()).toContain("skipped roles: missing permission 'team.view_members'")

    expect(await h.run('config', 'export', dir)).toBe(EXIT.usage)
    expect(await h.run('config', 'export', dir, '--force')).toBe(0)
  })

  it('diff prints the plan and exits 7 with --exit-code when there are changes', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.json'), JSON.stringify(envelope({ id: ID, name: 'ERP' }, { id: ID })))
    const response = plan([
      { section: 'integrations', name: 'ERP', action: 'update', source_id: ID, local_id: 'l1', matched_by: 'mapping', diffs: [{ path: 'config.base_url', before: 'https://a', after: 'https://b' }] },
      { section: 'workflows', name: 'Intake', action: 'unchanged', source_id: 'w', local_id: 'w' },
      { section: 'agents', name: 'Bot', action: 'create', source_id: 'g', local_id: null },
    ])
    const h = harness({ env, tty: true, responder: () => ok(response) })
    expect(await h.run('config', 'diff', dir, '--exit-code', '--source-label', 'dev')).toBe(EXIT.changes)
    expect(h.requests[0].body).toMatchObject({ dry_run: true, source_label: 'dev', files: [{ path: 'a.json' }] })
    const out = h.stdout()
    expect(out).toContain('~ update    integrations  ERP  [matched by mapping]')
    expect(out).toContain('      config.base_url: "https://a" → "https://b"')
    expect(out).toContain('= unchanged workflows     Intake')
    expect(out).toContain('+ create    agents        Bot')
    expect(out).toContain('Plan: 1 to create, 1 to update, 1 unchanged, 0 errors.')

    const quiet = harness({ env, responder: () => ok(response) })
    expect(await quiet.run('config', 'diff', dir)).toBe(0)
    expect(JSON.parse(quiet.stdout()).plan.summary).toEqual({ create: 1, update: 1, unchanged: 1, error: 0 })
  })

  it('apply sends a real apply and exits 7 on per-asset errors; unresolved placeholders exit 2 without a request', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.json'), JSON.stringify(envelope({ id: ID, name: 'ERP' }, { id: ID })))
    const failed = plan([{ section: 'integrations', name: 'ERP', action: 'create', source_id: ID, local_id: null }], {
      dry_run: false,
      result: { created: {}, updated: {}, errors: [{ asset_type: 'integration', source_id: ID, error: 'boom' }], warnings: [] },
    })
    const h = harness({ env, tty: true, responder: () => ok(failed) })
    expect(await h.run('config', 'apply', dir, '--adopt-by-name')).toBe(EXIT.changes)
    expect(h.requests[0].body).toMatchObject({ dry_run: false, adopt_by_name: true })
    expect(h.stdout()).toContain(`! integration ${ID}: boom`)

    const good = harness({ env, tty: true, responder: () => ok(plan([], { dry_run: false, result: { created: { integrations: 1 }, updated: {}, errors: [], warnings: [] } })) })
    expect(await good.run('config', 'apply', dir)).toBe(0)
    expect(good.stdout()).toContain('Applied: 1 created, 0 updated.')

    writeFileSync(join(dir, 'b.json'), JSON.stringify(envelope({ id: ID, name: 'X', token: '${env:UNSET_TOKEN}' }, { id: ID })))
    const bad = harness({ env, responder: () => ok(failed) })
    expect(await bad.run('config', 'apply', dir)).toBe(EXIT.usage)
    expect(bad.requests).toHaveLength(0)
    expect(bad.stderr()).toContain('${env:UNSET_TOKEN}')
  })

  it('new scaffolds a file', async () => {
    const dir = tempDir()
    const h = harness({ env, tty: true })
    expect(await h.run('config', 'new', 'workflow', 'Invoice approval', '--dir', dir, '--format', 'yaml')).toBe(0)
    const [file] = readdirSync(join(dir, 'workflows'))
    expect(file).toMatch(/^invoice-approval-[0-9a-f]{8}\.yaml$/)
    const doc = YAML.parse(readFileSync(join(dir, 'workflows', file), 'utf8'))
    expect(doc.asset.nodes[0].type).toBe('manual')
    expect(doc.id).toBe(doc.asset.id)
    expect(h.requests).toHaveLength(0)
  })
})
