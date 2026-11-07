import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/deletion-queue', () => ({
  enqueueDeletionJob: vi.fn(async () => {}),
  kickDeletionProcessor: vi.fn(),
  processDeletionQueueBatch: vi.fn(async () => ({ processed: 0, results: [] })),
}))

import { encryptSensitiveFields } from '@/lib/secret-fields'
import type { ServiceContext } from '@/lib/services/context'
import * as references from '@/lib/services/references'
import * as connectors from '@/lib/services/connectors'
import { runCustomReference } from '@/lib/custom-references/run'
import { normalizeCustomConfig } from '@/lib/custom-references/normalize'
import { scrubSecretsForExport } from '@/lib/portability/scrub'
import { createEmptyAssetIdMaps, remapKnownIds } from '@/lib/portability/id-maps'
import { createMemorySupabase } from './fixtures/supabase-memory'

const ALL = ['integrations.view', 'integrations.create', 'integrations.edit', 'integrations.test', 'integrations.manage_references']

function context(supabase: ReturnType<typeof createMemorySupabase>, permissions: string[] = ALL): ServiceContext {
  return { supabase: supabase as unknown as ServiceContext['supabase'], tenantId: 'tenant-a', actorId: 'user-1', permissions: new Set(permissions), authKind: 'api_key', source: 'api' }
}

const LIST_OBJECTS = {
  id: 'ref-list', tenant_id: 'tenant-a', integration_id: 'int-s3', name: 'S3: List Objects',
  inputs: [
    { id: 'i1', name: 'bucket', type: 'string', required: true, location: 'path' },
    { id: 'i2', name: 'prefix', type: 'string', location: 'query' },
  ],
  outputs: [],
  request_config: { method: 'GET', path_template: '/{{bucket}}?list-type=2', body_template: '', headers: {} } as Record<string, any>,
}

const CUSTOM_RAW = {
  kind: 'list',
  source: { type: 'operation', reference_id: 'ref-list', params: [{ name: 'bucket', value: '{{input.bucket}}' }, { name: 'prefix', value: '{{input.prefix}}' }] },
  inputs: [
    { name: 'bucket', type: 'string', mode: 'fixed', fixed_value: 'docs' },
    { name: 'prefix', type: 'string', mode: 'ask', description: 'Key prefix' },
  ],
  rows_path: 'Contents',
  columns: [{ path: 'Key', alias: 'key', type: 'string' }, { path: 'Size', alias: 'size', type: 'integer' }, { path: 'LastModified', alias: 'last_modified', type: 'date' }],
  sort: [{ field: 'last_modified', direction: 'desc' }],
}

function seed() {
  return createMemorySupabase({
    integrations: [
      { id: 'int-s3', tenant_id: 'tenant-a', name: 'S3', type: 'rest_api', is_active: true, config: encryptSensitiveFields({ base_url: 'https://s3.example.com', auth_type: 'bearer', auth_config: { token: 'tok-plain' } }) },
      { id: 'int-ai', tenant_id: 'tenant-a', name: 'OpenAI (Connector)', type: 'openai', is_active: true, config: { base_url: 'https://api.openai.com/v1' } },
      { id: 'int-x', tenant_id: 'tenant-b', name: 'Other', type: 'rest_api', is_active: true, config: { base_url: 'https://b.example.com' } },
    ],
    integration_references: [
      LIST_OBJECTS,
      { id: 'ref-x', tenant_id: 'tenant-b', integration_id: 'int-x', name: 'Foreign', inputs: [], request_config: { method: 'GET', path_template: '/x' } },
    ],
    tenant_connectors: [
      { id: 'conn-ai', tenant_id: 'tenant-a', connector_key: 'openai', display_name: 'OpenAI', integration_id: 'int-ai', is_enabled: true, config: {}, credentials: encryptSensitiveFields({ api_key: 'sk-live-secret' }) },
    ],
  })
}

let supabase: ReturnType<typeof createMemorySupabase>
beforeEach(() => { supabase = seed() })

const row = (id: string) => supabase.tables.integration_references.find((r: any) => r.id === id) as any

