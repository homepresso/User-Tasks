import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => {
  // 32-byte key so credentials really are encrypted at rest here.
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { writeAudit } from '@/lib/audit-log'
import { recordAssetChange } from '@/lib/github-sync/enqueue'
import { GET as listRoute, POST as createRoute } from '@/app/api/v1/log-destinations/route'
import { GET as statusRoute } from '@/app/api/v1/log-destinations/[id]/status/route'
import { createMcpServer } from '@/lib/mcp/server'
import { PERMISSION_KEYS } from '@/lib/permissions'
import { buildTenantExport } from '@/lib/portability/export'
import { decryptSecret } from '@/lib/secret-crypto'
import { applyConfig, exportConfig } from '@/lib/services/config'
import type { ServiceContext } from '@/lib/services/context'
import {
  createLogDestination,
  deleteLogDestination,
  getLogDestination,
  getLogDestinationStatus,
  listLogDestinations,
  resetLogDestinationCursor,
  updateLogDestination,
} from '@/lib/services/log-destinations'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const A = 'tenant-a'
const B = 'tenant-b'
const WF_A = 'a0000000-0000-4000-8000-000000000001'
const PUBLIC_URL = 'https://93.184.216.34:8088' // IP literal: no DNS in tests
const TOKEN = 'hec-token-very-secret'
const API_KEY = 'dd-api-key-very-secret'

function seed() {
  const events = [
    { id: 10, tenant_id: A, occurred_at: new Date(Date.now() - 120_000).toISOString(), type: 'workflow.run.started', category: 'workflow', severity: 'info' },
    { id: 11, tenant_id: B, occurred_at: new Date(Date.now() - 60_000).toISOString(), type: 'workflow.run.started', category: 'workflow', severity: 'info' },
    { id: 12, tenant_id: A, occurred_at: new Date(Date.now() - 30_000).toISOString(), type: 'task.completed', category: 'task', severity: 'info' },
  ]
  return createMemorySupabase({
    event_stream: events,
    workflows: [{ id: WF_A, tenant_id: A, name: 'Notify', nodes: [], edges: [], trigger_type: 'manual', trigger_config: {}, is_active: false }],
  }, { uuids: true })
}
type Db = ReturnType<typeof seed>

const ALL = [...PERMISSION_KEYS]
function ctx(db: Db, permissions: readonly string[] = ALL, tenantId = A): ServiceContext {
  return { supabase: db as unknown as ServiceContext['supabase'], tenantId, actorId: 'user-1', permissions: new Set(permissions), authKind: 'api_key', source: 'api' }
}

const splunk = (overrides: Record<string, unknown> = {}) => ({
  name: 'Splunk prod', type: 'splunk_hec', config: { url: PUBLIC_URL, index: 'usertasks' }, credentials: { token: TOKEN }, ...overrides,
})

const stored = (db: Db, id: string) => db.tables.log_destinations.find((r) => r.id === id)!

beforeEach(() => {
  vi.mocked(writeAudit).mockClear()
  vi.mocked(recordAssetChange).mockClear()
  delete process.env.ALLOW_PRIVATE_EGRESS
})
afterEach(() => { delete process.env.ALLOW_PRIVATE_EGRESS })

// ─── Validation ───

describe('per-type validation', () => {
  it('splunk_hec: url + token required, defaults applied, unknown keys rejected', async () => {
    const db = seed()
    const { log_destination: d } = await createLogDestination(ctx(db), splunk())
    expect(d.config).toEqual({ url: PUBLIC_URL, index: 'usertasks', verify_tls: true })
    await expect(createLogDestination(ctx(db), splunk({ name: 'x', credentials: {} }))).rejects.toMatchObject({ status: 400, message: expect.stringContaining('credentials.token') })
    await expect(createLogDestination(ctx(db), splunk({ name: 'y', config: { index: 'a' } }))).rejects.toMatchObject({ status: 400, message: expect.stringContaining('config.url') })
    await expect(createLogDestination(ctx(db), splunk({ name: 'z', config: { url: PUBLIC_URL, token: TOKEN } }))).rejects.toMatchObject({ status: 400 })
    await expect(createLogDestination(ctx(db), splunk({ name: 'w', type: 'carrier_pigeon' }))).rejects.toMatchObject({ status: 400, message: expect.stringContaining('type') })
  })

  it('datadog: api_key required; site aliases and enum', async () => {
    const db = seed()
    const { log_destination: d } = await createLogDestination(ctx(db), { name: 'DD', type: 'datadog', config: { site: 'eu', service: 'tasks', tags: ['env:prod'] }, credentials: { api_key: API_KEY } })
    expect(d.config).toEqual({ site: 'datadoghq.eu', service: 'tasks', tags: ['env:prod'] })
    const { log_destination: dflt } = await createLogDestination(ctx(db), { name: 'DD2', type: 'datadog', config: {}, credentials: { api_key: API_KEY } })
    expect(dflt.config.site).toBe('datadoghq.com')
    await expect(createLogDestination(ctx(db), { name: 'DD3', type: 'datadog', config: { site: 'datadoghq.cn' }, credentials: { api_key: API_KEY } })).rejects.toMatchObject({ status: 400 })
    await expect(createLogDestination(ctx(db), { name: 'DD4', type: 'datadog', config: {} })).rejects.toMatchObject({ status: 400 })
  })

  it('otlp_http: endpoint + optional secret headers and resource attributes', async () => {
    const db = seed()
    const { log_destination: d } = await createLogDestination(ctx(db), {
      name: 'Collector', type: 'otlp_http',
      config: { endpoint: 'https://93.184.216.34:4318', resource_attributes: { 'deployment.environment': 'prod' } },
      credentials: { headers: { 'x-honeycomb-team': 'hc-secret' } },
    })
    expect(d.credentials).toEqual({ headers: { 'x-honeycomb-team': '__SECRET__' } })
    await expect(createLogDestination(ctx(db), { name: 'C2', type: 'otlp_http', config: { endpoint: 'https://93.184.216.34' }, credentials: { headers: { 'bad header': 'v' } } })).rejects.toMatchObject({ status: 400 })
  })

  it('webhook: a signing secret is generated and shown only once', async () => {
    const db = seed()
    const created = await createLogDestination(ctx(db), { name: 'Hook', type: 'webhook', config: { url: 'https://93.184.216.34/hook' } })
    expect(created.signing_secret).toMatch(/^whsec_[A-Za-z0-9_-]{40,}$/)
    expect(created.log_destination.credentials).toEqual({ signing_secret: '__SECRET__' })
    const again = await getLogDestination(ctx(db), created.log_destination.id)
    expect(JSON.stringify(again)).not.toContain(created.signing_secret!)
    const own = await createLogDestination(ctx(db), { name: 'Hook2', type: 'webhook', config: { url: 'https://93.184.216.34/hook' }, credentials: { signing_secret: 'my-own-signing-secret-123' } })
    expect(own.signing_secret).toBeUndefined()
    await expect(createLogDestination(ctx(db), { name: 'Hook3', type: 'webhook', config: { url: 'https://93.184.216.34/h' }, credentials: { signing_secret: 'short' } })).rejects.toMatchObject({ status: 400 })
  })

  it('filters: categories, globs, severity and workflow ids are validated', async () => {
    const db = seed()
    const ok = await createLogDestination(ctx(db), splunk({ filters: { categories: ['workflow'], types: ['workflow.run.*'], min_severity: 'warn', workflow_ids: [WF_A] } }))
    expect(ok.log_destination.filters).toEqual({ categories: ['workflow'], types: ['workflow.run.*'], min_severity: 'warn', workflow_ids: [WF_A] })
    await expect(createLogDestination(ctx(db), splunk({ name: 'f1', filters: { categories: ['nope'] } }))).rejects.toMatchObject({ status: 400 })
    await expect(createLogDestination(ctx(db), splunk({ name: 'f2', filters: { types: ['Workflow Run'] } }))).rejects.toMatchObject({ status: 400 })
    await expect(createLogDestination(ctx(db), splunk({ name: 'f3', filters: { workflow_ids: ['x'] } }))).rejects.toMatchObject({ status: 400 })
  })

  it('names are unique per tenant', async () => {
    const db = seed()
    await createLogDestination(ctx(db), splunk())
    // The memory fixture has no unique index: simulate PostgREST's 23505.
    const from = db.from
    db.from = ((table: string) => {
      const builder = from(table)
      if (table !== 'log_destinations') return builder
      const insert = builder.insert
      builder.insert = (payload: unknown) => { insert(payload); return { select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate' } }) }) } }
      return builder
    }) as typeof db.from
    await expect(createLogDestination(ctx(db), splunk())).rejects.toMatchObject({ status: 409 })
  })
})

// ─── Egress ───

describe('egress policy', () => {
  it.each([
    ['http://93.184.216.34:8088', 'https'],
    ['https://127.0.0.1:8088', 'private'],
    ['https://10.0.0.5', 'private'],
    ['https://localhost:8088', 'internal'],
    ['https://169.254.169.254/latest', 'metadata'],
    ['ftp://93.184.216.34', 'http'],
  ])('rejects %s', async (url, reason) => {
    const db = seed()
    await expect(createLogDestination(ctx(db), splunk({ config: { url } }))).rejects.toMatchObject({ status: 400, message: expect.stringContaining(reason) })
    expect(db.tables.log_destinations ?? []).toHaveLength(0)
  })

  it('ALLOW_PRIVATE_EGRESS permits http and private hosts, never cloud metadata', async () => {
    process.env.ALLOW_PRIVATE_EGRESS = 'true'
    const db = seed()
    await expect(createLogDestination(ctx(db), splunk({ config: { url: 'http://127.0.0.1:8088' } }))).resolves.toBeDefined()
    await expect(createLogDestination(ctx(db), splunk({ name: 'meta', config: { url: 'http://169.254.169.254' } }))).rejects.toMatchObject({ status: 400 })
  })

  it('re-checks URLs on update', async () => {
    const db = seed()
    const { log_destination: d } = await createLogDestination(ctx(db), splunk())
    await expect(updateLogDestination(ctx(db), d.id, { config: { url: 'https://192.168.1.10:8088' } })).rejects.toMatchObject({ status: 400 })
    expect(stored(db, d.id).config.url).toBe(PUBLIC_URL)
  })
})

// ─── Secrets ───

describe('credential masking and preservation', () => {
  it('stores credentials encrypted and only ever returns __SECRET__', async () => {
    const db = seed()
    const { log_destination: d } = await createLogDestination(ctx(db), splunk())
    expect(d.credentials).toEqual({ token: '__SECRET__' })
    const row = stored(db, d.id)
    expect(row.credentials.token).toMatch(/^enc:v1:/)
    expect(decryptSecret(row.credentials.token)).toBe(TOKEN)
    for (const read of [await getLogDestination(ctx(db), d.id), await listLogDestinations(ctx(db), { limit: 50, offset: 0 })]) {
      expect(JSON.stringify(read)).not.toContain(TOKEN)
      expect(JSON.stringify(read)).not.toContain('enc:v1:')
    }
    const audits = JSON.stringify(vi.mocked(writeAudit).mock.calls)
    expect(audits).not.toContain(TOKEN)
  })

  it('__SECRET__ keeps a stored value, a new value replaces it, null removes a header', async () => {
    const db = seed()
    const { log_destination: d } = await createLogDestination(ctx(db), {
      name: 'OTel', type: 'otlp_http', config: { endpoint: 'https://93.184.216.34:4318' },
      credentials: { headers: { 'x-api-key': 'key-one', 'x-org': 'org-one' } },
    })
    const kept = await updateLogDestination(ctx(db), d.id, { credentials: { headers: { 'x-api-key': '__SECRET__', 'x-org': '__SECRET__' } } })
    expect(kept.changed).toBe(false)
    await updateLogDestination(ctx(db), d.id, { credentials: { headers: { 'x-api-key': '__SECRET__', 'x-org': 'org-two', 'x-new': 'new' } } })
    let headers = stored(db, d.id).credentials.headers
    expect(Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, decryptSecret(v as string)]))).toEqual({ 'x-api-key': 'key-one', 'x-org': 'org-two', 'x-new': 'new' })
    await updateLogDestination(ctx(db), d.id, { credentials: { headers: { 'x-api-key': '__SECRET__' } } })
    headers = stored(db, d.id).credentials.headers
    expect(Object.keys(headers)).toEqual(['x-api-key'])

    const { log_destination: s } = await createLogDestination(ctx(db), splunk())
    await updateLogDestination(ctx(db), s.id, { credentials: { token: 'rotated-token' } })
    expect(decryptSecret(stored(db, s.id).credentials.token)).toBe('rotated-token')
    await expect(updateLogDestination(ctx(db), s.id, { credentials: { token: null } as never })).rejects.toMatchObject({ status: 400 })
  })

  it('round-trips: a fetched destination sent back is unchanged', async () => {
    const db = seed()
    const { log_destination: d } = await createLogDestination(ctx(db), splunk({ filters: { categories: ['workflow', 'task'] } }))
    const fetched = (await getLogDestination(ctx(db), d.id)).log_destination
    const result = await updateLogDestination(ctx(db), d.id, fetched)
    expect(result.changed).toBe(false)
    expect(decryptSecret(stored(db, d.id).credentials.token)).toBe(TOKEN)
  })

  it('merges config (null removes a key), replaces filters, rejects a type change', async () => {
    const db = seed()
    const { log_destination: d } = await createLogDestination(ctx(db), splunk())
    const { log_destination: u, changed } = await updateLogDestination(ctx(db), d.id, { config: { index: null, sourcetype: 'ut:event' } as never, filters: { categories: ['workflow'] } })
    expect(changed).toBe(true)
    expect(u.config).toEqual({ url: PUBLIC_URL, verify_tls: true, sourcetype: 'ut:event' })
    expect(u.filters).toEqual({ categories: ['workflow'] })
    await expect(updateLogDestination(ctx(db), d.id, { type: 'datadog' })).rejects.toMatchObject({ status: 400 })
  })

  it('pausing and resuming maps to status', async () => {
    const db = seed()
    const { log_destination: d } = await createLogDestination(ctx(db), splunk())
    expect((await updateLogDestination(ctx(db), d.id, { enabled: false })).log_destination.status).toBe('disabled')
    stored(db, d.id).consecutive_failures = 4
    const resumed = (await updateLogDestination(ctx(db), d.id, { enabled: true })).log_destination
    expect(resumed).toMatchObject({ status: 'healthy', consecutive_failures: 0, enabled: true })
  })
})

