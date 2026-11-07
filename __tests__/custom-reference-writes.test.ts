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
import { customReferenceDb, previewCustomReference } from '@/lib/services/custom-references'
import { normalizeCustomConfig } from '@/lib/custom-references/normalize'
import { resolveCustomInputs } from '@/lib/custom-references/inputs'
import { customOutputModel } from '@/lib/custom-references/model'
import { runCustomReference } from '@/lib/custom-references/run'
import { compileWriteStatement } from '@/lib/custom-references/write-sql'
import { buildRequestBody, defaultMethodFor, isSuccessStatus, mapRowColumnsToInputs, parseStatusRanges } from '@/lib/custom-references/write'
import { KIND_INFO, WRITE_KINDS, isWriteReference, referencePickerHint, type CustomReferenceConfig } from '@/lib/custom-references/types'
import type { SqlDialect } from '@/lib/custom-references/sql'
import { compileSql } from '@/lib/db-reference'
import { scrubSecretsForExport } from '@/lib/portability/scrub'
import { createEmptyAssetIdMaps, remapKnownIds } from '@/lib/portability/id-maps'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures */

const ORDERS = { type: 'table' as const, schema: 'shop', table: 'orders', columns: [{ name: 'id', type: 'integer' }, { name: 'status', type: 'text' }, { name: 'note', type: 'text' }, { name: 'customer', type: 'text' }] }
const DIALECTS: SqlDialect[] = ['postgres', 'mssql', 'mysql', 'oracle', 'snowflake']

function tableConfig(kind: CustomReferenceConfig['kind'], write: any, extra: any = {}): CustomReferenceConfig {
  return normalizeCustomConfig({
    kind,
    source: ORDERS,
    inputs: [{ name: 'order_id', type: 'integer', required: true }, { name: 'status', type: 'string' }, { name: 'note', type: 'string' }],
    columns: [],
    write,
    ...extra,
  })
}

const VALUES = { order_id: 10248, status: "shipped'); DROP TABLE orders; --", note: '' }