describe('custom references service: save', () => {
  it('materialises the source on the server and publishes only Ask inputs, typed outputs and a projection model', async () => {
    const created = await references.createReference(context(supabase), 'int-s3', {
      name: 'Recent documents',
      // A client-supplied host is never used: the request is copied from the source reference.
      request_config: { origin: 'custom', custom: CUSTOM_RAW, base_url: 'https://evil.example.com', path_template: '/steal' },
    })
    const stored = row(created.id)
    expect(stored.request_config).toMatchObject({ method: 'GET', path_template: '/{{bucket}}?list-type=2', origin: 'custom' })
    expect(stored.request_config.base_url).toBeUndefined()
    expect(stored.request_config.custom.source).toMatchObject({ type: 'operation', from: 'reference', label: 'S3: List Objects' })
    expect(stored.request_config.custom.source.reference_id).toBeUndefined() // never an id the importer would remap
    expect(stored.inputs.map((i: any) => i.name)).toEqual(['prefix'])
    expect(stored.outputs.map((o: any) => o.name)).toEqual(['key', 'size', 'last_modified'])
    expect(stored.request_config.response_schema.root.items.fields.map((f: any) => f.name)).toEqual(['key', 'size', 'last_modified'])
  })

  it('changing a Fixed value updates the reference; public inputs stay the same (usages pick it up)', async () => {
    const created = await references.createReference(context(supabase), 'int-s3', { name: 'Docs', request_config: { origin: 'custom', custom: CUSTOM_RAW } })
    const before = JSON.parse(JSON.stringify(row(created.id)))
    const custom = { ...before.request_config.custom, inputs: [{ ...before.request_config.custom.inputs[0], fixed_value: 'archive' }, before.request_config.custom.inputs[1]] }
    await references.updateReference(context(supabase), created.id, { request_config: { origin: 'custom', custom } })
    const after = row(created.id)
    expect(after.request_config.custom.inputs[0].fixed_value).toBe('archive')
    expect(after.request_config.path_template).toBe('/{{bucket}}?list-type=2') // stored source kept
    expect(after.inputs).toEqual(before.inputs) // ids stable
  })

  it('refuses a secret typed as a plain Fixed value, and sources from other integrations / tenants', async () => {
    const secret = { ...CUSTOM_RAW, inputs: [...CUSTOM_RAW.inputs, { name: 'api_key', type: 'string', mode: 'fixed', fixed_value: 'sk-1' }] }
    await expect(references.createReference(context(supabase), 'int-s3', { name: 'x', request_config: { origin: 'custom', custom: secret } }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/looks like a secret/) })
    const foreign = { ...CUSTOM_RAW, source: { ...CUSTOM_RAW.source, reference_id: 'ref-x' } }
    await expect(references.createReference(context(supabase), 'int-s3', { name: 'x', request_config: { origin: 'custom', custom: foreign } }))
      .rejects.toMatchObject({ status: 400 })
  })

  it('a Fixed value may use an integration setting by name (auth_config token)', async () => {
    const custom = { ...CUSTOM_RAW, inputs: [{ name: 'bucket', type: 'string', mode: 'fixed', fixed_setting: 'token' }, CUSTOM_RAW.inputs[1]] }
    const created = await references.createReference(context(supabase), 'int-s3', { name: 'x', request_config: { origin: 'custom', custom } })
    expect(row(created.id).request_config.custom.inputs[0]).toEqual({ name: 'bucket', type: 'string', mode: 'fixed', fixed_setting: 'token' })
    const bad = { ...CUSTOM_RAW, inputs: [{ name: 'bucket', type: 'string', mode: 'fixed', fixed_setting: 'nope' }, CUSTOM_RAW.inputs[1]] }
    await expect(references.createReference(context(supabase), 'int-s3', { name: 'y', request_config: { origin: 'custom', custom: bad } })).rejects.toMatchObject({ status: 400 })
  })

  it('duplicate as custom starts from the reference (inputs asked and passed through)', async () => {
    ;(supabase.tables.integration_references[0] as any).request_config.response_schema = {
      version: 1, source: 'sample', root: { type: 'object', fields: [{ name: 'Contents', type: 'array', items: { type: 'object', fields: [{ name: 'Key', type: 'string' }, { name: 'Size', type: 'integer' }] } }] },
    }
    const created = await references.duplicateAsCustom(context(supabase), 'ref-list')
    const stored = row(created.id)
    expect(stored.name).toBe('S3: List Objects (custom)')
    expect(stored.request_config.custom).toMatchObject({ kind: 'list', rows_path: 'Contents', columns: [{ path: 'Key', type: 'string' }, { path: 'Size', type: 'integer' }] })
    expect(stored.request_config.custom.source.params).toEqual([{ name: 'bucket', value: '{{input.bucket}}' }, { name: 'prefix', value: '{{input.prefix}}' }])
    expect(stored.inputs.map((i: any) => i.name)).toEqual(['bucket', 'prefix'])
  })
})