// ─── Permissions & isolation ───

describe('permissions', () => {
  const READ = ['observability.view']
  const WRITE = ['observability.view', 'settings.edit']

  it('reads need observability.view', async () => {
    const db = seed()
    const { log_destination: d } = await createLogDestination(ctx(db), splunk())
    await expect(listLogDestinations(ctx(db, ['settings.view', 'settings.edit']), { limit: 50, offset: 0 })).rejects.toMatchObject({ status: 403 })
    await expect(getLogDestination(ctx(db, ['settings.edit']), d.id)).rejects.toMatchObject({ status: 403 })
    await expect(getLogDestinationStatus(ctx(db, ['settings.view']), d.id)).rejects.toMatchObject({ status: 403 })
    await expect(getLogDestination(ctx(db, READ), d.id)).resolves.toBeDefined()
  })

  it('writes need settings.edit and observability.view', async () => {
    const db = seed()
    const { log_destination: d } = await createLogDestination(ctx(db), splunk())
    const filters = { categories: ['workflow'] }
    await expect(createLogDestination(ctx(db, READ), splunk({ name: 'n', filters }))).rejects.toMatchObject({ status: 403, message: expect.stringContaining('settings.edit') })
    await expect(createLogDestination(ctx(db, ['settings.edit', 'settings.view']), splunk({ name: 'n', filters }))).rejects.toMatchObject({ status: 403, message: expect.stringContaining('observability.view') })
    await expect(updateLogDestination(ctx(db, READ), d.id, { name: 'x' })).rejects.toMatchObject({ status: 403 })
    await expect(deleteLogDestination(ctx(db, READ), d.id)).rejects.toMatchObject({ status: 403 })
    await expect(resetLogDestinationCursor(ctx(db, READ), d.id, 'now')).rejects.toMatchObject({ status: 403 })
    await expect(createLogDestination(ctx(db, WRITE), splunk({ name: 'n', filters }))).resolves.toBeDefined()
  })

  it('exporting audit/security events also needs settings.view', async () => {
    const db = seed()
    await expect(createLogDestination(ctx(db, ['observability.view', 'settings.edit']), splunk())).rejects.toMatchObject({ status: 403, message: expect.stringContaining('settings.view') })
    await expect(createLogDestination(ctx(db, ['observability.view', 'settings.edit']), splunk({ filters: { categories: ['security'] } }))).rejects.toMatchObject({ status: 403 })
    const { log_destination: d } = await createLogDestination(ctx(db, ['observability.view', 'settings.edit']), splunk({ filters: { categories: ['workflow'] } }))
    await expect(updateLogDestination(ctx(db, ['observability.view', 'settings.edit']), d.id, { filters: {} })).rejects.toMatchObject({ status: 403 })
  })

  it('isolates tenants', async () => {
    const db = seed()
    const { log_destination: d } = await createLogDestination(ctx(db), splunk())
    await createLogDestination(ctx(db, ALL, B), splunk({ name: 'B splunk' }))
    const other = ctx(db, ALL, B)
    await expect(getLogDestination(other, d.id)).rejects.toMatchObject({ status: 404 })
    await expect(updateLogDestination(other, d.id, { name: 'stolen' })).rejects.toMatchObject({ status: 404 })
    await expect(deleteLogDestination(other, d.id)).rejects.toMatchObject({ status: 404 })
    await expect(getLogDestinationStatus(other, d.id)).rejects.toMatchObject({ status: 404 })
    expect((await listLogDestinations(other, { limit: 50, offset: 0 })).log_destinations.map((r) => r.name)).toEqual(['B splunk'])
    expect(stored(db, d.id).name).toBe('Splunk prod')
  })
})

