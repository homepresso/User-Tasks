import { describe, expect, it } from 'vitest'
import { applyRequirementValues, detectRequirements, isFieldRequired, nonSecretValues, requirementStatus, secretPaths } from '@/lib/packages/requirements'
import { findSecretLeaks, toPackageFiles } from '@/lib/packages/build'
import { scrubSecretsForExport, SECRET_PLACEHOLDER } from '@/lib/portability/scrub'

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

const W = '10000000-0000-4000-8000-000000000001'
const I = '10000000-0000-4000-8000-000000000002'
const C = '10000000-0000-4000-8000-000000000003'
const M = '10000000-0000-4000-8000-000000000004'
const U = '10000000-0000-4000-8000-000000000005'
const R = '10000000-0000-4000-8000-000000000006'

/** What a source workspace exports BEFORE scrubbing: real credentials everywhere. */
function rawAssets() {
  return {
    connectors: [{ id: C, name: 'Invoices DB', connector_key: 'postgres', config: { host: 'db.dev.internal', port: '5432', database: 'invoices', ssl: 'require' }, credentials: { username: 'app', password: 'hunter2' }, is_enabled: true }],
    integrations: [{ id: I, name: 'Northwind ERP', type: 'rest_api', config: { base_url: 'https://erp.dev.example', auth_type: 'bearer', auth_config: { token: 'tok-live' }, headers: { Authorization: 'Bearer tok-live', 'X-Trace': 'on' } }, is_active: true }],
    mcp_servers: [{ id: M, name: 'Docs MCP', url: 'https://mcp.example/sse', auth_type: 'bearer', auth_config: { token: 'mcp-secret' }, is_active: true }],
    workflows: [{
      id: W, name: 'Invoice approval', is_active: true,
      nodes: [
        { id: 'a', type: 'http_request', label: 'Call webhook', config: { url: '${env:HOOK_URL}', api_key: 'abc123' } },
        { id: 'b', type: 'user_task', label: 'Approve', config: { assignee_id: U, role_id: R } },
      ],
    }],
  }
}

function scrubbed() {
  const assets: any = scrubSecretsForExport(rawAssets())
  // Export puts the sentinel on every stored connector credential.
  assets.connectors[0].credentials = { username: SECRET_PLACEHOLDER, password: SECRET_PLACEHOLDER }
  return assets
}