describe('connector references: creation modes and regeneration', () => {
  it('reference_mode none starts empty; selected generates only the chosen operations', async () => {
    const empty = await connectors.createConnector(context(supabase), { connector_key: 'openai', display_name: 'AI empty', credentials: { api_key: 'sk-1' }, reference_mode: 'none' })
    expect(empty.references_created).toBe(0)
    const some = await connectors.createConnector(context(supabase), { connector_key: 'openai', display_name: 'AI some', credentials: { api_key: 'sk-1' }, reference_mode: 'selected', reference_template_keys: ['chat_completion'] })
    expect(some.references_created).toBe(1)
    await expect(connectors.createConnector(context(supabase), { connector_key: 'openai', credentials: { api_key: 'sk-1' }, reference_mode: 'selected', reference_template_keys: ['nope'] }))
      .rejects.toMatchObject({ status: 400 })
  })

  it('"Regenerate references" never deletes or overwrites custom references', async () => {
    const custom = {
      id: 'ref-custom', tenant_id: 'tenant-a', integration_id: 'int-ai', name: 'OpenAI: Chat Completion', // same name as a template on purpose
      inputs: [{ id: 'c1', name: 'prompt', type: 'string' }], outputs: [{ name: 'text', path: 'text', type: 'string' }],
      request_config: { method: 'POST', path_template: '/chat/completions', origin: 'custom', custom: { version: 1, kind: 'read', source: { type: 'operation', inputs: [], params: [] }, inputs: [{ name: 'prompt', type: 'string', mode: 'ask' }], columns: [{ path: 'choices.0.message.content', alias: 'text' }] } },
    }
    supabase.tables.integration_references.push(JSON.parse(JSON.stringify(custom)))
    supabase.tables.integration_references.push({ id: 'ref-stale', tenant_id: 'tenant-a', integration_id: 'int-ai', name: 'OpenAI: Old template', inputs: [], request_config: { method: 'GET', path_template: '/old' } })
    await connectors.regenerateConnectorReferences(context(supabase), 'conn-ai')
    const rows = supabase.tables.integration_references.filter((r: any) => r.integration_id === 'int-ai')
    expect(rows.find((r: any) => r.id === 'ref-custom')).toEqual(custom) // untouched
    expect(rows.find((r: any) => r.id === 'ref-stale')).toBeUndefined() // generated stale ones still go
    const generated = rows.filter((r: any) => r.request_config?.origin !== 'custom')
    expect(generated.some((r: any) => r.name === 'OpenAI: Chat Completion')).toBe(true) // inserted alongside, not merged
  })
})