// ─── Cursor & status ───

describe('cursor and status', () => {
  it('starts at now (tenant max id) or at the start of retention', async () => {
    const db = seed()
    const now = await createLogDestination(ctx(db), splunk())
    expect(now.log_destination.cursor).toBe('12')
    const all = await createLogDestination(ctx(db), splunk({ name: 'all', start_from: 'retention_start' }))
    expect(all.log_destination.cursor).toBe('9')
  })

  it('status reports lag in events and seconds for the tenant only', async () => {
    const db = seed()
    const { log_destination: d } = await createLogDestination(ctx(db), splunk({ start_from: 'retention_start' }))
    const status = await getLogDestinationStatus(ctx(db), d.id)
    expect(status).toMatchObject({ cursor: '9', latest_event_id: '12', lag_events: 2, enabled: true, status: 'healthy', events_sent: 0 })
    expect(status.lag_seconds).toBeGreaterThanOrEqual(119)
    const reset = await resetLogDestinationCursor(ctx(db), d.id, 'now')
    expect(reset.log_destination.cursor).toBe('12')
    expect(await getLogDestinationStatus(ctx(db), d.id)).toMatchObject({ lag_events: 0, lag_seconds: null })
  })

  it('delete removes the row and is audited and synced', async () => {
    const db = seed()
    const { log_destination: d } = await createLogDestination(ctx(db), splunk())
    expect(await deleteLogDestination(ctx(db), d.id)).toEqual({ deleted: true })
    expect(db.tables.log_destinations).toHaveLength(0)
    expect(vi.mocked(writeAudit).mock.calls.map(([p]) => `${p.objectType}:${p.action}`)).toEqual(['log_destination:create', 'log_destination:delete'])
    expect(vi.mocked(recordAssetChange).mock.calls.map(([p]) => `${p.assetType}:${p.action ?? 'save'}`)).toEqual(['log_destination:save', 'log_destination:delete'])
  })
})