describe('requirement detection', () => {
  const requirements = detectRequirements(scrubbed(), {
    people: [{ kind: 'user', id: U, section: 'workflows', asset_id: W, path: ['nodes', 1, 'config', 'assignee_id'] }],
    systemRoles: [{ id: R, slug: 'manager', section: 'workflows', asset_id: W, path: ['nodes', 1, 'config', 'role_id'] }],
  })
  const byKind = (kind: string) => requirements.filter((r) => r.kind === kind)

  it('turns every connector credential into a required secret field, config fields into optional env settings', () => {
    const [connector] = byKind('connector')
    expect(connector.id).toBe(`connector:connectors:${C}`)
    expect(connector.required).toBe(true)
    const keys = Object.fromEntries(connector.fields.map((f) => [f.key, f]))
    expect(keys['credentials.password']).toMatchObject({ secret: true, target: { section: 'connectors', asset_id: C, path: ['credentials', 'password'] } })
    expect(keys['credentials.username'].secret).toBe(true)
    expect(keys['config.host']).toMatchObject({ secret: false, default: 'db.dev.internal' })
    expect(isFieldRequired(connector, keys['credentials.password'])).toBe(true)
    expect(isFieldRequired(connector, keys['config.host'])).toBe(false)
  })

  it('flags integration auth (secret) and its base URL (environment-specific)', () => {
    const [integration] = byKind('integration_auth')
    const keys = integration.fields.map((f) => f.key)
    expect(keys).toEqual(expect.arrayContaining(['config.auth_config.token', 'config.headers.Authorization', 'config.base_url']))
    expect(integration.fields.find((f) => f.key === 'config.base_url')).toMatchObject({ secret: false, default: 'https://erp.dev.example' })
  })

  it('covers MCP servers, secrets inside workflow nodes, ${env:} references, people and system roles', () => {
    expect(byKind('secret').map((r) => r.ref.section).sort()).toEqual(['mcp_servers', 'workflows'])
    expect(byKind('env')[0].fields[0]).toMatchObject({ label: 'HOOK_URL', target: { path: ['nodes', 0, 'config', 'url'] } })
    expect(byKind('user')[0]).toMatchObject({ required: false, fields: [{ type: 'user', target: { path: ['nodes', 1, 'config', 'assignee_id'] } }] })
    expect(byKind('role')[0].fields[0].default).toBe('manager')
  })

  it('every secret placeholder in the package is some requirement field', () => {
    const targets = new Set(requirements.flatMap((r) => r.fields.map((f) => `${f.target.section}:${f.target.asset_id}:${f.target.path.join('.')}`)))
    const assets = scrubbed()
    for (const [section, list] of Object.entries(assets)) {
      for (const asset of list as any[]) {
        for (const path of secretPaths(asset)) expect(targets.has(`${section}:${asset.id}:${path.join('.')}`), `${section} ${path.join('.')}`).toBe(true)
      }
    }
  })

  it('status: provided / stored / default / missing, and values are written at their targets', () => {
    const connector = byKind('connector')[0]
    const none = requirementStatus([connector], {})
    expect(none[0].status).toBe('missing')
    const stored = requirementStatus([connector], {}, (_r, f) => f.key.startsWith('credentials.'))
    expect(stored[0].status).toBe('met')
    const provided = requirementStatus([connector], { [connector.id]: { 'credentials.username': 'prod', 'credentials.password': 's3cret' } })
    expect(provided[0]).toMatchObject({ status: 'met' })
    expect(provided[0].fields.find((f) => f.key === 'config.host')?.state).toBe('default')

    const assets = scrubbed()
    applyRequirementValues(assets, requirements, { [connector.id]: { 'credentials.password': 's3cret', 'config.host': 'db.prod.internal', 'config.port': '6543' } })
    expect(assets.connectors[0].credentials.password).toBe('s3cret')
    expect(assets.connectors[0].credentials.username).toBe(SECRET_PLACEHOLDER) // kept: resolves from the stored row on upgrade
    expect(assets.connectors[0].config.host).toBe('db.prod.internal')
    expect(assets.connectors[0].config.port).toBe(6543)
    // Role requirements apply their default (slug) through the resolver.
    applyRequirementValues(assets, byKind('role'), {}, (_r, _f, value) => `role-id-for-${value}`)
    expect(assets.workflows[0].nodes[1].config.role_id).toBe('role-id-for-manager')
  })

  it('only non-secret values are persisted with an install', () => {
    const connector = byKind('connector')[0]
    expect(nonSecretValues([connector], { [connector.id]: { 'credentials.password': 's3cret', 'config.host': 'db.prod.internal' } })).toEqual({ [connector.id]: { 'config.host': 'db.prod.internal' } })
  })
})

describe('secret scan', () => {
  const header = { id: '20000000-0000-4000-8000-000000000001', name: 'P', slug: 'p', version: '1.0.0', description: null, author: null, created_at: '2026-10-26T00:00:00.000Z', readme: null }

  it('a package built from a scrubbed export contains no secret', () => {
    const { files } = toPackageFiles({ header, assets: scrubbed(), data: {}, requirements: [], dependencies: [] })
    expect(findSecretLeaks(files)).toEqual([])
    const text = files.map((f) => f.content).join('\n')
    for (const secret of ['hunter2', 'tok-live', 'mcp-secret', 'abc123']) expect(text).not.toContain(secret)
  })

  it('the scan catches credentials and ciphertext that slipped through', () => {
    const leaky: any = rawAssets()
    leaky.integrations[0].config.db_config = { password: 'enc:v1:abc:def:ghi' }
    const { files } = toPackageFiles({ header, assets: leaky, data: {}, requirements: [], dependencies: [] })
    const leaks = findSecretLeaks(files)
    expect(leaks.some((l) => l.includes('password'))).toBe(true)
    expect(leaks.some((l) => l.includes('token'))).toBe(true)
    expect(leaks.some((l) => l.includes('encrypted'))).toBe(true)
  })
})