describe('custom references runtime (executor stage)', () => {
  const stored = () => ({
    id: 'ref-c', name: 'Recent documents',
    inputs: [{ name: 'prefix', type: 'string' }],
    request_config: {
      method: 'GET', path_template: '/{{bucket}}?list-type=2', headers: {}, origin: 'custom',
      response_schema: { version: 1, source: 'manual', root: { type: 'array' } },
      custom: normalizeCustomConfig({
        ...CUSTOM_RAW,
        source: { type: 'operation', from: 'reference', label: 'S3: List Objects', inputs: LIST_OBJECTS.inputs, params: CUSTOM_RAW.source.params },
        inputs: [{ name: 'bucket', type: 'string', mode: 'fixed', fixed_setting: 'bucket_name' }, { name: 'prefix', type: 'string' }, { name: 'token_value', type: 'string', mode: 'fixed', fixed_setting: 'api_token' }],
        filter: { op: 'and', conditions: [{ field: 'Key', operator: 'starts_with', value: '{{input.prefix}}' }] },
      }) as any,
    },
  })

  it('callers cannot override Fixed inputs, unknown inputs are dropped, the source request is the stored one, the result is shaped', async () => {
    const runSource = vi.fn(async (_sourceRef: any, values: any) => ({
      status: 200,
      data: { Contents: [{ Key: 'a/1', Size: 1, LastModified: '2026-01-01', Secret: 'x' }, { Key: 'b/2', Size: 2, LastModified: '2026-01-02' }, { Key: 'a/3', Size: 3, LastModified: '2026-01-03' }] },
      log: { integrationId: 'int-s3', tenantId: 'tenant-a', method: 'GET', url: `https://s3.example.com/${values.bucket}?list-type=2&key=s3cr3t-token` },
    }))
    const result = await runCustomReference({
      ref: stored(),
      integrationConfig: {},
      inputValues: { prefix: 'a/', bucket: 'attacker-bucket', token_value: 'mine', extra: 'dropped' },
      loadSettings: async () => ({ bucket_name: 'docs', api_token: 's3cr3t-token' }),
      runSource,
    })
    const [sourceRef, values] = runSource.mock.calls[0] as any[]
    expect(values).toEqual({ bucket: 'docs', prefix: 'a/' })
    expect(sourceRef.request_config).toEqual({ method: 'GET', path_template: '/{{bucket}}?list-type=2', headers: {} })
    expect(sourceRef.inputs.map((i: any) => i.name)).toEqual(['bucket', 'prefix'])
    expect(result.data).toEqual([
      { key: 'a/3', size: 3, last_modified: '2026-01-03' },
      { key: 'a/1', size: 1, last_modified: '2026-01-01' },
    ])
    // A credential used by a Fixed input never shows in the logged URL or the result.
    expect(result.log?.url).not.toContain('s3cr3t-token')
    expect(JSON.stringify(result)).not.toContain('s3cr3t-token')
  })

  it('filter values from inputs cannot inject: they are compared as data', async () => {
    const runSource = vi.fn(async () => ({ status: 200, data: { Contents: [{ Key: 'a', Size: 1 }, { Key: "' OR 1=1 --", Size: 2 }] } }))
    const result = await runCustomReference({
      ref: stored(), integrationConfig: {}, inputValues: { prefix: "' OR 1=1 --" },
      loadSettings: async () => ({ bucket_name: 'docs', api_token: 't' }), runSource,
    })
    expect((result.data as any[]).map((r) => r.key)).toEqual(["' OR 1=1 --"])
  })

  it('source errors pass through unshaped; read not-found = error becomes 404', async () => {
    const failing = await runCustomReference({ ref: stored(), integrationConfig: {}, inputValues: {}, loadSettings: async () => ({ bucket_name: 'd', api_token: 't' }), runSource: async () => ({ status: 403, data: { error: 'denied' }, error_message: 'denied' }) })
    expect(failing).toMatchObject({ status: 403, error_message: 'denied' })
    const read = stored()
    read.request_config.custom = normalizeCustomConfig({ ...read.request_config.custom, kind: 'read', read: { key_input: 'prefix', key_field: 'Key', not_found: 'error' }, filter: undefined }) as any
    const missing = await runCustomReference({ ref: read, integrationConfig: {}, inputValues: { prefix: 'zzz' }, loadSettings: async () => ({ bucket_name: 'd', api_token: 't' }), runSource: async () => ({ status: 200, data: { Contents: [{ Key: 'a' }] } }) })
    expect(missing).toMatchObject({ status: 404, data: null, error_message: 'No matching record' })
  })

  it('table sources run ONE parameterised SQL query through the executor (plus COUNT for totals)', async () => {
    const ref = {
      id: 'ref-t', name: 'Customers', inputs: [],
      request_config: {
        method: 'POST', path_template: '/_internal/db/query', origin: 'custom',
        custom: normalizeCustomConfig({
          kind: 'list', include_total: true,
          source: { type: 'table', schema: 'public', table: 'customers', columns: [{ name: 'country', type: 'text' }] },
          inputs: [{ name: 'q', type: 'string' }], columns: [{ path: 'country' }], distinct: true,
          filter: { op: 'and', conditions: [{ field: 'country', operator: 'contains', value: '{{input.q}}' }] },
        }),
      },
    }
    const runSource = vi.fn(async (sourceRef: any, _values: any) => ({ status: 200, data: JSON.parse(sourceRef.request_config.body_template).sql.startsWith('SELECT COUNT') ? [{ total: '2' }] : [{ country: 'AU' }, { country: 'NZ' }] }))
    const result = await runCustomReference({ ref, integrationConfig: { db_config: { db_type: 'postgres' } }, inputValues: { q: "x'--" }, loadSettings: async () => ({}), runSource })
    expect(runSource).toHaveBeenCalledTimes(2)
    const [sourceRef, values] = runSource.mock.calls[0] as any[]
    expect(JSON.parse(sourceRef.request_config.body_template).sql).toBe(`SELECT DISTINCT "country" FROM "public"."customers" WHERE LOWER(CAST("country" AS text)) LIKE {{cv0}} ESCAPE '!' ORDER BY "country" ASC LIMIT 100`)
    expect(values).toEqual({ cv0: "%x'--%" })
    expect(result.data).toEqual({ rows: [{ country: 'AU' }, { country: 'NZ' }], total: 2 })
  })
})

describe('custom references: portability round trip', () => {
  it('export scrubbing and import id remapping keep the shaping config intact', async () => {
    const created = await references.createReference(context(supabase), 'int-s3', { name: 'Docs', request_config: { origin: 'custom', custom: { ...CUSTOM_RAW, inputs: [...CUSTOM_RAW.inputs, { name: 'next_token', type: 'string', mode: 'ask' }] } } })
    const original = JSON.parse(JSON.stringify(row(created.id)))
    const exported = scrubSecretsForExport(JSON.parse(JSON.stringify(original)))
    expect(exported.request_config.custom).toEqual(original.request_config.custom)
    const maps = createEmptyAssetIdMaps()
    maps.reference['ref-list'] = 'ref-new'
    maps.integration['int-s3'] = 'int-new'
    const imported = remapKnownIds(JSON.parse(JSON.stringify(exported.request_config)), maps)
    expect(imported.custom).toEqual(original.request_config.custom)
    // Re-normalising the imported config (the runtime does) yields the same config.
    expect(normalizeCustomConfig(imported.custom, { allowNoColumns: true })).toEqual(imported.custom)
  })
})