// ─── Config as code ───

describe('config as code', () => {
  async function seededWithDestinations() {
    const db = seed()
    await createLogDestination(ctx(db), splunk({ filters: { categories: ['workflow'], workflow_ids: [WF_A] } }))
    await createLogDestination(ctx(db), { name: 'DD', type: 'datadog', config: { site: 'us5' }, credentials: { api_key: API_KEY } })
    await createLogDestination(ctx(db), { name: 'OTel', type: 'otlp_http', config: { endpoint: 'https://93.184.216.34:4318' }, credentials: { headers: { 'x-honeycomb-team': 'hc-team-secret' } } })
    const hook = await createLogDestination(ctx(db), { name: 'Hook', type: 'webhook', config: { url: 'https://93.184.216.34/h' } })
    // A legacy plaintext row (written without ENCRYPTION_KEY).
    db.tables.log_destinations.push({ ...stored(db, hook.log_destination.id), id: 'd0000000-0000-4000-8000-000000000099', name: 'Plain', credentials: { signing_secret: 'plaintext-signing-secret' } })
    return { db, signing: hook.signing_secret! }
  }

  it('never exports a credential (config export, files and tenant export)', async () => {
    const { db, signing } = await seededWithDestinations()
    const secrets = [TOKEN, API_KEY, 'hc-team-secret', signing, 'plaintext-signing-secret']
    const manifest = (await exportConfig(ctx(db), { format: 'manifest', types: ['log_destinations'] })).manifest!
    const files = (await exportConfig(ctx(db), { types: ['log-destinations'] })).files!
    const tenant = await buildTenantExport(db, A)
    for (const text of [JSON.stringify(manifest), JSON.stringify(files), JSON.stringify(tenant)]) {
      for (const secret of secrets) expect(text, secret).not.toContain(secret)
      expect(text).not.toContain('enc:v1:')
      expect(text).not.toContain('"cursor"')
    }
    expect(files.map((f) => f.path).filter((p) => p.startsWith('log-destinations/'))).toHaveLength(5)
    const splunkAsset = manifest.log_destinations.find((d: any) => d.type === 'splunk_hec')
    expect(splunkAsset).toMatchObject({ credentials: { token: '__SECRET__' }, filters: { workflow_ids: [WF_A] }, enabled: true })
    expect(manifest.log_destinations.find((d: any) => d.type === 'otlp_http').credentials).toEqual({ headers: { 'x-honeycomb-team': '__SECRET__' } })
  })

  it('skips the section without observability.view', async () => {
    const { db } = await seededWithDestinations()
    const result = await exportConfig(ctx(db, ALL.filter((p) => p !== 'observability.view')), { format: 'manifest' })
    expect(result.manifest!.log_destinations).toBeUndefined()
    expect(result.skipped.map((s) => s.section)).toContain('log_destinations')
  })

  it('applies into another tenant: created disabled without credentials, enabled once supplied; re-apply is unchanged', async () => {
    const { db } = await seededWithDestinations()
    const manifest = (await exportConfig(ctx(db), { format: 'manifest', types: ['log_destinations'] })).manifest!
    const target = ctx(db, ALL, B)

    const first = await applyConfig(target, { manifest })
    expect(first.result!.created.log_destinations).toBe(5)
    const warnings = first.warnings.filter((w) => w.asset_type === 'log_destination').map((w) => w.warning)
    expect(warnings).toHaveLength(5)
    expect(warnings.join('\n')).toContain('(headers.x-honeycomb-team)')
    const rowsB = db.tables.log_destinations.filter((r) => r.tenant_id === B)
    const byName = Object.fromEntries(rowsB.map((r) => [r.name, r]))
    expect(byName['Splunk prod']).toMatchObject({ enabled: false, status: 'disabled', credentials: {} })
    // A header named in the files but without a value here: disabled too.
    expect(byName.OTel).toMatchObject({ enabled: false, credentials: { headers: {} } })

    const again = await applyConfig(target, { manifest })
    expect(again.plan.summary.create).toBe(0)
    expect(again.plan.assets.filter((a) => a.section === 'log_destinations').every((a) => a.action === 'unchanged')).toBe(true)

    // Credentials supplied (e.g. ${env:} substituted by the CLI): enabled, encrypted.
    const withToken = structuredClone(manifest)
    withToken.log_destinations.find((d: any) => d.type === 'splunk_hec').credentials = { token: 'b-token' }
    const third = await applyConfig(target, { manifest: withToken })
    expect(third.result!.updated.log_destination).toBe(1)
    const splunkB = db.tables.log_destinations.find((r) => r.tenant_id === B && r.name === 'Splunk prod')!
    expect(splunkB).toMatchObject({ enabled: true, status: 'healthy' })
    expect(decryptSecret(splunkB.credentials.token)).toBe('b-token')
    // A later apply with the sentinel keeps the token.
    await applyConfig(target, { manifest })
    expect(decryptSecret(db.tables.log_destinations.find((r) => r.id === splunkB.id)!.credentials.token)).toBe('b-token')
  })

  it('needs settings.edit to apply', async () => {
    const { db } = await seededWithDestinations()
    const manifest = (await exportConfig(ctx(db), { format: 'manifest', types: ['log_destinations'] })).manifest!
    await expect(applyConfig(ctx(db, ALL.filter((p) => p !== 'settings.edit'), B), { manifest })).rejects.toMatchObject({ status: 403, message: expect.stringContaining('settings.edit') })
  })
})