describe('custom reference writes: SQL per dialect', () => {
  const update = tableConfig('update', { set: [{ column: 'status', value: '{{input.status}}' }], key: [{ column: 'id', value: '{{input.order_id}}' }] })
  const insert = tableConfig('create', { set: [{ column: 'id', value: '{{input.order_id}}' }, { column: 'status', value: '{{input.status}}' }], returning: true })
  const upsert = tableConfig('upsert', { set: [{ column: 'status', value: '{{input.status}}' }], key: [{ column: 'id', value: '{{input.order_id}}' }] })
  const del = tableConfig('delete', { key: [{ column: 'id', value: '{{input.order_id}}' }] })

  it('INSERT / UPDATE / DELETE: quoted introspected names, every value a bound token', () => {
    expect(compileWriteStatement(update, VALUES, 'postgres')).toMatchObject({
      sql: 'UPDATE "shop"."orders" SET "status" = {{cv0}} WHERE "id" = {{cv1}}',
      values: { cv0: VALUES.status, cv1: 10248 },
      statement: 'update',
    })
    expect(compileWriteStatement(insert, VALUES, 'postgres').sql).toBe('INSERT INTO "shop"."orders" ("id", "status") VALUES ({{cv0}}, {{cv1}}) RETURNING "id", "status", "note", "customer"')
    expect(compileWriteStatement(insert, VALUES, 'mssql').sql).toBe('INSERT INTO [shop].[orders] ([id], [status]) OUTPUT INSERTED.[id], INSERTED.[status], INSERTED.[note], INSERTED.[customer] VALUES ({{cv0}}, {{cv1}})')
    expect(compileWriteStatement(insert, VALUES, 'mysql').sql).toBe('INSERT INTO `shop`.`orders` (`id`, `status`) VALUES ({{cv0}}, {{cv1}})')
    expect(compileWriteStatement(del, VALUES, 'mssql').sql).toBe('DELETE FROM [shop].[orders] WHERE [id] = {{cv0}}')
    expect(compileWriteStatement(del, VALUES, 'oracle').sql).toBe('DELETE FROM "shop"."orders" WHERE "id" = {{cv0}}')
  })

  it('upsert is dialect-correct: ON CONFLICT, ON DUPLICATE KEY, MERGE', () => {
    expect(compileWriteStatement(upsert, VALUES, 'postgres').sql).toBe('INSERT INTO "shop"."orders" ("id", "status") VALUES ({{cv0}}, {{cv1}}) ON CONFLICT ("id") DO UPDATE SET "status" = EXCLUDED."status"')
    expect(compileWriteStatement(upsert, VALUES, 'mysql').sql).toBe('INSERT INTO `shop`.`orders` (`id`, `status`) VALUES ({{cv0}}, {{cv1}}) ON DUPLICATE KEY UPDATE `status` = VALUES(`status`)')
    expect(compileWriteStatement(upsert, VALUES, 'mssql').sql).toBe('MERGE INTO [shop].[orders] WITH (HOLDLOCK) AS tgt USING (SELECT {{cv0}} AS [id], {{cv1}} AS [status]) AS src ON tgt.[id] = src.[id] WHEN MATCHED THEN UPDATE SET tgt.[status] = src.[status] WHEN NOT MATCHED THEN INSERT ([id], [status]) VALUES (src.[id], src.[status]);')
    expect(compileWriteStatement(upsert, VALUES, 'oracle').sql).toBe('MERGE INTO "shop"."orders" tgt USING (SELECT {{cv0}} AS "id", {{cv1}} AS "status" FROM dual) src ON (tgt."id" = src."id") WHEN MATCHED THEN UPDATE SET tgt."status" = src."status" WHEN NOT MATCHED THEN INSERT ("id", "status") VALUES (src."id", src."status")')
    expect(compileWriteStatement(upsert, VALUES, 'snowflake').sql).toBe('MERGE INTO "shop"."orders" AS tgt USING (SELECT {{cv0}} AS "id", {{cv1}} AS "status") AS src ON tgt."id" = src."id" WHEN MATCHED THEN UPDATE SET tgt."status" = src."status" WHEN NOT MATCHED THEN INSERT ("id", "status") VALUES (src."id", src."status")')
  })

  it('the binder turns tokens into driver parameters per dialect — the hostile value never reaches the SQL text', () => {
    const placeholders: Record<SqlDialect, RegExp> = { postgres: /\$2/, mssql: /@_in2/, mysql: /\?/, oracle: /:in_2/, snowflake: /\?/ }
    for (const dialect of DIALECTS) {
      for (const config of [update, insert, upsert, del]) {
        const c = compileWriteStatement(config, VALUES, dialect)
        const bound = compileSql(c.sql, dialect, c.values, c.inputs, undefined, 5000)
        expect(bound.sql, dialect).not.toContain('DROP TABLE')
        expect(bound.sql, dialect).not.toMatch(/\{\{/)
        expect(JSON.stringify(bound.params), dialect).toContain(config === del ? '10248' : 'DROP TABLE')
        if (config === update) expect(bound.sql, dialect).toMatch(placeholders[dialect])
      }
    }
  })

  it('column names are introspected only; quote characters and token braces are refused', () => {
    expect(() => tableConfig('update', { set: [{ column: 'status"; DROP TABLE x; --', value: '1' }], key: [{ column: 'id', value: '1' }] })).toThrow(/not a column/)
    const hostile = normalizeCustomConfig({
      kind: 'update', source: { ...ORDERS, columns: [...ORDERS.columns, { name: 'a"b' }, { name: '{{cv0}}' }] }, inputs: [], columns: [],
      write: { set: [{ column: 'a"b', value: 'x' }], key: [{ column: 'id', value: '1' }] },
    })
    expect(() => compileWriteStatement(hostile, {}, 'postgres')).toThrow(/not a valid name/)
    const braces = normalizeCustomConfig({ ...hostile, write: { set: [{ column: '{{cv0}}', value: 'x' }], key: [{ column: 'id', value: '1' }] } })
    expect(() => compileWriteStatement(braces, {}, 'postgres')).toThrow(/not a valid name/)
  })

  it('EXECUTE: introspected procedure and parameters, values bound (pg function / procedure, MSSQL EXEC, MySQL CALL, Oracle block)', () => {
    const exec = (routine_type: 'function' | 'procedure') => normalizeCustomConfig({
      kind: 'execute', source: { type: 'table', table: '', columns: [] }, inputs: [{ name: 'order_id', type: 'integer' }, { name: 'reason', type: 'string' }], columns: [],
      write: { procedure: { schema: 'shop', name: 'cancel_order', routine_type, params: [{ name: 'p_order', value: '{{input.order_id}}' }, { name: 'p_reason', value: '{{input.reason}}' }, { name: 'p_result', is_output: true }] } },
    })
    const v = { order_id: 7, reason: "x'); DELETE FROM orders; --" }
    expect(compileWriteStatement(exec('function'), v, 'postgres')).toMatchObject({ sql: 'SELECT * FROM "shop"."cancel_order"({{cv0}}, {{cv1}}, NULL)', values: { cv0: 7, cv1: v.reason } })
    expect(compileWriteStatement(exec('procedure'), v, 'postgres').sql).toBe('CALL "shop"."cancel_order"({{cv0}}, {{cv1}}, NULL)')
    expect(compileWriteStatement(exec('procedure'), v, 'mssql').sql).toBe('EXEC [shop].[cancel_order] @p_order = {{cv0}}, @p_reason = {{cv1}}')
    const noOut = normalizeCustomConfig({ ...exec('procedure'), write: { procedure: { ...exec('procedure').write!.procedure!, params: exec('procedure').write!.procedure!.params.filter((p) => !p.is_output) } } })
    expect(compileWriteStatement(noOut, v, 'mysql').sql).toBe('CALL `shop`.`cancel_order`({{cv0}}, {{cv1}})')
    expect(compileWriteStatement(noOut, v, 'oracle').sql).toBe('BEGIN "shop"."cancel_order"(p_order => {{cv0}}, p_reason => {{cv1}}); END;')
    expect(() => compileWriteStatement(exec('procedure'), v, 'mysql')).toThrow(/OUT parameters/)
    expect(() => compileWriteStatement(noOut, v, 'snowflake')).toThrow(/not supported for snowflake/)
    const bound = compileSql(compileWriteStatement(exec('procedure'), v, 'mssql').sql, 'mssql', { cv0: 7, cv1: v.reason }, [{ name: 'cv0' }, { name: 'cv1' }], undefined, 5000)
    expect(bound.sql).toBe('EXEC [shop].[cancel_order] @p_order = @_in1, @p_reason = @_in2')
    expect(bound.params).toEqual({ _in1: 7, _in2: v.reason })
  })
})

describe('custom reference writes: unbounded Update / Delete are refused', () => {
  it('at save: no key and no conditions', () => {
    expect(() => tableConfig('update', { set: [{ column: 'status', value: 'x' }] })).toThrow(/needs a WHERE/)
    expect(() => tableConfig('delete', {})).toThrow(/unbounded delete is not allowed/)
    // Conditions are enough.
    expect(() => tableConfig('delete', {}, { filter: { op: 'and', conditions: [{ field: 'status', operator: 'eq', value: '{{input.status}}' }] } })).not.toThrow()
  })

  it('at run: a blank key value, or every condition skipped, refuses the statement', () => {
    const del = tableConfig('delete', { key: [{ column: 'id', value: '{{input.order_id}}' }] })
    expect(() => compileWriteStatement(del, { order_id: '' }, 'postgres')).toThrow(/key "id" is empty/)
    const cond = tableConfig('delete', {}, { filter: { op: 'and', conditions: [{ field: 'status', operator: 'eq', value: '{{input.status}}' }] } })
    expect(() => compileWriteStatement(cond, { status: '' }, 'postgres')).toThrow(/no key or condition applies/)
    expect(compileWriteStatement(cond, { status: 'void' }, 'postgres').sql).toBe('DELETE FROM "shop"."orders" WHERE "status" = {{cv0}}')
  })

  it('REST Update / Delete need an identifying parameter, and refuse a blank one at run time', async () => {
    const source = { type: 'operation', inputs: [{ name: 'id', location: 'path' }, { name: 'q', location: 'query' }], params: [] as any[] }
    expect(() => normalizeCustomConfig({ kind: 'delete', source, inputs: [], columns: [] })).toThrow(/identifies the record/)
    const config = normalizeCustomConfig({ kind: 'delete', source: { ...source, params: [{ name: 'id', value: '{{input.id}}' }] }, inputs: [{ name: 'id', type: 'string' }], columns: [] })
    const runSource = vi.fn(async () => ({ status: 204, data: null }))
    const ref = { id: 'r', name: 'Delete ticket', request_config: { method: 'DELETE', path_template: '/tickets/{{id}}', origin: 'custom', custom: config } }
    await expect(runCustomReference({ ref, integrationConfig: {}, inputValues: { id: '' }, loadSettings: async () => ({}), runSource })).rejects.toThrow(/"id" \(which identifies the record\) is empty/)
    expect(runSource).not.toHaveBeenCalled()
  })

  it('max affected rows: default 1, capped at 1000', () => {
    expect(() => tableConfig('update', { set: [{ column: 'status', value: 'x' }], key: [{ column: 'id', value: '1' }], max_affected: 5000 })).toThrow(/at most 1000/)
    expect(tableConfig('update', { set: [{ column: 'status', value: 'x' }], key: [{ column: 'id', value: '1' }] }).write?.max_affected).toBeUndefined()
  })
})

describe('custom reference writes: runtime', () => {
  const updateRef = (extra: any = {}) => ({
    id: 'ref-u', name: 'Update order status', inputs: [],
    request_config: { method: 'POST', path_template: '/_internal/db/write', origin: 'custom', custom: tableConfig('update', { set: [{ column: 'status', value: '{{input.status}}' }], key: [{ column: 'id', value: '{{input.order_id}}' }], ...extra }) },
  })
  const pg = { db_config: { db_type: 'postgres' } }

  it('passes the cap and dry-run flag to the database; over the cap → 409, rolled back', async () => {
    const runSource = vi.fn(async () => { const e: any = new Error('This change would affect 3 rows — more than the maximum of 1. Nothing was changed (rolled back).'); e.name = 'AffectedRowsLimitError'; e.affectedRows = 3; e.maxAffected = 1; throw e })
    const result = await runCustomReference({ ref: updateRef(), integrationConfig: pg, inputValues: { order_id: 1, status: 'x' }, loadSettings: async () => ({}), runSource })
    expect((runSource.mock.calls[0] as any[])[2]).toEqual({ dbWrite: { maxAffected: 1, dryRun: false } })
    expect(result).toMatchObject({ status: 409, data: { affected_rows: 3, max_affected_rows: 1, rolled_back: true } })
  })

  it('not found: 404 by default, no-op when chosen; output { status, affected_rows, id, record }', async () => {
    const none = async () => ({ status: 200, data: { affected_rows: 0, rows: [], rolled_back: false } })
    expect(await runCustomReference({ ref: updateRef(), integrationConfig: pg, inputValues: { order_id: 9, status: 'x' }, loadSettings: async () => ({}), runSource: none })).toMatchObject({ status: 404 })
    const noop = await runCustomReference({ ref: updateRef({ not_found: 'noop' }), integrationConfig: pg, inputValues: { order_id: 9, status: 'x' }, loadSettings: async () => ({}), runSource: none })
    expect(noop).toMatchObject({ status: 200, data: { status: 200, affected_rows: 0, id: 9 } })
    const one = await runCustomReference({ ref: updateRef(), integrationConfig: pg, inputValues: { order_id: 9, status: 'x' }, loadSettings: async () => ({}), runSource: async () => ({ status: 200, data: { affected_rows: 1, rows: [] } }) })
    expect(one.data).toEqual({ status: 200, affected_rows: 1, id: 9, record: { id: 9, status: 'x' } })
  })

  it('a read-only caller (lookup, Data table, report) refuses a write reference', async () => {
    await expect(runCustomReference({ ref: updateRef(), integrationConfig: pg, inputValues: {}, loadSettings: async () => ({}), runSource: vi.fn(), readOnly: true })).rejects.toThrow(/writes data/)
  })

  it('Fixed inputs still cannot be overridden by callers of a write', async () => {
    const config = normalizeCustomConfig({
      kind: 'update', source: ORDERS, columns: [],
      inputs: [{ name: 'order_id', type: 'integer' }, { name: 'status', type: 'string', mode: 'fixed', fixed_value: 'cancelled' }],
      write: { set: [{ column: 'status', value: '{{input.status}}' }], key: [{ column: 'id', value: '{{input.order_id}}' }] },
    })
    const runSource = vi.fn(async () => ({ status: 200, data: { affected_rows: 1, rows: [] } }))
    await runCustomReference({ ref: { id: 'r', name: 'x', request_config: { origin: 'custom', custom: config } }, integrationConfig: pg, inputValues: { order_id: 4, status: 'refunded' }, loadSettings: async () => ({}), runSource })
    expect((runSource.mock.calls[0] as any[])[1]).toEqual({ cv0: 'cancelled', cv1: 4 })
  })

  it('a credential-backed Fixed input cannot be written into a table', () => {
    expect(() => normalizeCustomConfig({
      kind: 'create', source: ORDERS, columns: [], inputs: [{ name: 'tok', type: 'string', mode: 'fixed', fixed_setting: 'api_token' }],
      write: { set: [{ column: 'note', value: '{{input.tok}}' }] },
    })).toThrow(/cannot be written to the database/)
  })
})

describe('custom reference writes: REST body builder and method defaults', () => {
  const source = { type: 'operation', from: 'endpoint', inputs: [], params: [] }
  const inputs = [{ name: 'subject', type: 'string', required: true }, { name: 'priority', type: 'integer' }, { name: 'tags', type: 'array' }, { name: 'idem', type: 'string' }, { name: 'tenant', type: 'string', mode: 'fixed', fixed_value: 'acme' }]

  it('default methods: POST / PATCH / PUT / DELETE / POST; the author can change it', () => {
    expect(WRITE_KINDS.map((k) => defaultMethodFor(k))).toEqual(['POST', 'PATCH', 'PUT', 'DELETE', 'POST'])
    expect(normalizeCustomConfig({ kind: 'create', source, inputs: [], columns: [] }).write?.method).toBe('POST')
    expect(normalizeCustomConfig({ kind: 'create', source, inputs: [], columns: [], write: { method: 'PUT' } }).write?.method).toBe('PUT')
    for (const k of WRITE_KINDS) expect(KIND_INFO[k].description.length).toBeGreaterThan(20)
  })

  it('mapped fields build nested JSON; whole tokens keep types; blank optionals are left out; constants are typed', () => {
    const config = normalizeCustomConfig({
      kind: 'create', source, inputs, columns: [],
      write: { body: { mode: 'mapped', fields: [
        { path: 'ticket.subject', value: '{{input.subject}}' },
        { path: 'ticket.priority', value: '{{input.priority}}' },
        { path: 'ticket.tags', value: '{{input.tags}}' },
        { path: 'ticket.source', value: 'portal' },
        { path: 'ticket.urgent', value: 'true', type: 'boolean' },
        { path: 'meta.org', value: 'org-{{input.tenant}}' },
        { path: 'meta.extra', value: '{"a":1}', type: 'json' },
      ] } },
    })
    const { values } = resolveCustomInputs(config, { subject: 'Printer {{password}} on fire', priority: '2', tags: 'a,b', tenant: 'evil' })
    expect(buildRequestBody(config, values)).toEqual({
      ticket: { subject: 'Printer {{password}} on fire', priority: 2, tags: ['a', 'b'], source: 'portal', urgent: true },
      meta: { org: 'org-acme', extra: { a: 1 } },
    })
    const { values: sparse } = resolveCustomInputs(config, { subject: 'x' })
    expect(buildRequestBody(config, sparse)).toEqual({ ticket: { subject: 'x', source: 'portal', urgent: true }, meta: { org: 'org-acme', extra: { a: 1 } } })
  })

  it('"the whole input object" skips the idempotency key; prototype keys are refused', () => {
    const config = normalizeCustomConfig({ kind: 'create', source, inputs, columns: [], write: { body: { mode: 'inputs' }, idempotency: { input: 'idem' } } })
    const { values } = resolveCustomInputs(config, { subject: 's', idem: 'k-1' })
    expect(buildRequestBody(config, values)).toEqual({ subject: 's', tenant: 'acme' })
    expect(() => normalizeCustomConfig({ kind: 'create', source, inputs, columns: [], write: { body: { mode: 'mapped', fields: [{ path: 'a.__proto__.x', value: '1' }] } } })).toThrow(/not a valid JSON path/)
  })

  it('success statuses', () => {
    expect(parseStatusRanges('200-299, 304')).toEqual([[200, 299], [304, 304]])
    expect(isSuccessStatus(201, undefined)).toBe(true)
    expect(isSuccessStatus(201, '200')).toBe(false)
    expect(() => parseStatusRanges('2xx')).toThrow()
  })

  it('runtime: the body goes as one whole-value JSON placeholder (never re-rendered), with the write method and the idempotency header', async () => {
    const config = normalizeCustomConfig({
      kind: 'create', source: { ...source, inputs: [{ name: 'project', location: 'path' }], params: [{ name: 'project', value: 'HELP' }] }, inputs, columns: [{ path: 'id' }, { path: 'key', alias: 'ticket_key' }], rows_path: 'data',
      write: { body: { mode: 'mapped', fields: [{ path: 'subject', value: '{{input.subject}}' }] }, idempotency: { input: 'idem' } },
    })
    const ref = { id: 'ref-t', name: 'Create ticket', request_config: { method: 'GET', path_template: '/projects/{{project}}/tickets', headers: { 'content-type': 'text/plain' }, origin: 'custom', custom: config } }
    const runSource = vi.fn(async () => ({ status: 201, data: { data: { id: 42, key: 'HELP-42', secret: 'x' } } }))
    const result = await runCustomReference({ ref, integrationConfig: {}, inputValues: { subject: '{{api_key}}', idem: 'wf-run-1:node-3' }, loadSettings: async () => ({}), runSource })
    const [sourceRef, values, extra] = runSource.mock.calls[0] as any[]
    expect(sourceRef.request_config).toMatchObject({ method: 'POST', path_template: '/projects/{{project}}/tickets', body_template: '{{__cr_body}}', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': '{{__cr_idem}}' } })
    expect(sourceRef.request_config.headers['content-type']).toBeUndefined()
    expect(values).toEqual({ project: 'HELP', __cr_body: { subject: '{{api_key}}' }, __cr_idem: 'wf-run-1:node-3' })
    expect(extra).toBeUndefined()
    expect(result).toMatchObject({ status: 201, data: { status: 201, affected_rows: 1, id: 42, record: { id: 42, ticket_key: 'HELP-42' } } })
  })
})

describe('custom reference writes: idempotency key', () => {
  const config = normalizeCustomConfig({
    kind: 'create', source: { type: 'operation', from: 'endpoint', inputs: [], params: [] }, inputs: [{ name: 'subject', type: 'string' }, { name: 'idem', type: 'string' }], columns: [],
    write: { body: { mode: 'inputs' }, idempotency: { input: 'idem' } },
  })
  const ref = { id: 'ref-i', name: 'Create', request_config: { method: 'POST', path_template: '/t', origin: 'custom', custom: config } }

  function ledger() {
    const rows = new Map<string, any>()
    return {
      rows,
      store: (key: string) => ({
        claim: async () => {
          const row = rows.get(key)
          if (!row) { rows.set(key, { state: 'running' }); return { kind: 'claimed' as const } }
          return row.state === 'succeeded' ? { kind: 'replay' as const, result: row.result } : { kind: 'busy' as const }
        },
        complete: async (result: any) => { rows.set(key, { state: 'succeeded', result }) },
        release: async () => { rows.delete(key) },
      }),
    }
  }

  it('a retry with the same key returns the first result and does not write again', async () => {
    const l = ledger()
    const runSource = vi.fn(async () => ({ status: 201, data: { id: 1 } }))
    const first = await runCustomReference({ ref, integrationConfig: {}, inputValues: { subject: 'a', idem: 'k1' }, loadSettings: async () => ({}), runSource, idempotency: l.store })
    const retry = await runCustomReference({ ref, integrationConfig: {}, inputValues: { subject: 'a', idem: 'k1' }, loadSettings: async () => ({}), runSource, idempotency: l.store })
    expect(runSource).toHaveBeenCalledTimes(1)
    expect(retry.data).toEqual(first.data)
    expect(retry.shaping?.idempotent_replay).toBe(true)
    await runCustomReference({ ref, integrationConfig: {}, inputValues: { subject: 'a', idem: 'k2' }, loadSettings: async () => ({}), runSource, idempotency: l.store })
    expect(runSource).toHaveBeenCalledTimes(2)
  })

  it('a failed call releases its key so the retry runs; no key = no ledger', async () => {
    const l = ledger()
    const runSource = vi.fn().mockResolvedValueOnce({ status: 503, data: null }).mockResolvedValueOnce({ status: 201, data: { id: 2 } })
    expect((await runCustomReference({ ref, integrationConfig: {}, inputValues: { idem: 'k3' }, loadSettings: async () => ({}), runSource, idempotency: l.store })).status).toBe(503)
    expect((await runCustomReference({ ref, integrationConfig: {}, inputValues: { idem: 'k3' }, loadSettings: async () => ({}), runSource, idempotency: l.store })).status).toBe(201)
    const spy = vi.fn(l.store)
    await runCustomReference({ ref, integrationConfig: {}, inputValues: { subject: 'b' }, loadSettings: async () => ({}), runSource: async () => ({ status: 201, data: {} }), idempotency: spy })
    expect(spy).not.toHaveBeenCalled()
  })

  it('only Create and Execute take a key', () => {
    expect(() => normalizeCustomConfig({ ...config, kind: 'update', source: { type: 'operation', inputs: [{ name: 'id', location: 'path' }], params: [{ name: 'id', value: '{{input.subject}}' }] } })).toThrow(/Create and Execute/)
  })
})

// ─── Service: Test of write kinds ──────────────────────────────────────

const ALL = ['integrations.view', 'integrations.create', 'integrations.edit', 'integrations.test', 'integrations.manage_references']
function context(supabase: ReturnType<typeof createMemorySupabase>, permissions: string[] = ALL): ServiceContext {
  return { supabase: supabase as unknown as ServiceContext['supabase'], tenantId: 'tenant-a', actorId: 'user-1', permissions: new Set(permissions), authKind: 'api_key', source: 'api' }
}
const fetchMock = vi.fn()

describe('custom reference writes: service Test needs "Send for real" for REST', () => {
  let supabase: ReturnType<typeof createMemorySupabase>
  beforeEach(() => {
    supabase = createMemorySupabase({
      integrations: [{ id: 'int-h', tenant_id: 'tenant-a', name: 'Helpdesk', type: 'rest_api', is_active: true, config: encryptSensitiveFields({ base_url: 'https://helpdesk.example.com/api', auth_type: 'bearer', auth_config: { token: 'tok-plain' } }) }],
      integration_references: [],
      integration_call_logs: [],
    })
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  const custom = {
    kind: 'create',
    source: { type: 'operation', from: 'endpoint', method: 'POST', path_template: '/tickets' },
    inputs: [{ name: 'subject', type: 'string', required: true }],
    columns: [],
    write: { body: { mode: 'mapped', fields: [{ path: 'subject', value: '{{input.subject}}' }] } },
  }

  it('without confirmation the request is only rendered (never sent); send without confirm is refused', async () => {
    const preview: any = await previewCustomReference(context(supabase), 'int-h', { custom, inputs: { subject: 'Help' }, stage: 'shaped' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(preview.write).toEqual({ mode: 'dry_run', sent: false })
    expect(preview.data).toMatchObject({ dry_run: true, sent: false, request: { method: 'POST', url: 'https://helpdesk.example.com/api/tickets', body: { subject: 'Help' } } })
    expect(JSON.stringify(preview.data)).not.toContain('tok-plain')
    await expect(previewCustomReference(context(supabase), 'int-h', { custom, inputs: { subject: 'Help' }, stage: 'shaped', send: true })).rejects.toThrow(/Send for real/)
    await expect(previewCustomReference(context(supabase), 'int-h', { custom, stage: 'source' })).rejects.toThrow(/no sample/)
  })

  it('"Send for real" sends it once, and the call is logged', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 77 }), { status: 201, headers: { 'content-type': 'application/json' } }))
    const sent: any = await previewCustomReference(context(supabase), 'int-h', { custom, inputs: { subject: 'Help' }, stage: 'shaped', send: true, confirm: 'send' })
    expect(sent).toMatchObject({ status: 201, write: { mode: 'run', sent: true }, data: { status: 201, affected_rows: 1, id: 77 } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await new Promise((r) => setTimeout(r, 10))
    expect(supabase.tables.integration_call_logs.length).toBe(1)
    expect(supabase.tables.integration_call_logs[0]).toMatchObject({ caller_type: 'manual_test', response_status: 201 })
  })

  it('creating / editing a write reference needs Manage references', async () => {
    await expect(references.createReference(context(supabase, ['integrations.view', 'integrations.test']), 'int-h', { name: 'x', request_config: { origin: 'custom', custom } })).rejects.toThrow()
    const created = await references.createReference(context(supabase), 'int-h', { name: 'Create ticket', request_config: { origin: 'custom', custom } })
    const row: any = supabase.tables.integration_references.find((r: any) => r.id === created.id)
    expect(isWriteReference(row)).toBe(true)
    expect(row.request_config.method).toBe('POST')
    expect(row.outputs.map((o: any) => o.name)).toEqual(['status', 'affected_rows', 'id'])
  })
})

describe('custom reference writes: Execute is checked against introspection at save', () => {
  it('unknown procedure or parameter is refused; types and OUT come from the database', async () => {
    const supabase = createMemorySupabase({
      integrations: [{ id: 'int-db', tenant_id: 'tenant-a', name: 'Shop DB', type: 'database', is_active: true, config: { db_config: { db_type: 'postgres', host: 'db.example.com', database: 'shop' } } }],
      integration_references: [],
    })
    const routines = vi.spyOn(customReferenceDb, 'routines').mockResolvedValue([{ schema: 'shop', name: 'cancel_order', type: 'procedure' }])
    vi.spyOn(customReferenceDb, 'parameters').mockResolvedValue([{ name: 'p_order', type: 'integer', is_output: false }, { name: 'p_done', type: 'boolean', is_output: true }])
    const custom = (name: string, params: any[]) => ({ kind: 'execute', source: { type: 'table' }, inputs: [{ name: 'order_id', type: 'integer' }], columns: [], write: { procedure: { schema: 'shop', name, params } } })
    await expect(references.createReference(context(supabase), 'int-db', { name: 'x', request_config: { origin: 'custom', custom: custom('drop_everything', []) } })).rejects.toThrow(/no procedure or function/)
    await expect(references.createReference(context(supabase), 'int-db', { name: 'x', request_config: { origin: 'custom', custom: custom('cancel_order', [{ name: 'p_evil', value: '1' }]) } })).rejects.toThrow(/no parameter "p_evil"/)
    const created = await references.createReference(context(supabase), 'int-db', { name: 'Cancel order', request_config: { origin: 'custom', custom: custom('cancel_order', [{ name: 'p_order', value: '{{input.order_id}}', type: 'text' }]) } })
    const row: any = supabase.tables.integration_references.find((r: any) => r.id === created.id)
    expect(row.request_config.custom.write.procedure).toEqual({ schema: 'shop', name: 'cancel_order', routine_type: 'procedure', params: [{ name: 'p_order', type: 'integer', value: '{{input.order_id}}' }, { name: 'p_done', type: 'boolean', is_output: true }] })
    routines.mockRestore()
  })
})

describe('custom reference writes: badges, table changes, model, portability', () => {
  const writeRef = { request_config: { origin: 'custom', custom: { kind: 'update' } }, integration: { name: 'Northwind' } }
  it('"Writes data" in every picker hint; reads are not marked', () => {
    expect(referencePickerHint(writeRef)).toBe('Northwind · Custom · Writes data')
    expect(referencePickerHint({ request_config: { origin: 'custom', custom: { kind: 'list' } }, integration: { name: 'N' } })).toBe('N · Custom')
    expect(isWriteReference({ request_config: { method: 'POST' } })).toBe(false)
  })

  it('"for each changed row": row columns map to the Update reference\'s inputs of the same name', () => {
    expect(mapRowColumnsToInputs(['order_id', 'status', 'note'], ['OrderID', 'Status', 'ShipCity'], { note: '{{form.note}}' })).toEqual({ order_id: '{{row.OrderID}}', status: '{{row.Status}}', note: '{{form.note}}' })
  })

  it('the output model lists status, affected_rows, id and the record columns', () => {
    const config = tableConfig('update', { set: [{ column: 'status', value: '{{input.status}}' }], key: [{ column: 'id', value: '{{input.order_id}}' }] })
    const model = customOutputModel(config, null)
    expect(model.outputs.map((o) => o.name)).toEqual(['status', 'affected_rows', 'id', 'record.id', 'record.status'])
    expect(model.response_schema.root.type).toBe('object')
  })

  it('export / import keep the write config intact', async () => {
    const supabase = createMemorySupabase({
      integrations: [{ id: 'int-db', tenant_id: 'tenant-a', name: 'Shop DB', type: 'database', is_active: true, config: { db_config: { db_type: 'postgres', host: 'db.example.com', database: 'shop' } } }],
      integration_references: [],
    })
    const custom = {
      kind: 'update', source: ORDERS, columns: [],
      inputs: [{ name: 'order_id', type: 'integer', required: true }, { name: 'password_hint', type: 'string' }, { name: 'idempotency_key', type: 'string' }],
      write: { set: [{ column: 'note', value: '{{input.password_hint}}' }], key: [{ column: 'id', value: '{{input.order_id}}' }], max_affected: 3, not_found: 'noop', returning: true },
    }
    const created = await references.createReference(context(supabase), 'int-db', { name: 'Update order', request_config: { origin: 'custom', custom } })
    const original = JSON.parse(JSON.stringify(supabase.tables.integration_references.find((r: any) => r.id === created.id)))
    const exported = scrubSecretsForExport(JSON.parse(JSON.stringify(original)))
    expect(exported.request_config.custom).toEqual(original.request_config.custom)
    const maps = createEmptyAssetIdMaps()
    maps.integration['int-db'] = 'int-new'
    const imported = remapKnownIds(JSON.parse(JSON.stringify(exported.request_config)), maps)
    expect(imported.custom).toEqual(original.request_config.custom)
    expect(normalizeCustomConfig(imported.custom)).toEqual(imported.custom)
  })
})