// ─── MCP + REST ───

describe('MCP log_destinations_* tools', () => {
  it('create masks credentials; reads and writes are gated', async () => {
    const db = seed()
    const server = (permissions: string[]) => createMcpServer({ tenantId: A, supabase: db, permissions } as never)
    const call = async (permissions: string[], tool: string, args: Record<string, unknown>) => {
      const result: any = await server(permissions).callTool(tool, args)
      return { isError: Boolean(result.isError), text: result.content[0].text as string }
    }
    const created = await call(ALL, 'log_destinations_create', { name: 'Splunk', type: 'splunk_hec', config: { url: PUBLIC_URL }, credentials: { token: TOKEN } })
    expect(created.isError).toBe(false)
    expect(created.text).not.toContain(TOKEN)
    const id = JSON.parse(created.text).log_destination.id
    expect((await call(['observability.view'], 'log_destinations_get', { destination_id: id })).text).toContain('__SECRET__')
    expect((await call(['observability.view'], 'log_destinations_update', { destination_id: id, name: 'x' })).text).toContain('settings.edit')
    expect((await call(['settings.view'], 'log_destinations_list', {})).text).toContain('observability.view')
    expect(JSON.parse((await call(ALL, 'log_destinations_status', { destination_id: id })).text)).toMatchObject({ lag_events: 0 })
  })
})

describe('REST /api/v1/log-destinations', () => {
  const mockedValidate = vi.mocked(validateApiKey)
  const auth = (db: Db, permissions: string[]): ApiKeySuccessResult => ({
    success: true, tenantId: A, keyId: 'k', keyType: 'tenant', createdBy: 'u', actingUserId: null,
    scopes: { workflow_ids: [], table_ids: [] }, permissions, supabase: db as never, authKind: 'api_key', expiresAt: null,
  })
  const request = (path: string, init: { method?: string; body?: unknown } = {}) => new NextRequest(`https://app.test/api/v1${path}`, {
    method: init.method ?? 'GET', headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })

  beforeEach(() => mockedValidate.mockReset())

  it('401, 403 and 201 with a masked body', async () => {
    const db = seed()
    mockedValidate.mockResolvedValue({ success: false, response: Response.json({ success: false, error: 'Unauthorized' }, { status: 401 }) } as never)
    expect((await listRoute(request('/log-destinations'))).status).toBe(401)
    mockedValidate.mockResolvedValue(auth(db, ['observability.view']))
    expect((await createRoute(request('/log-destinations', { method: 'POST', body: splunk() }))).status).toBe(403)
    mockedValidate.mockResolvedValue(auth(db, ALL))
    const res = await createRoute(request('/log-destinations', { method: 'POST', body: splunk() }))
    expect(res.status).toBe(201)
    const text = await res.text()
    expect(text).not.toContain(TOKEN)
    const id = JSON.parse(text).data.log_destination.id
    const status = await statusRoute(request(`/log-destinations/${id}/status`), { params: Promise.resolve({ id }) })
    expect(status.status).toBe(200)
    expect((await createRoute(request('/log-destinations', { method: 'POST', body: splunk({ config: { url: 'https://127.0.0.1' } }) }))).status).toBe(400)
  })
})
